// WebSocket message types shared between client and server

import type { GameState, ActionType, AvailableActions } from './poker';

// Client -> Server messages
export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'sit'; seatIndex: number }
  | { type: 'stand' }
  | { type: 'action'; action: ActionType; amount?: number }
  | { type: 'start-game' };

// Server -> Client messages
export type ServerMessage =
  | { type: 'room-state'; room: RoomInfo }
  | { type: 'game-state'; state: GameState; availableActions: AvailableActions | null }
  | { type: 'player-joined'; playerId: string; name: string }
  | { type: 'player-left'; playerId: string }
  | { type: 'player-sat'; playerId: string; seatIndex: number }
  | { type: 'player-stood'; playerId: string }
  | { type: 'error'; message: string }
  | { type: 'hand-complete'; winners: { playerId: string; amount: number; description?: string }[] };

export interface RoomInfo {
  id: string;
  seats: (SeatInfo | null)[];
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  gameInProgress: boolean;
}

export interface SeatInfo {
  playerId: string;
  name: string;
  chips: number;
}
