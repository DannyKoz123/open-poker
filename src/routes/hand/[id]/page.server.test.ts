import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { applyAction, createHand } from '$lib/engine';
import { FileSystemCompletedHandStore, setCompletedHandStore } from '$lib/server/store/completed-hand-store';
import type { PersistedHandRecord } from '$lib/server/store/types';
import type { Action, GameState } from '$lib/types/poker';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './+page.server';

const TEST_PLAYERS = [
  { id: 'p1', name: 'Alice', chips: 100 },
  { id: 'p2', name: 'Bob', chips: 100 },
];

function activePlayerId(state: GameState): string {
  return state.players[state.activePlayerIndex].id;
}

function playHand(handId: string, scriptedActions: Action[]): PersistedHandRecord {
  const initialState = createHand(TEST_PLAYERS, 0, 5, 10, handId);
  let state = initialState;

  const actions = scriptedActions.map((action, index) => {
    state = applyAction(state, action);
    return {
      seq: index + 1,
      ts: 1_000 + index,
      action,
    };
  });

  if (state.phase !== 'hand-complete') {
    throw new Error(`Expected scripted hand ${handId} to finish, got ${state.phase}`);
  }

  return {
    schemaVersion: 1,
    handId,
    roomId: 'room-loader',
    maxSeats: 9,
    startedAt: 1_000,
    completedAt: 2_000,
    smallBlind: 5,
    bigBlind: 10,
    players: TEST_PLAYERS.map((player, seatIndex) => {
      const finalPlayer = state.players.find(candidate => candidate.id === player.id);
      return {
        playerId: player.id,
        name: player.name,
        seatIndex,
        startingChips: player.chips,
        endingChips: finalPlayer?.chips ?? null,
      };
    }),
    initialState,
    actions,
    finalState: state,
    winners: state.winners.map(winner => ({
      playerId: winner.playerId,
      amount: winner.amount,
      description: winner.hand?.description,
    })),
  };
}

describe('/hand/[id] page server load', () => {
  let dataDir: string;
  let store: FileSystemCompletedHandStore;

  beforeEach(() => {
    dataDir = join(tmpdir(), `open-poker-hand-loader-${crypto.randomUUID()}`);
    store = new FileSystemCompletedHandStore(dataDir);
    setCompletedHandStore(store);
  });

  afterEach(() => {
    setCompletedHandStore(null);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('loads a replay hand for an existing handId', async () => {
    const initial = createHand(TEST_PLAYERS, 0, 5, 10, 'hand-loader');
    store.saveCompletedHand(
      playHand('hand-loader', [{ type: 'fold', playerId: activePlayerId(initial) }]),
    );

    const result = await load({ params: { id: 'hand-loader' } } as never);
    expect(result.replayHand.handId).toBe('hand-loader');
    expect(result.replayHand.roomId).toBe('room-loader');
    expect(result.replayHand.winners).toHaveLength(1);
    expect(result.replayHand.streets[0].street).toBe('preflop');
    expect(result.equitySnapshots).toEqual([]);
  });

  it('loads showdown equity snapshots for a persisted showdown hand', async () => {
    const initial = createHand(TEST_PLAYERS, 0, 5, 10, 'hand-showdown-loader');
    const firstActor = activePlayerId(initial);
    const afterAllIn = applyAction(initial, { type: 'all-in', playerId: firstActor });
    const secondActor = activePlayerId(afterAllIn);

    store.saveCompletedHand(
      playHand('hand-showdown-loader', [
        { type: 'all-in', playerId: firstActor },
        { type: 'call', playerId: secondActor },
      ]),
    );

    const result = await load({ params: { id: 'hand-showdown-loader' } } as never);
    expect(result.replayHand.handId).toBe('hand-showdown-loader');
    expect(result.equitySnapshots.map(snapshot => snapshot.street)).toEqual(['flop', 'turn', 'river']);
    expect(result.equitySnapshots.every(snapshot => snapshot.pots.length > 0)).toBe(true);
  });

  it('throws a 404 for an unknown handId', async () => {
    await expect(load({ params: { id: 'missing-hand' } } as never)).rejects.toMatchObject({
      status: 404,
    });
  });
});
