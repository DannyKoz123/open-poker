import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAvailableActions } from '../../engine/game';
import type { ServerMessage } from '../../types/messages';
import { FileSystemCompletedHandStore } from '../store/completed-hand-store';
import { Room } from './Room';

class MockWebSocket {
  readyState = 1;
  sent: ServerMessage[] = [];

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
}

if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as Record<string, unknown>).WebSocket = { OPEN: 1, CLOSED: 3 } as unknown;
}

describe('Room completed hand persistence', () => {
  let dataDir: string;
  let store: FileSystemCompletedHandStore;

  beforeEach(() => {
    dataDir = join(tmpdir(), `open-poker-room-hand-${crypto.randomUUID()}`);
    store = new FileSystemCompletedHandStore(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('persists a completed hand with enough data to reload it by handId', () => {
    const room = new Room('room-persist', {
      smallBlind: 5,
      bigBlind: 10,
      completedHandStore: store,
    });

    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();

    room.handleConnection(ws1 as unknown as WebSocket, 'p1');
    room.handleMessage('p1', { type: 'join', name: 'Alice' });
    room.handleMessage('p1', { type: 'sit', seatIndex: 0 });

    room.handleConnection(ws2 as unknown as WebSocket, 'p2');
    room.handleMessage('p2', { type: 'join', name: 'Bob' });
    room.handleMessage('p2', { type: 'sit', seatIndex: 1 });

    room.handleMessage('p1', { type: 'start-game' });
    const handId = room.gameState?.handId;
    expect(handId).toBeTruthy();

    let guard = 0;
    while (room.gameState && guard < 20) {
      const state = room.gameState;
      const activePlayer = state.players[state.activePlayerIndex];
      const availableActions = getAvailableActions(state);
      const action = availableActions.canCheck ? 'check' : 'call';
      room.handleMessage(activePlayer.id, { type: 'action', action });
      guard += 1;
    }

    expect(room.gameState).toBeNull();
    expect(guard).toBeLessThan(20);

    const handComplete = ws1.sent.find(
      (message): message is Extract<ServerMessage, { type: 'hand-complete' }> =>
        message.type === 'hand-complete',
    );
    expect(handComplete?.handId).toBe(handId);

    const archived = store.loadCompletedHand(handId!);
    expect(archived).not.toBeNull();
    expect(archived?.handId).toBe(handId);
    expect(archived?.roomId).toBe('room-persist');
    expect(archived?.players.map(player => player.seatIndex)).toEqual([0, 1]);
    expect(archived?.actions.length).toBeGreaterThan(0);
    expect(archived?.completedAt).not.toBeNull();
    expect(archived?.finalState?.handId).toBe(handId);
    expect(archived?.winners.length).toBeGreaterThan(0);
  });
});
