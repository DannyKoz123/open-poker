import { applyAction, evaluateHand } from '../../engine';
import { cardToString, createDeck } from '../../engine/deck';
import type { ReplayHand } from '../replay/types';
import { buildReplayHand } from '../replay/build-replay-hand';
import type { PersistedHandRecord } from '../../server/store/types';
import type { BettingRound, Card, GameState, Pot } from '../../types/poker';
import type { PotEquitySnapshot, StreetEquitySnapshot } from './types';

const BETTING_STREETS: BettingRound[] = ['preflop', 'flop', 'turn', 'river'];
const SHOWDOWN_EQUITY_STREETS: BettingRound[] = ['flop', 'turn', 'river'];

function isBettingRound(phase: GameState['phase']): phase is BettingRound {
  return BETTING_STREETS.includes(phase as BettingRound);
}

function clonePots(pots: Pot[]): Pot[] {
  return pots.map(pot => ({
    amount: pot.amount,
    eligible: [...pot.eligible],
  }));
}

function combinations(cards: Card[], count: number): Card[][] {
  if (count === 0) {
    return [[]];
  }

  const result: Card[][] = [];

  function visit(startIndex: number, chosen: Card[]) {
    if (chosen.length === count) {
      result.push([...chosen]);
      return;
    }

    for (let index = startIndex; index <= cards.length - (count - chosen.length); index++) {
      chosen.push(cards[index]);
      visit(index + 1, chosen);
      chosen.pop();
    }
  }

  visit(0, []);
  return result;
}

function recordPotStatesByStreet(hand: PersistedHandRecord): Map<BettingRound, Pot[]> {
  const recorded = new Map<BettingRound, Pot[]>();
  let state = structuredClone(hand.initialState);

  for (const persistedAction of hand.actions) {
    if (!isBettingRound(state.phase)) {
      throw new Error(
        `Equity adapter expected betting round before action ${persistedAction.seq}, got ${state.phase}`,
      );
    }

    const street = state.phase;
    const nextState = applyAction(state, persistedAction.action);

    if (nextState.phase !== street) {
      recorded.set(street, clonePots(nextState.pots));
    }

    state = nextState;
  }

  return recorded;
}

function buildRemainingDeck(board: Card[], revealedHoleCards: [Card, Card][]): Card[] {
  const knownCards = new Set<string>(
    [...board, ...revealedHoleCards.flat()].map(card => cardToString(card)),
  );

  return createDeck().filter(card => !knownCards.has(cardToString(card)));
}

function computePotEquity(
  potIndex: number,
  pot: Pot,
  board: Card[],
  revealedHoleCards: Map<string, [Card, Card]>,
): PotEquitySnapshot | null {
  if (pot.eligible.some(playerId => !revealedHoleCards.has(playerId))) {
    return null;
  }

  const eligiblePlayerIds = [...pot.eligible];
  const remainingBoardCards = 5 - board.length;
  if (remainingBoardCards < 0) {
    throw new Error(`Equity adapter received too many board cards: ${board.length}`);
  }

  const runouts = combinations(
    buildRemainingDeck(board, [...revealedHoleCards.values()]),
    remainingBoardCards,
  );

  const wins = new Map<string, number>(eligiblePlayerIds.map(playerId => [playerId, 0]));

  for (const runout of runouts) {
    const finalBoard = [...board, ...runout];
    const evaluations = eligiblePlayerIds.map(playerId => ({
      playerId,
      hand: evaluateHand(revealedHoleCards.get(playerId)!, finalBoard),
    }));

    const bestScore = Math.max(...evaluations.map(evaluation => evaluation.hand.score));
    const winners = evaluations.filter(evaluation => evaluation.hand.score === bestScore);
    const share = 1 / winners.length;

    for (const winner of winners) {
      wins.set(winner.playerId, (wins.get(winner.playerId) ?? 0) + share);
    }
  }

  return {
    potIndex,
    eligiblePlayerIds,
    players: eligiblePlayerIds.map(playerId => ({
      playerId,
      equity: (wins.get(playerId) ?? 0) / runouts.length,
    })),
  };
}

export function computeShowdownEquities(
  hand: PersistedHandRecord,
  replayHand: ReplayHand = buildReplayHand(hand),
): StreetEquitySnapshot[] {
  const showdownPlayers = replayHand.showdown?.players ?? [];
  if (showdownPlayers.length < 2) {
    return [];
  }

  const revealedHoleCards = new Map(
    showdownPlayers.map(player => [player.playerId, [...player.holeCards] as [Card, Card]]),
  );
  const recordedPotStates = recordPotStatesByStreet(hand);
  const snapshots: StreetEquitySnapshot[] = [];
  let currentPotState: Pot[] | null = null;

  for (const street of replayHand.streets) {
    const recorded = recordedPotStates.get(street.street);
    if (recorded) {
      currentPotState = clonePots(recorded);
    }

    if (!SHOWDOWN_EQUITY_STREETS.includes(street.street) || !currentPotState) {
      continue;
    }

    const pots = currentPotState
      .map((pot, potIndex) => computePotEquity(potIndex, pot, street.board, revealedHoleCards))
      .filter((pot): pot is PotEquitySnapshot => pot !== null);

    if (pots.length === 0) {
      continue;
    }

    snapshots.push({
      street: street.street,
      pots,
    });
  }

  return snapshots;
}
