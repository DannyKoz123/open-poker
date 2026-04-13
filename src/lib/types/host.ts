// Host mode types for the Home Game Host feature.
// HostSession wraps a Room and owns session lifecycle, approval queues, ledger, and closeout.

/**
 * Session lifecycle phases:
 *
 *   lobby ──[host-start-session]──> playing
 *   playing ──[host-pause-deal]──> paused
 *   paused  ──[host-pause-deal]──> playing
 *   playing ──[host-end-game, hand in progress]──> ending
 *   playing ──[host-end-game, no hand]──> closed
 *   ending  ──[hand completes]──> closed
 *   playing ──[host disconnect]──> paused (auto)
 *   paused  ──[host reconnect]──> playing (auto)
 */
export type SessionPhase = 'lobby' | 'playing' | 'paused' | 'ending' | 'closed';

export interface LedgerEntry {
  playerId: string;
  playerName: string;
  type: 'buy-in' | 'rebuy';
  amount: number; // cents
  timestamp: number;
}

export interface PlayerSettlement {
  playerId: string;
  playerName: string;
  /** Total cents put in (buy-in + all rebuys) */
  buyIn: number;
  /** Number of rebuys */
  rebuys: number;
  /** Chips at session end (cents) */
  finalChips: number;
  /** finalChips - buyIn. Positive = profit, negative = loss. */
  netResult: number;
}

export interface SettlementSummary {
  startedAt: number;
  endedAt: number;
  handsDealt: number;
  players: PlayerSettlement[];
  smallBlind: number;
  bigBlind: number;
}

export interface HostRoomState {
  hostId: string;
  hostName: string;
  sessionPhase: SessionPhase;
  seatQueue: { playerId: string; name: string; seatIndex: number }[];
  rebuyQueue: { playerId: string; name: string; amount: number }[];
  ledger: LedgerEntry[];
}

/** Participant identity that survives disconnects for correct settlement. */
export interface SessionParticipant {
  playerId: string;
  name: string;
}
