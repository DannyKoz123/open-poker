import type { GameState, Action } from '../../types/poker';
import type { ClientMessage, ServerMessage, RoomInfo, SeatInfo } from '../../types/messages';
import { createHand, applyAction, getAvailableActions, getPlayerView } from '../../engine/game';
import type { HostSession } from '../host/HostSession';
import type { CompletedHandStore, PersistedHandRecord, PersistedHandWinner } from '../store/types';
import { NOOP_COMPLETED_HAND_STORE } from '../store/completed-hand-store';

interface ConnectedPlayer {
  id: string;
  name: string;
  ws: WebSocket | null;
  seatIndex: number | null;
  disconnectedAt: number | null;
}

const BUY_IN_BIG_BLINDS = 100;
const RECONNECT_GRACE_MS = 30_000;
const TURN_TIMER_MS = 30_000;
const MAX_SEATS = 9;

export interface RoomOptions {
  smallBlind?: number;
  bigBlind?: number;
  completedHandStore?: CompletedHandStore;
}

export class Room {
  id: string;
  players: Map<string, ConnectedPlayer> = new Map();
  seats: (string | null)[] = new Array(MAX_SEATS).fill(null);
  smallBlind: number;
  bigBlind: number;
  startingChips: number;
  dealerIndex = 0;
  gameState: GameState | null = null;
  chipStacks: Map<string, number> = new Map();
  turnTimer: ReturnType<typeof setTimeout> | null = null;
  actionQueue: (() => void)[] = [];
  processing = false;
  private readonly completedHandStore: CompletedHandStore;
  private currentHandRecord: PersistedHandRecord | null = null;
  /** Optional callback invoked after each hand completes (used by HostSession). */
  onHandComplete?: () => void;
  /** Optional override for RoomInfo host fields (set by HostSession). */
  roomInfoOverrides?: () => Partial<RoomInfo>;
  /** Attached HostSession, if this room is host-controlled. */
  hostSession?: HostSession;

  constructor(id: string, options: RoomOptions = {}) {
    this.id = id;
    this.smallBlind = options.smallBlind ?? 5;
    this.bigBlind = options.bigBlind ?? 10;
    this.startingChips = this.bigBlind * BUY_IN_BIG_BLINDS;
    this.completedHandStore = options.completedHandStore ?? NOOP_COMPLETED_HAND_STORE;
  }

  handleConnection(ws: WebSocket, playerId: string) {
    const existing = this.players.get(playerId);
    if (existing) {
      // Reconnection
      existing.ws = ws;
      existing.disconnectedAt = null;
    } else {
      // New player — create entry so ws is stored before join message arrives
      this.players.set(playerId, {
        id: playerId,
        name: '',
        ws,
        seatIndex: null,
        disconnectedAt: null,
      });
    }
    // Send current room state
    this.sendTo(playerId, { type: 'room-state', room: this.getRoomInfo() });
    if (this.gameState) {
      this.sendGameState(playerId);
    }
  }

  handleMessage(playerId: string, msg: ClientMessage) {
    this.enqueue(() => this.processMessage(playerId, msg));
  }

  handleDisconnect(playerId: string, disconnectedWs: WebSocket) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Ignore close events from stale connections (player already reconnected on a new socket)
    if (player.ws !== disconnectedWs) return;

