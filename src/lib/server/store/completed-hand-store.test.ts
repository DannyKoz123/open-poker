import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHand } from '../../engine/game';
import { FileSystemCompletedHandStore } from './completed-hand-store';
import type { PersistedHandRecord } from './types';

describe('FileSystemCompletedHandStore', () => {
  let dataDir: string;
  let store: FileSystemCompletedHandStore;

  beforeEach(() => {
    dataDir = join(tmpdir(), `open-poker-hand-store-${crypto.randomUUID()}`);
    store = new FileSystemCompletedHandStore(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('moves a hand from in-progress storage to completed storage', () => {
    const initialState = createHand(
      [
        { id: 'p1', name: 'Alice', chips: 1_000 },
        { id: 'p2', name: 'Bob', chips: 1_000 },
      ],
      0,
      5,
      10,
      'hand-roundtrip',
    );

    const record: PersistedHandRecord = {
      schemaVersion: 1,
      handId: 'hand-roundtrip',
      roomId: 'room-1',
      maxSeats: 9,
      startedAt: 1_710_000_000_000,
      completedAt: null,
      smallBlind: 5,
      bigBlind: 10,
      players: [
        { playerId: 'p1', name: 'Alice', seatIndex: 0, startingChips: 1_000, endingChips: null },
        { playerId: 'p2', name: 'Bob', seatIndex: 1, startingChips: 1_000, endingChips: null },
      ],
      initialState,
      actions: [],
      finalState: null,
      winners: [],
    };

    store.saveInProgressHand(record);
    expect(existsSync(join(dataDir, 'hands', 'in-progress', 'hand-roundtrip.json'))).toBe(true);

    const completed = {
      ...record,
      completedAt: record.startedAt + 5_000,
      players: record.players.map(player => ({
        ...player,
        endingChips: player.playerId === 'p1' ? 1_015 : 985,
      })),
      finalState: structuredClone(initialState),
      winners: [{ playerId: 'p1', amount: 15, description: 'won before showdown' }],
    } satisfies PersistedHandRecord;

    store.saveCompletedHand(completed);

    expect(existsSync(join(dataDir, 'hands', 'in-progress', 'hand-roundtrip.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'hands', 'completed', 'hand-roundtrip.json'))).toBe(true);

    const loaded = store.loadCompletedHand('hand-roundtrip');
    expect(loaded).not.toBeNull();
    expect(loaded?.completedAt).toBe(record.startedAt + 5_000);
    expect(loaded?.winners).toEqual(completed.winners);
    expect(loaded?.players[0].endingChips).toBe(1_015);
  });
});
