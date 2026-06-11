import { describe, expect, it } from 'bun:test';
import { applyAction, createHand } from '../../engine';
import type { PersistedHandRecord } from '../../server/store/types';
import type { Action, GameState } from '../../types/poker';
import { buildReplayHand } from './build-replay-hand';

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
    roomId: 'room-replay',
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

describe('buildReplayHand', () => {
  it('groups actions by street and exposes showdown-only cards', () => {
    const initial = createHand(TEST_PLAYERS, 0, 5, 10, 'hand-all-in');
    const firstActor = activePlayerId(initial);
    const afterAllIn = applyAction(initial, { type: 'all-in', playerId: firstActor });
    const secondActor = activePlayerId(afterAllIn);

    const replay = buildReplayHand(
      playHand('hand-all-in', [
        { type: 'all-in', playerId: firstActor },
        { type: 'call', playerId: secondActor },
      ]),
    );

    expect(replay.streets.map(street => street.street)).toEqual(['preflop', 'flop', 'turn', 'river']);
    expect(replay.streets[0].actions).toHaveLength(2);
    expect(replay.streets[1].actions).toHaveLength(0);
    expect(replay.streets[2].actions).toHaveLength(0);
    expect(replay.streets[3].actions).toHaveLength(0);
    expect(replay.streets[1].board).toHaveLength(3);
    expect(replay.streets[2].board).toHaveLength(4);
    expect(replay.streets[3].board).toHaveLength(5);
    expect(replay.finalBoard).toHaveLength(5);
    expect(replay.showdown?.players).toHaveLength(2);
    expect(replay.seats.every(seat => seat.reachedShowdown)).toBe(true);
    expect(replay.winners.length).toBeGreaterThan(0);
    expect(replay.winners.map(winner => winner.name).every(name => ['Alice', 'Bob'].includes(name))).toBe(
      true,
    );
  });

  it('keeps fold-complete hands out of showdown data', () => {
    const initial = createHand(TEST_PLAYERS, 0, 5, 10, 'hand-fold');
    const replay = buildReplayHand(
      playHand('hand-fold', [{ type: 'fold', playerId: activePlayerId(initial) }]),
    );

    expect(replay.streets.map(street => street.street)).toEqual(['preflop']);
    expect(replay.streets[0].actions).toHaveLength(1);
    expect(replay.finalBoard).toHaveLength(0);
    expect(replay.showdown).toBeNull();
    expect(replay.seats.some(seat => seat.reachedShowdown)).toBe(false);
    expect(replay.winners).toHaveLength(1);
    expect(replay.winners[0].description).toBeUndefined();
  });
});
