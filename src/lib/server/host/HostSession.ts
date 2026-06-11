import type { ClientMessage, ServerMessage, RoomInfo } from '../../types/messages';
import type {
  SessionPhase,
  LedgerEntry,
  PlayerSettlement,
  SettlementSummary,
  HostRoomState,
  SessionParticipant,
} from '../../types/host';
import { Room } from '../room/Room';

const AUTO_DEAL_DELAY_MS = 3_000;

/**
 * HostSession wraps a Room and owns the host workflow:
 * session lifecycle, approval queues, ledger, and closeout.
 *
 * Room stays a table runtime (cards, bets, timers).
 * HostSession owns host policy on top.
 *
 * TIMER MATRIX (no two occupy the same lifecycle phase):
 * ┌──────────────┬───────────────┬────────────────┬──────────────┐
 * │ Timer        │ Active when   │ Blocked when   │ Interaction  │
 * ├──────────────┼───────────────┼────────────────┼──────────────┤
 * │ Turn (30s)   │ Hand active   │ Between hands  │ Independent  │
 * │ Auto-deal(3s)│ Between hands │ During hand    │ Independent  │
 * │ Disconnect   │ Player DC'd   │ Player online  │ Host DC →    │
 * │   grace(30s) │               │                │  auto-pause  │
 * │ Host pause   │ Phase=paused  │ Phase≠paused   │ Cancels      │
 * │              │               │                │  auto-deal   │
 * └──────────────┴───────────────┴────────────────┴──────────────┘
 */
export class HostSession {
  readonly room: Room;
  readonly hostId: string;
  readonly hostName: string;

  sessionPhase: SessionPhase = 'lobby';
  seatQueue: { playerId: string; name: string; seatIndex: number }[] = [];
  rebuyQueue: { playerId: string; name: string; amount: number }[] = [];
  ledger: LedgerEntry[] = [];
  participants: Map<string, SessionParticipant> = new Map();
  handsDealt = 0;
  sessionStartedAt: number | null = null;

  private autoDealTimer: ReturnType<typeof setTimeout> | null = null;
  /** True when paused due to host disconnect (vs. manual pause). */
  private pausedByDisconnect = false;

  constructor(room: Room, hostId: string, hostName: string) {
    this.room = room;
    this.hostId = hostId;
    this.hostName = hostName;

    // Register hand-complete callback so we can drive auto-deal / closeout
    this.room.onHandComplete = () => this.onHandComplete();

    // Register RoomInfo overrides so clients see host fields
    this.room.roomInfoOverrides = () => this.getRoomInfoOverrides();
  }

  // ── Message routing ────────────────────────────────────────────

  /**
   * Intercepts messages that need host gating.
   * Everything else passes through to Room.
   */
  handleMessage(playerId: string, msg: ClientMessage): void {
    switch (msg.type) {
      // Intercept sit: queue for host approval (unless it's the host self-seating)
      case 'sit':
        if (playerId === this.hostId) {
          this.room.handleMessage(playerId, msg);
          // Record buy-in only if the sit actually succeeded (seatIndex set by Room)
          const hostPlayer = this.room.players.get(playerId);
          if (hostPlayer && hostPlayer.seatIndex !== null && !this.participants.has(playerId)) {
            const name = hostPlayer.name || this.hostName;
            this.participants.set(playerId, { playerId, name });
            this.ledger.push({
              playerId,
              playerName: name,
              type: 'buy-in',
              amount: this.room.startingChips,
              timestamp: Date.now(),
            });
          }
        } else {
          this.enqueueSeatRequest(playerId, msg.seatIndex);
        }
        return;

      // Block non-host from starting games
      case 'start-game':
        if (playerId !== this.hostId) {
          this.sendTo(playerId, { type: 'error', message: 'Only the host can start the game' });
        }
        // In host mode, start-game is handled by auto-deal, not manual clicks
        return;

      // Host-specific actions
      case 'rebuy-request':
        this.handleRebuyRequest(playerId, msg.amount);
        return;
      case 'host-approve-seat':
        this.hostApproveSeat(playerId, msg.playerId);
        return;
      case 'host-deny-seat':
        this.hostDenySeat(playerId, msg.playerId);
        return;
      case 'host-approve-rebuy':
        this.hostApproveRebuy(playerId, msg.playerId);
        return;
      case 'host-deny-rebuy':
        this.hostDenyRebuy(playerId, msg.playerId);
        return;
      case 'host-start-session':
        this.hostStartSession(playerId);
        return;
      case 'host-pause-deal':
        this.hostPauseDeal(playerId);
        return;
      case 'host-end-game':
        this.hostEndGame(playerId);
        return;

      // Everything else passes through to Room
      default:
        this.room.handleMessage(playerId, msg);
        return;
    }
  }

