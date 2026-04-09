import type { Action, Card, GameState } from '../../types/poker';

export interface RoomSnapshot {
  roomId: string;
  seq: number;
  ts: number;
  version: number;
  state: GameState;
}

export type EventMeta = {
  seq: number;
  roomId: string;
  ts: number;
  version: number;
};

export type PersistedEvent =
  | (EventMeta & { kind: 'room-created'; payload: { creatorIp: string | null } })
  | (EventMeta & {
      kind: 'hand-started';
      payload: { deck: Card[]; dealerIndex: number; smallBlind: number; bigBlind: number };
    })
  | (EventMeta & { kind: 'action'; payload: Action })
  | (EventMeta & { kind: 'turn-timer-started'; payload: { playerId: string; deadlineTs: number } })
  | (EventMeta & { kind: 'turn-timer-fired'; payload: { playerId: string } })
  | (EventMeta & { kind: 'grace-timer-started'; payload: { playerId: string; deadlineTs: number } })
  | (EventMeta & { kind: 'player-joined'; payload: { playerId: string; name: string; secretHash: string } })
  | (EventMeta & { kind: 'player-left'; payload: { playerId: string } })
  | (EventMeta & { kind: 'hand-ended'; payload: { winnerIds: string[] } });

export interface RoomStore {
  appendEvent(roomId: string, event: PersistedEvent): Promise<void>;
  loadEvents(roomId: string, sinceSeq?: number): Promise<PersistedEvent[]>;
  saveSnapshot(roomId: string, snapshot: RoomSnapshot): Promise<void>;
  loadLatestSnapshot(roomId: string): Promise<RoomSnapshot | null>;
  listActiveRooms(): Promise<string[]>;
}
