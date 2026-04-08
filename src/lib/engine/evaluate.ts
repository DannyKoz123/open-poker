import type { Card, HandEvaluation, HandRank, Rank } from '../types/poker';

const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

function rankValue(rank: Rank): number {
  return RANK_VALUES[rank];
}

/** Sort cards descending by rank value */
function sortDesc(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
}

/**
 * Generate all C(n, k) combinations from an array.
 */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result: T[][] = [];
  const [first, ...rest] = arr;
  // Include first
  for (const combo of combinations(rest, k - 1)) {
    result.push([first, ...combo]);
  }
  // Exclude first
  for (const combo of combinations(rest, k)) {
    result.push(combo);
  }
  return result;
}

/**
 * Evaluate exactly 5 cards and return a hand ranking with numeric score.
 *
 * Score encoding (higher = better):
 *   handCategory * 10^10 + tiebreaker
 *
 * Hand categories: 1=high-card .. 10=royal-flush
 */
function evaluate5(cards: Card[]): { rank: HandRank; score: number; description: string } {
  const sorted = sortDesc(cards);
  const values = sorted.map(c => rankValue(c.rank));
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // Check straight (including A-2-3-4-5 wheel)
  let isStraight = false;
  let straightHigh = 0;
  if (values[0] - values[4] === 4 && new Set(values).size === 5) {
    isStraight = true;
    straightHigh = values[0];
  }
  // Wheel: A-5-4-3-2
  if (values[0] === 14 && values[1] === 5 && values[2] === 4 && values[3] === 3 && values[4] === 2) {
    isStraight = true;
    straightHigh = 5; // 5-high straight
  }

  // Count ranks
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const groups = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]); // sort by count desc, then value desc

  const pattern = groups.map(g => g[1]).join('');

  // Encode tiebreaker from group values (most important groups first)
  function tiebreaker(vals: number[]): number {
    let score = 0;
    for (let i = 0; i < vals.length; i++) {
      score += vals[i] * Math.pow(15, vals.length - 1 - i);
    }
    return score;
  }

  const groupValues = groups.map(g => g[0]);
  const tb = tiebreaker(groupValues);
  const CAT = 1e10;

  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return { rank: 'royal-flush', score: 10 * CAT + straightHigh, description: 'Royal Flush' };
    }
    return { rank: 'straight-flush', score: 9 * CAT + straightHigh, description: `Straight Flush, ${straightHigh}-high` };
  }
  if (pattern === '41') {
    return { rank: 'four-of-a-kind', score: 8 * CAT + tb, description: `Four of a Kind, ${rankName(groups[0][0])}s` };
  }
  if (pattern === '32') {
    return { rank: 'full-house', score: 7 * CAT + tb, description: `Full House, ${rankName(groups[0][0])}s full of ${rankName(groups[1][0])}s` };
  }
  if (isFlush) {
    return { rank: 'flush', score: 6 * CAT + tb, description: `Flush, ${rankName(values[0])}-high` };
  }
  if (isStraight) {
    return { rank: 'straight', score: 5 * CAT + straightHigh, description: `Straight, ${rankName(straightHigh)}-high` };
  }
  if (pattern === '311') {
    return { rank: 'three-of-a-kind', score: 4 * CAT + tb, description: `Three of a Kind, ${rankName(groups[0][0])}s` };
  }
  if (pattern === '221') {
    return { rank: 'two-pair', score: 3 * CAT + tb, description: `Two Pair, ${rankName(groups[0][0])}s and ${rankName(groups[1][0])}s` };
  }
  if (pattern === '2111') {
    return { rank: 'pair', score: 2 * CAT + tb, description: `Pair of ${rankName(groups[0][0])}s` };
  }
  return { rank: 'high-card', score: 1 * CAT + tb, description: `${rankName(values[0])}-high` };
}

function rankName(value: number): string {
  const names: Record<number, string> = {
    2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven',
    8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
  };
  return names[value] || String(value);
}

/**
 * Find the best 5-card hand from 7 cards (2 hole + 5 community).
 * Evaluates all C(7,5) = 21 combinations.
 */
export function evaluateHand(holeCards: [Card, Card], communityCards: Card[]): HandEvaluation {
  const allCards = [...holeCards, ...communityCards];
  const combos = combinations(allCards, 5);

  let best: { rank: HandRank; score: number; bestCards: Card[]; description: string } | null = null;

  for (const combo of combos) {
    const result = evaluate5(combo);
    if (!best || result.score > best.score) {
      best = { ...result, bestCards: sortDesc(combo) };
    }
  }

  return best!;
}

/** Compare two hand evaluations. Returns positive if a > b, negative if a < b, 0 if tie. */
export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  return a.score - b.score;
}