  /** Called when a player connects (new or reconnect). Sends host state. */
  handleConnection(ws: WebSocket, playerId: string): void {
    this.room.handleConnection(ws, playerId);
    this.sendTo(playerId, { type: 'host-state', hostState: this.getHostRoomState() });

    // Auto-resume session if the host reconnected after a disconnect-pause
    // (don't override manual pauses — the host intentionally paused)
    if (playerId === this.hostId && this.sessionPhase === 'paused' && this.pausedByDisconnect) {
      this.pausedByDisconnect = false;
      this.sessionPhase = 'playing';
      this.startAutoDealTimer();
      this.broadcast({ type: 'auto-deal-paused', paused: false });
      this.broadcastHostState();
    }
  }

  /** Called on disconnect. Auto-pauses session if the host drops. */
  handleDisconnect(playerId: string, disconnectedWs: WebSocket): void {
    this.room.handleDisconnect(playerId, disconnectedWs);

    if (playerId === this.hostId && this.sessionPhase === 'playing') {
      this.sessionPhase = 'paused';
      this.pausedByDisconnect = true;
      this.clearAutoDealTimer();
      this.broadcast({ type: 'auto-deal-paused', paused: true });
      this.broadcastHostState();
    }
  }

  /** Called when a player reconnects. Auto-resumes if the host is back from a disconnect-pause. */
  handleReconnection(playerId: string): void {
    if (playerId === this.hostId && this.sessionPhase === 'paused' && this.pausedByDisconnect) {
      this.pausedByDisconnect = false;
      this.sessionPhase = 'playing';
      this.startAutoDealTimer();
      this.broadcast({ type: 'auto-deal-paused', paused: false });
      this.broadcastHostState();
    }
  }

  // ── Seat queue ─────────────────────────────────────────────────

  private enqueueSeatRequest(playerId: string, seatIndex: number): void {
    const player = this.room.players.get(playerId);
    if (!player) return;

    // Already seated or already in queue
    if (player.seatIndex !== null) {
      this.sendTo(playerId, { type: 'error', message: 'Already seated' });
      return;
    }
    if (this.seatQueue.some(r => r.playerId === playerId)) {
      this.sendTo(playerId, { type: 'error', message: 'Already in seat queue' });
      return;
    }

    this.seatQueue.push({ playerId, name: player.name, seatIndex });
    this.broadcast({ type: 'seat-queued', playerId, name: player.name, seatIndex });
    this.broadcastHostState();
  }

  private hostApproveSeat(callerPlayerId: string, targetPlayerId: string): void {
    if (!this.guardHost(callerPlayerId)) return;

    const idx = this.seatQueue.findIndex(r => r.playerId === targetPlayerId);
    if (idx === -1) {
      this.sendTo(callerPlayerId, { type: 'error', message: 'Player not in seat queue' });
      return;
    }

    const request = this.seatQueue[idx];

    // Check if the requested seat is still available
    if (this.room.seats[request.seatIndex] !== null) {
      this.sendTo(callerPlayerId, { type: 'error', message: `Seat ${request.seatIndex + 1} is taken` });
      this.broadcastHostState();
      return;
    }

    // Seat the player via Room (bypasses host check since we're calling internally)
    const player = this.room.players.get(targetPlayerId);
    if (!player) {
      this.seatQueue.splice(idx, 1);
      this.broadcastHostState();
      return;
    }

    // Directly seat (Room's sitPlayer is private, so we send a sit message through the room)
    this.room.handleMessage(targetPlayerId, { type: 'sit', seatIndex: request.seatIndex });

    // Verify the sit actually succeeded (could fail due to mid-hand guard or other rejection)
    const seatedPlayer = this.room.players.get(targetPlayerId);
    if (!seatedPlayer || seatedPlayer.seatIndex === null) {
      // Sit failed — keep the request in the queue so host can retry after hand
      this.sendTo(callerPlayerId, { type: 'error', message: 'Cannot seat during a hand. Will retry after.' });
      this.broadcastHostState();
      return;
    }

    // Sit succeeded — remove from queue
    this.seatQueue.splice(idx, 1);

    // Record buy-in ledger entry
    const buyInAmount = this.room.startingChips;
    this.ledger.push({
      playerId: targetPlayerId,
      playerName: request.name,
      type: 'buy-in',
      amount: buyInAmount,
      timestamp: Date.now(),
    });

    // Register participant (survives disconnects)
    this.participants.set(targetPlayerId, { playerId: targetPlayerId, name: request.name });

    this.broadcast({ type: 'seat-approved', playerId: targetPlayerId, seatIndex: request.seatIndex });
    this.resetAutoDealTimer();
    this.broadcastHostState();
  }

