import type { GameState, Action } from '../../types/poker';
import type { ClientMessage, ServerMessage, RoomInfo, SeatInfo } from '../../types/messages';
import { createHand, applyAction, getAvailableActions, getPlayerView } from '../../engine/game';

interface ConnectedPlayer {
  id: string;
  name: string;
  ws: WebSocket | null;
  seatIndex: number | null;
  disconnectedAt: number | null;
}

const STARTING_CHIPS = 1000;
const RECONNECT_GRACE_MS = 30_000;
const TURN_TIMER_MS = 30_000;
const MAX_SEATS = 9;

export class Room {
  id: string;
  players: Map<string, ConnectedPlayer> = new Map();
  seats: (string | null)[] = new Array(MAX_SEATS).fill(null);
  smallBlind = 5;
  bigBlind = 10;
  dealerIndex = 0;
  gameState: GameState | null = null;
  chipStacks: Map<string, number> = new Map();
  turnTimer: ReturnType<typeof setTimeout> | null = null;
  actionQueue: (() => void)[] = [];
  processing = false;

  constructor(id: string) {
    this.id = id;
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

    if (player.seatIndex !== null && this.gameState) {
      // In a game: start disconnect grace timer
      player.disconnectedAt = Date.now();
      // If it's their turn, the turn timer handles auto-fold
      // If not their turn, the reconnect timer will kick them after 30s
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

  private enqueue(fn: () => void) {
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
      this.chipStacks.set(playerId, STARTING_CHIPS);
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
      chips: this.chipStacks.get(playerId) || STARTING_CHIPS,
    }));

    // Find dealer index within seated players
    this.dealerIndex = this.dealerIndex % seatedPlayers.length;

    this.gameState = createHand(players, this.dealerIndex, this.smallBlind, this.bigBlind);

    // Update chip stacks from game state
    for (const p of this.gameState.players) {
      this.chipStacks.set(p.id, p.chips);
    }

    this.startTurnTimer();
    this.broadcastGameState();
  }

  private handleHandComplete() {
    if (!this.gameState) return;

    // Update chip stacks
    for (const p of this.gameState.players) {
      this.chipStacks.set(p.id, p.chips);
    }

    const winners = this.gameState.winners.map(w => ({
      playerId: w.playerId,
      amount: w.amount,
      description: w.hand?.description,
    }));

    this.broadcastGameState();
    this.broadcast({ type: 'hand-complete', winners });

    // Advance dealer
    this.dealerIndex = (this.dealerIndex + 1) % this.getSeatedPlayers().length;

    // Clear game state so next hand can start
    this.gameState = null;
    this.broadcastRoomState();
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

  private broadcastRoomState() {
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
        chips: this.chipStacks.get(playerId) || STARTING_CHIPS,
      };
    });

    return {
      id: this.id,
      seats,
      maxSeats: MAX_SEATS,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      gameInProgress: this.gameState !== null,
    };
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
