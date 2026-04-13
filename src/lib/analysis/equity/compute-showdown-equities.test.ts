import { describe, expect, it } from 'bun:test';
import { applyAction, createHand } from '../../engine';
import { cardToString, createDeck } from '../../engine/deck';
import type { PersistedHandRecord } from '../../server/store/types';
import type { Action, Card, GameState } from '../../types/poker';
import { computeShowdownEquities } from './compute-showdown-equities';

const TEST_PLAYERS = [
  { id: 'p1', name: 'Alice', chips: 100 },
  { id: 'p2', name: 'Bob', chips: 100 },
];

function activePlayerId(state: GameState): string {
  return state.players[state.activePlayerIndex].id;
}

function buildDeck(runout: Card[], holeCards: [Card, Card][]): Card[] {
  const excluded = new Set<string>([...runout, ...holeCards.flat()].map(card => cardToString(card)));
  return [...runout, ...createDeck().filter(card => !excluded.has(cardToString(card)))];
}

function buildAllInShowdownHand(
  handId: string,
  playerCards: Record<string, [Card, Card]>,
  runout: [Card, Card, Card, Card, Card],
): PersistedHandRecord {
  const initialState = createHand(TEST_PLAYERS, 0, 5, 10, handId);
  const customizedInitialState: GameState = {
    ...initialState,
    players: initialState.players.map(player => ({
      ...player,
      holeCards: playerCards[player.id],
    })),
    deck: buildDeck(runout, Object.values(playerCards)),
  };

  let state = customizedInitialState;
  const actions: Action[] = [{ type: 'all-in', playerId: activePlayerId(state) }];
  state = applyAction(state, actions[0]);
  actions.push({ type: 'call', playerId: activePlayerId(state) });
  state = applyAction(state, actions[1]);

  if (state.phase !== 'hand-complete') {
    throw new Error(`Expected scripted hand ${handId} to finish, got ${state.phase}`);
  }

  return {
    schemaVersion: 1,
    handId,
    roomId: 'room-equity',
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
    initialState: customizedInitialState,
    actions: actions.map((action, index) => ({
      seq: index + 1,
      ts: 1_000 + index,
      action,
    })),
    finalState: state,
    winners: state.winners.map(winner => ({
      playerId: winner.playerId,
      amount: winner.amount,
      description: winner.hand?.description,
    })),
  };
}

describe('computeShowdownEquities', () => {
  it('computes exact flop, turn, and river equities from revealed showdown cards', () => {
    const hand = buildAllInShowdownHand(
      'equity-pair-overpair',
      {
        p1: [
          { rank: 'A', suit: 'h' },
          { rank: 'A', suit: 's' },
        ],
        p2: [
          { rank: 'K', suit: 'c' },
          { rank: 'K', suit: 'h' },
        ],
      },
      [
        { rank: '2', suit: 'd' },
        { rank: '7', suit: 's' },
        { rank: '9', suit: 'c' },
        { rank: 'T', suit: 'd' },
        { rank: '3', suit: 'c' },
      ],
    );

    const snapshots = computeShowdownEquities(hand);
    expect(snapshots.map(snapshot => snapshot.street)).toEqual(['flop', 'turn', 'river']);

    const flopPlayers = snapshots[0].pots[0].players;
    expect(flopPlayers).toEqual([
      { playerId: 'p1', equity: 907 / 990 },
      { playerId: 'p2', equity: 83 / 990 },
    ]);

    const turnPlayers = snapshots[1].pots[0].players;
    expect(turnPlayers).toEqual([
      { playerId: 'p1', equity: 42 / 44 },
      { playerId: 'p2', equity: 2 / 44 },
    ]);

    const riverPlayers = snapshots[2].pots[0].players;
    expect(riverPlayers).toEqual([
      { playerId: 'p1', equity: 1 },
      { playerId: 'p2', equity: 0 },
    ]);
  });

  it('splits river equity across ties', () => {
    const hand = buildAllInShowdownHand(
      'equity-river-chop',
      {
        p1: [
          { rank: '2', suit: 'h' },
          { rank: '3', suit: 'd' },
        ],
        p2: [
          { rank: '4', suit: 'c' },
          { rank: '5', suit: 's' },
        ],
      },
      [
        { rank: 'A', suit: 'h' },
        { rank: 'A', suit: 'd' },
        { rank: 'K', suit: 'c' },
        { rank: 'K', suit: 'd' },
        { rank: 'Q', suit: 's' },
      ],
    );

    const riverPlayers = computeShowdownEquities(hand)[2].pots[0].players;
    expect(riverPlayers).toEqual([
      { playerId: 'p1', equity: 0.5 },
      { playerId: 'p2', equity: 0.5 },
    ]);
  });

  it('skips equity when fewer than two showdown hands were revealed', () => {
    const hand = buildAllInShowdownHand(
      'equity-hidden-cards',
      {
        p1: [
          { rank: 'A', suit: 'h' },
          { rank: 'A', suit: 's' },
        ],
        p2: [
          { rank: 'K', suit: 'c' },
          { rank: 'K', suit: 'h' },
        ],
      },
      [
        { rank: '2', suit: 'd' },
        { rank: '7', suit: 's' },
        { rank: '9', suit: 'c' },
        { rank: 'T', suit: 'd' },
        { rank: '3', suit: 'c' },
      ],
    );

    if (!hand.finalState) {
      throw new Error('Expected completed hand to have final state');
    }

    hand.finalState.players = hand.finalState.players.map(player =>
      player.id === 'p2' ? { ...player, holeCards: null } : player,
    );

    expect(computeShowdownEquities(hand)).toEqual([]);
  });
});