    // Grant grace period if seated during a hand, OR if a host session is active
    // (host mode keeps players alive between hands for the session duration)
    const needsGrace = (player.seatIndex !== null && this.gameState) || this.hostSession;
    if (needsGrace) {
      player.disconnectedAt = Date.now();
      setTimeout(() => {
        const p = this.players.get(playerId);
        if (p && p.disconnectedAt !== null) {
          this.removePlayer(playerId);
        }
      }, RECONNECT_GRACE_MS);
    } else {
      this.removePlayer(playerId);
    }
  }

  /** Schedule an action on the serial queue. Public for HostSession integration. */
  enqueue(fn: () => void) {
    this.actionQueue.push(fn);
    if (!this.processing) this.processQueue();
  }

  private processQueue() {
    this.processing = true;
    while (this.actionQueue.length > 0) {
      const fn = this.actionQueue.shift()!;
      try { fn(); } catch (e) { console.error('Queue error:', e); }
    }
    this.processing = false;
  }

  private processMessage(playerId: string, msg: ClientMessage) {
    switch (msg.type) {
      case 'join':
        this.addPlayer(playerId, msg.name);
        break;
      case 'sit':
        this.sitPlayer(playerId, msg.seatIndex);
        break;
      case 'stand':
        this.standPlayer(playerId);
        break;
      case 'action':
        this.handleAction(playerId, msg.action, msg.amount);
        break;
      case 'start-game':
        this.startGame();
        break;
    }
  }

  private addPlayer(playerId: string, name: string) {
    if (this.players.has(playerId)) {
      // Already joined, update name
      this.players.get(playerId)!.name = name;
    } else {
      this.players.set(playerId, {
        id: playerId,
        name,
        ws: null,
        seatIndex: null,
        disconnectedAt: null,
      });
    }
    this.broadcast({ type: 'player-joined', playerId, name });
    this.broadcastRoomState();
  }

  private sitPlayer(playerId: string, seatIndex: number) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (this.gameState) {
      this.sendTo(playerId, { type: 'error', message: 'Cannot sit during a hand' });
      return;
    }
    if (seatIndex < 0 || seatIndex >= MAX_SEATS) {
      this.sendTo(playerId, { type: 'error', message: 'Invalid seat' });
      return;
    }
    if (this.seats[seatIndex] !== null) {
      this.sendTo(playerId, { type: 'error', message: 'Seat taken' });
      return;
    }
    if (player.seatIndex !== null) {
      this.seats[player.seatIndex] = null;
    }
    this.seats[seatIndex] = playerId;
    player.seatIndex = seatIndex;
    if (!this.chipStacks.has(playerId)) {
      this.chipStacks.set(playerId, this.startingChips);
    }
    this.broadcast({ type: 'player-sat', playerId, seatIndex });
    this.broadcastRoomState();
  }

  private standPlayer(playerId: string) {
    const player = this.players.get(playerId);
    if (!player || player.seatIndex === null) return;
    if (this.gameState) {
      this.sendTo(playerId, { type: 'error', message: 'Cannot stand during a hand' });
      return;
    }
    this.seats[player.seatIndex] = null;
    player.seatIndex = null;
    this.broadcast({ type: 'player-stood', playerId });
    this.broadcastRoomState();
  }

  private handleAction(playerId: string, actionType: string, amount?: number) {
    if (!this.gameState) {
      this.sendTo(playerId, { type: 'error', message: 'No game in progress' });
      return;
    }

    try {
      const action: Action = {
        type: actionType as Action['type'],
        playerId,
        amount,
      };
      this.gameState = applyAction(this.gameState, action);
      this.recordHandAction(action);
      this.clearTurnTimer();

      if (this.gameState.phase === 'hand-complete') {
        this.handleHandComplete();
      } else {
        this.startTurnTimer();
        this.broadcastGameState();
      }
    } catch (error: unknown) {
      this.sendTo(playerId, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Invalid action'
      });
    }
  }

  private startGame() {
    if (this.gameState) return;

    const seatedPlayers = this.getSeatedPlayers();
    if (seatedPlayers.length < 2) return;

    const players = seatedPlayers.map(({ playerId }) => ({
      id: playerId,
      name: this.players.get(playerId)!.name,
      chips: this.chipStacks.get(playerId) || this.startingChips,
    }));

    // Find dealer index within seated players
    this.dealerIndex = this.dealerIndex % seatedPlayers.length;

    this.gameState = createHand(players, this.dealerIndex, this.smallBlind, this.bigBlind);

    // Update chip stacks from game state
    for (const p of this.gameState.players) {
      this.chipStacks.set(p.id, p.chips);
    }

    this.beginHandPersistence(seatedPlayers, players);
    this.startTurnTimer();
    this.broadcastGameState();
  }

  private handleHandComplete() {
    if (!this.gameState) return;

    const handId = this.gameState.handId;

    // Update chip stacks
    for (const p of this.gameState.players) {
      this.chipStacks.set(p.id, p.chips);
    }

    const winners = this.gameState.winners.map(w => ({
      playerId: w.playerId,
      amount: w.amount,
      description: w.hand?.description,
    }));

    this.completeHandPersistence(winners);
    this.broadcastGameState();
    this.broadcast({ type: 'hand-complete', handId, winners });

    // Advance dealer
    this.dealerIndex = (this.dealerIndex + 1) % this.getSeatedPlayers().length;

    // Clear game state so next hand can start
    this.gameState = null;
    this.broadcastRoomState();

    // Notify HostSession if registered
    this.onHandComplete?.();
  }

  private removePlayer(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) return;

    if (player.seatIndex !== null) {
      this.seats[player.seatIndex] = null;
    }
    this.players.delete(playerId);
    this.broadcast({ type: 'player-left', playerId });
    this.broadcastRoomState();
  }

  // --- Turn timer ---

  private startTurnTimer() {
    this.clearTurnTimer();
    if (!this.gameState || this.gameState.phase === 'hand-complete') return;

    const activePlayer = this.gameState.players[this.gameState.activePlayerIndex];
    if (!activePlayer || activePlayer.status !== 'active') return;

    this.turnTimer = setTimeout(() => {
      if (!this.gameState) return;
      // Auto-fold on timeout
      this.enqueue(() => {
        if (!this.gameState) return;
        const player = this.gameState.players[this.gameState.activePlayerIndex];
        if (player) {
          this.handleAction(player.id, 'fold');
        }
      });
    }, TURN_TIMER_MS);
  }

  private clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  // --- Hand persistence ---

  private beginHandPersistence(
    seatedPlayers: { playerId: string; seatIndex: number }[],
    startingPlayers: { id: string; name: string; chips: number }[],
  ) {
    if (!this.gameState) return;

    const startingStacks = new Map(startingPlayers.map(player => [player.id, player]));
    this.currentHandRecord = {
      schemaVersion: 1,
      handId: this.gameState.handId,
      roomId: this.id,
      maxSeats: MAX_SEATS,
      startedAt: Date.now(),
      completedAt: null,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      players: seatedPlayers.map(({ playerId, seatIndex }) => {
        const startingPlayer = startingStacks.get(playerId);
        return {
          playerId,
          name: startingPlayer?.name ?? this.players.get(playerId)?.name ?? 'Unknown',
          seatIndex,
          startingChips: startingPlayer?.chips ?? this.startingChips,
          endingChips: null,
        };
      }),
      initialState: structuredClone(this.gameState),
      actions: [],
      finalState: null,
      winners: [],
    };

    this.persistInProgressHand('hand start');
  }

  private recordHandAction(action: Action) {
    if (!this.currentHandRecord) return;

    this.currentHandRecord.actions.push({
      seq: this.currentHandRecord.actions.length + 1,
      ts: Date.now(),
      action: { ...action },
    });

    this.persistInProgressHand(`action ${action.type}`);
  }

  private completeHandPersistence(winners: PersistedHandWinner[]) {
    if (!this.currentHandRecord || !this.gameState) return;

    for (const persistedPlayer of this.currentHandRecord.players) {
      const finalPlayer = this.gameState.players.find(player => player.id === persistedPlayer.playerId);
      persistedPlayer.endingChips = finalPlayer?.chips ?? null;
    }

    this.currentHandRecord.completedAt = Date.now();
    this.currentHandRecord.finalState = structuredClone(this.gameState);
    this.currentHandRecord.winners = winners.map(winner => ({ ...winner }));

    try {
      this.completedHandStore.saveCompletedHand(this.currentHandRecord);
    } catch (error) {
      console.error(`Failed to persist completed hand ${this.currentHandRecord.handId}:`, error);
    } finally {
      this.currentHandRecord = null;
    }
  }

  private persistInProgressHand(reason: string) {
    if (!this.currentHandRecord) return;

    try {
      this.completedHandStore.saveInProgressHand(this.currentHandRecord);
    } catch (error) {
      console.error(
        `Failed to persist ${reason} for hand ${this.currentHandRecord.handId}:`,
        error,
      );
    }
  }

  // --- Broadcasting ---

  private sendTo(playerId: string, msg: ServerMessage) {
    const player = this.players.get(playerId);
    if (player?.ws?.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: ServerMessage) {
    for (const player of this.players.values()) {
      if (player.ws?.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(msg));
      }
    }
  }

  private broadcastGameState() {
    if (!this.gameState) return;
    for (const player of this.players.values()) {
      this.sendGameState(player.id);
    }
  }

  private sendGameState(playerId: string) {
    if (!this.gameState) return;
    const view = getPlayerView(this.gameState, playerId);
    const activePlayer = this.gameState.players[this.gameState.activePlayerIndex];
    const isMyTurn = activePlayer?.id === playerId && activePlayer?.status === 'active';
    const availableActions = isMyTurn ? getAvailableActions(this.gameState) : null;
    this.sendTo(playerId, { type: 'game-state', state: view, availableActions });
  }

  /** Broadcast room state to all players. Public for HostSession integration. */
  broadcastRoomState() {
    const room = this.getRoomInfo();
    this.broadcast({ type: 'room-state', room });
  }

  private getRoomInfo(): RoomInfo {
    const seats: (SeatInfo | null)[] = this.seats.map(playerId => {
      if (!playerId) return null;
      const player = this.players.get(playerId);
      if (!player) return null;
      return {
        playerId,
        name: player.name,
        chips: this.chipStacks.get(playerId) || this.startingChips,
      };
    });

    const base: RoomInfo = {
      id: this.id,
      seats,
      maxSeats: MAX_SEATS,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      gameInProgress: this.gameState !== null,
      hostId: null,
      sessionPhase: null,
    };

    // Merge host overrides if a HostSession is attached
    return this.roomInfoOverrides ? { ...base, ...this.roomInfoOverrides() } : base;
  }

  private getSeatedPlayers(): { playerId: string; seatIndex: number }[] {
    return this.seats
      .map((playerId, i) => ({ playerId, seatIndex: i }))
      .filter((s): s is { playerId: string; seatIndex: number } => s.playerId !== null);
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }
}
