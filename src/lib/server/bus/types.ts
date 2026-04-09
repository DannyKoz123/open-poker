import type { ServerMessage, ClientMessage } from '../../types/messages';
import type { GameState } from '../../types/poker';

export type CorrelationId = string;

export interface HandSummary {
  handId: string;
  winnerIds: string[];
}

export type RoomEvent =
  | { type: 'client-action'; playerId: string; action: ClientMessage; correlationId: CorrelationId }
  | { type: 'action-accepted'; correlationId: CorrelationId }
  | { type: 'action-rejected'; correlationId: CorrelationId; playerId: string; message: string }
  | { type: 'state-changed'; state: GameState }
  | { type: 'player-joined'; playerId: string }
  | { type: 'player-disconnected'; playerId: string; grace: boolean }
  | { type: 'hand-ended'; summary: HandSummary }
  | { type: 'server-message'; playerId: string; message: ServerMessage };

export interface RoomBus {
  publish(roomId: string, event: RoomEvent): Promise<void>;
  subscribe(roomId: string, handler: (event: RoomEvent) => void): () => void;
  subscribeAll(handler: (roomId: string, event: RoomEvent) => void): () => void;
}
