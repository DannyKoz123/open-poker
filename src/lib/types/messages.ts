// WebSocket message types shared between client and server

import type { GameState, ActionType, AvailableActions } from './poker';
import type { SessionPhase, SettlementSummary, HostRoomState } from './host';

// Client -> Server messages
export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'sit'; seatIndex: number }
  | { type: 'stand' }
  | { type: 'action'; action: ActionType; amount?: number }
  | { type: 'start-game' }
  // Host mode messages
  | { type: 'rebuy-request'; amount: number }
  | { type: 'host-approve-seat'; playerId: string }
  | { type: 'host-deny-seat'; playerId: string }
  | { type: 'host-approve-rebuy'; playerId: string }
  | { type: 'host-deny-rebuy'; playerId: string }
  | { type: 'host-start-session' }
  | { type: 'host-pause-deal' }
  | { type: 'host-end-game' };

// Server -> Client messages
export type ServerMessage =
  | { type: 'room-state'; room: RoomInfo }
  | { type: 'game-state'; state: GameState; availableActions: AvailableActions | null }
  | { type: 'player-joined'; playerId: string; name: string }
  | { type: 'player-left'; playerId: string }
  | { type: 'player-sat'; playerId: string; seatIndex: number }
  | { type: 'player-stood'; playerId: string }
  | { type: 'error'; message: string }
  | {
      type: 'hand-complete';
      handId: string;
      winners: { playerId: string; amount: number; description?: string }[];
    }
  // Host mode messages
  | { type: 'seat-queued'; playerId: string; name: string; seatIndex: number }
  | { type: 'seat-approved'; playerId: string; seatIndex: number }
  | { type: 'seat-denied'; playerId: string }
  | { type: 'rebuy-queued'; playerId: string; name: string; amount: number }
  | { type: 'rebuy-approved'; playerId: string; amount: number }
  | { type: 'rebuy-denied'; playerId: string }
  | { type: 'session-started' }
  | { type: 'session-ended'; settlement: SettlementSummary }
  | { type: 'auto-deal-paused'; paused: boolean }
  | { type: 'host-state'; hostState: HostRoomState };

export interface RoomInfo {
  id: string;
  seats: (SeatInfo | null)[];
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  gameInProgress: boolean;
  /** null = non-host mode (standard room) */
  hostId: string | null;
  /** null when no host. Tracks session lifecycle in host mode. */
  sessionPhase: SessionPhase | null;
}

export interface SeatInfo {
  playerId: string;
  name: string;
  chips: number;
}