  private hostDenySeat(callerPlayerId: string, targetPlayerId: string): void {
    if (!this.guardHost(callerPlayerId)) return;

    const idx = this.seatQueue.findIndex(r => r.playerId === targetPlayerId);
    if (idx === -1) return;

    this.seatQueue.splice(idx, 1);
    this.sendTo(targetPlayerId, { type: 'seat-denied', playerId: targetPlayerId });
    this.broadcastHostState();
  }

  // ── Rebuy queue ────────────────────────────────────────────────

  private handleRebuyRequest(playerId: string, amount: number): void {
    const player = this.room.players.get(playerId);
    if (!player || player.seatIndex === null) {
      this.sendTo(playerId, { type: 'error', message: 'Must be seated to request rebuy' });
      return;
    }
    if (this.sessionPhase !== 'playing' && this.sessionPhase !== 'paused') {
      this.sendTo(playerId, { type: 'error', message: 'Session not active' });
      return;
    }
    if (amount <= 0) {
      this.sendTo(playerId, { type: 'error', message: 'Invalid rebuy amount' });
      return;
    }
    if (this.rebuyQueue.some(r => r.playerId === playerId)) {
      this.sendTo(playerId, { type: 'error', message: 'Rebuy already pending' });
      return;
    }

    this.rebuyQueue.push({ playerId, name: player.name, amount });
    this.broadcast({ type: 'rebuy-queued', playerId, name: player.name, amount });
    this.broadcastHostState();
  }

  private hostApproveRebuy(callerPlayerId: string, targetPlayerId: string): void {
    if (!this.guardHost(callerPlayerId)) return;

    const idx = this.rebuyQueue.findIndex(r => r.playerId === targetPlayerId);
    if (idx === -1) {
      this.sendTo(callerPlayerId, { type: 'error', message: 'Player not in rebuy queue' });
      return;
    }

    const request = this.rebuyQueue[idx];
    this.rebuyQueue.splice(idx, 1);

    // Add chips
    const current = this.room.chipStacks.get(targetPlayerId) ?? 0;
    this.room.chipStacks.set(targetPlayerId, current + request.amount);

    // Record ledger entry
    this.ledger.push({
      playerId: targetPlayerId,
      playerName: request.name,
      type: 'rebuy',
      amount: request.amount,
      timestamp: Date.now(),
    });

    this.broadcast({ type: 'rebuy-approved', playerId: targetPlayerId, amount: request.amount });
    this.room.broadcastRoomState();
    this.broadcastHostState();
  }

  private hostDenyRebuy(callerPlayerId: string, targetPlayerId: string): void {
    if (!this.guardHost(callerPlayerId)) return;

    const idx = this.rebuyQueue.findIndex(r => r.playerId === targetPlayerId);
    if (idx === -1) return;

    this.rebuyQueue.splice(idx, 1);
    this.sendTo(targetPlayerId, { type: 'rebuy-denied', playerId: targetPlayerId });
    this.broadcastHostState();
  }

  // ── Session lifecycle ──────────────────────────────────────────

  private hostStartSession(callerPlayerId: string): void {
    if (!this.guardHost(callerPlayerId)) return;
    if (this.sessionPhase !== 'lobby') {
      this.sendTo(callerPlayerId, { type: 'error', message: 'Session already started' });
      return;
    }

    this.sessionPhase = 'playing';
    this.sessionStartedAt = Date.now();
    this.broadcast({ type: 'session-started' });
    this.startAutoDealTimer();
    this.broadcastHostState();
  }

  private hostPauseDeal(callerPlayerId: string): void {
    if (!this.guardHost(callerPlayerId)) return;

    if (this.sessionPhase === 'playing') {
      this.sessionPhase = 'paused';
      this.clearAutoDealTimer();
      this.broadcast({ type: 'auto-deal-paused', paused: true });
    } else if (this.sessionPhase === 'paused') {
      this.sessionPhase = 'playing';
      this.startAutoDealTimer();
      this.broadcast({ type: 'auto-deal-paused', paused: false });
    } else {
      this.sendTo(callerPlayerId, { type: 'error', message: 'Cannot pause/resume in current phase' });
      return;
    }

    this.broadcastHostState();
  }

