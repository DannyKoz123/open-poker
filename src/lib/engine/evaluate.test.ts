import { describe, expect, it } from 'bun:test';
import { evaluateHand, compareHands } from './evaluate';
import type { Card } from '../types/poker';

function c(str: string): Card {
  return { rank: str[0] as Card['rank'], suit: str[1] as Card['suit'] };
}

describe('evaluateHand', () => {
  it('detects royal flush', () => {
    const hole: [Card, Card] = [c('Ah'), c('Kh')];
    const community = [c('Qh'), c('Jh'), c('Th'), c('2d'), c('3c')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('royal-flush');
  });

  it('detects straight flush', () => {
    const hole: [Card, Card] = [c('5h'), c('6h')];
    const community = [c('7h'), c('8h'), c('9h'), c('2d'), c('3c')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('straight-flush');
  });

  it('detects four of a kind', () => {
    const hole: [Card, Card] = [c('Ah'), c('Ad')];
    const community = [c('Ac'), c('As'), c('Kh'), c('2d'), c('3c')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('four-of-a-kind');
  });

  it('detects full house', () => {
    const hole: [Card, Card] = [c('Ah'), c('Ad')];
    const community = [c('Ac'), c('Ks'), c('Kh'), c('2d'), c('3c')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('full-house');
  });

  it('detects flush', () => {
    const hole: [Card, Card] = [c('Ah'), c('9h')];
    const community = [c('6h'), c('3h'), c('2h'), c('Kd'), c('Qc')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('flush');
  });

  it('detects straight', () => {
    const hole: [Card, Card] = [c('5h'), c('6d')];
    const community = [c('7c'), c('8s'), c('9h'), c('2d'), c('3c')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('straight');
  });

  it('detects wheel (A-2-3-4-5)', () => {
    const hole: [Card, Card] = [c('Ah'), c('2d')];
    const community = [c('3c'), c('4s'), c('5h'), c('Kd'), c('Qc')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('straight');
  });

  it('detects three of a kind', () => {
    const hole: [Card, Card] = [c('Ah'), c('Ad')];
    const community = [c('Ac'), c('Ks'), c('7h'), c('2d'), c('3c')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('three-of-a-kind');
  });

  it('detects two pair', () => {
    const hole: [Card, Card] = [c('Ah'), c('Kd')];
    const community = [c('Ac'), c('Ks'), c('7h'), c('2d'), c('3c')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('two-pair');
  });

  it('detects pair', () => {
    const hole: [Card, Card] = [c('Ah'), c('Kd')];
    const community = [c('Ac'), c('9s'), c('7h'), c('2d'), c('3c')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('pair');
  });

  it('detects high card', () => {
    const hole: [Card, Card] = [c('Ah'), c('Kd')];
    const community = [c('9c'), c('7s'), c('5h'), c('2d'), c('3c')];
    const result = evaluateHand(hole, community);
    expect(result.rank).toBe('high-card');
  });

  it('ranks hands correctly: flush beats straight', () => {
    const flushHole: [Card, Card] = [c('Ah'), c('9h')];
    const flushCommunity = [c('6h'), c('3h'), c('2h'), c('Kd'), c('Qc')];

    const straightHole: [Card, Card] = [c('5d'), c('6c')];
    const straightCommunity = [c('7s'), c('8h'), c('9d'), c('2c'), c('3s')];

    const flush = evaluateHand(flushHole, flushCommunity);
    const straight = evaluateHand(straightHole, straightCommunity);

    expect(compareHands(flush, straight)).toBeGreaterThan(0);
  });

  it('ranks hands correctly: pair of aces beats pair of kings', () => {
    const acesHole: [Card, Card] = [c('Ah'), c('Ad')];
    const acesCommunity = [c('9c'), c('7s'), c('5h'), c('2d'), c('3c')];

    const kingsHole: [Card, Card] = [c('Kh'), c('Kd')];
    const kingsCommunity = [c('9c'), c('7s'), c('5h'), c('2d'), c('3c')];

    const aces = evaluateHand(acesHole, acesCommunity);
    const kings = evaluateHand(kingsHole, kingsCommunity);

    expect(compareHands(aces, kings)).toBeGreaterThan(0);
  });

  it('detects tie correctly', () => {
    const hole1: [Card, Card] = [c('2h'), c('3d')];
    const hole2: [Card, Card] = [c('2d'), c('3h')];
    const community = [c('Ac'), c('Ks'), c('Qh'), c('Jd'), c('9c')];

    const hand1 = evaluateHand(hole1, community);
    const hand2 = evaluateHand(hole2, community);

    // Both should play the board (A-K-Q-J-9)
    expect(compareHands(hand1, hand2)).toBe(0);
  });
});