  private hostEndGame(callerPlayerId: string): void {
    if (!this.guardHost(callerPlayerId)) return;
    if (this.sessionPhase !== 'playing' && this.sessionPhase !== 'paused') {
      this.sendTo(callerPlayerId, { type: 'error', message: 'No active session to end' });
      return;
    }

    if (this.room.gameState !== null) {
      // Hand in progress: queue the close
      this.sessionPhase = 'ending';
      this.clearAutoDealTimer();
      this.broadcastHostState();
    } else {
      this.closeSession();
    }
  }

  /** Called by the onHandComplete callback from Room. */
  private onHandComplete(): void {
    this.handsDealt++;

    if (this.sessionPhase === 'ending') {
      this.closeSession();
    } else if (this.sessionPhase === 'playing') {
      this.startAutoDealTimer();
    }
    // If paused, do nothing (no auto-deal)
  }

  private closeSession(): void {
    this.sessionPhase = 'closed';
    this.clearAutoDealTimer();

    const settlement = this.buildSettlement();
    this.broadcast({ type: 'session-ended', settlement });
    this.broadcastHostState();
  }

  private buildSettlement(): SettlementSummary {
    const playerSettlements: PlayerSettlement[] = [];

    for (const [playerId, participant] of this.participants) {
      const entries = this.ledger.filter(e => e.playerId === playerId);
      const totalBuyIn = entries.reduce((sum, e) => sum + e.amount, 0);
      const rebuyCount = entries.filter(e => e.type === 'rebuy').length;
      const finalChips = this.room.chipStacks.get(playerId) ?? 0;

      playerSettlements.push({
        playerId,
        playerName: participant.name,
        buyIn: totalBuyIn,
        rebuys: rebuyCount,
        finalChips,
        netResult: finalChips - totalBuyIn,
      });
    }

    return {
      startedAt: this.sessionStartedAt ?? Date.now(),
      endedAt: Date.now(),
      handsDealt: this.handsDealt,
      players: playerSettlements,
      smallBlind: this.room.smallBlind,
      bigBlind: this.room.bigBlind,
    };
  }

  // ── Auto-deal timer ────────────────────────────────────────────

  private startAutoDealTimer(): void {
    if (this.sessionPhase !== 'playing') return;
    this.clearAutoDealTimer();

    this.autoDealTimer = setTimeout(() => {
      this.room.enqueue(() => this.autoDeal());
    }, AUTO_DEAL_DELAY_MS);
  }

  private resetAutoDealTimer(): void {
    this.clearAutoDealTimer();
    this.startAutoDealTimer();
  }

  private clearAutoDealTimer(): void {
    if (this.autoDealTimer) {
      clearTimeout(this.autoDealTimer);
      this.autoDealTimer = null;
    }
  }

  private autoDeal(): void {
    if (this.room.gameState !== null) return;
    if (this.sessionPhase !== 'playing') return;

    // Call startGame on room (it's private, use the message path)
    this.room.handleMessage(this.hostId, { type: 'start-game' });
  }

  // ── Helpers ────────────────────────────────────────────────────

  private guardHost(callerPlayerId: string): boolean {
    if (callerPlayerId !== this.hostId) {
      this.sendTo(callerPlayerId, { type: 'error', message: 'Only the host can do this' });
      return false;
    }
    return true;
  }

  private sendTo(playerId: string, msg: ServerMessage): void {
    const player = this.room.players.get(playerId);
    if (player?.ws?.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: ServerMessage): void {
    for (const player of this.room.players.values()) {
      if (player.ws?.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(msg));
      }
    }
  }

  private broadcastHostState(): void {
    const hostState = this.getHostRoomState();
    this.broadcast({ type: 'host-state', hostState });
  }

  getHostRoomState(): HostRoomState {
    return {
      hostId: this.hostId,
      hostName: this.hostName,
      sessionPhase: this.sessionPhase,
      seatQueue: [...this.seatQueue],
      rebuyQueue: [...this.rebuyQueue],
      ledger: [...this.ledger],
    };
  }

  /** Override RoomInfo with host fields for correct client rendering. */
  getRoomInfoOverrides(): Pick<RoomInfo, 'hostId' | 'sessionPhase'> {
    return {
      hostId: this.hostId,
      sessionPhase: this.sessionPhase,
    };
  }
}
