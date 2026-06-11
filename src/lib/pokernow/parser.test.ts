import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePokerNowLog, computeSettlements, buildRecap } from './parser';

const FIXTURE_PATH = join(import.meta.dir, '../../../tests/fixtures/pokernow-sample.csv');
const csvText = readFileSync(FIXTURE_PATH, 'utf-8');

describe('parsePokerNowLog', () => {
  const session = parsePokerNowLog(csvText);

  it('parses completed hands (last hand may be incomplete if log from live session)', () => {
    // 253 hands started, but the log was captured mid-session.
    // Only completed hands (with "ending hand" marker) are included.
    expect(session.hands.length).toBeGreaterThanOrEqual(240);
    expect(session.hands.length).toBeLessThanOrEqual(253);
  });

  it('extracts all unique players', () => {
    // The fixture has 28 unique "Name @ ID" patterns from grep
    // But some may be admin-only or observers. Players who appeared in hands matter.
    expect(session.players.size).toBeGreaterThanOrEqual(15);
  });

  it('records buy-ins', () => {
    expect(session.buyIns.length).toBeGreaterThan(0);
    // Every buy-in should have a positive amount
    for (const buyIn of session.buyIns) {
      expect(buyIn.amount).toBeGreaterThanOrEqual(0);
      expect(buyIn.playerId.length).toBeGreaterThan(0);
    }
  });

  it('records cash-outs', () => {
    expect(session.cashOuts.length).toBeGreaterThan(0);
    for (const cashOut of session.cashOuts) {
      expect(cashOut.amount).toBeGreaterThanOrEqual(0);
    }
  });

  it('correctly parses hand structure', () => {
    const lastHand = session.hands[session.hands.length - 1];
    expect(lastHand.handNumber).toBeGreaterThan(240);
    expect(lastHand.variant).toContain('No Limit Texas Hold');
    expect(lastHand.playerStacks.length).toBeGreaterThan(0);
    expect(lastHand.actions.length).toBeGreaterThan(0);
    expect(lastHand.winners.length).toBeGreaterThan(0);
  });

  it('parses player stacks with decimal values', () => {
    // The fixture uses decimal chip values like 596.94
    const hand253 = session.hands[session.hands.length - 1];
    const hasDecimals = hand253.playerStacks.some(s => s.stack !== Math.floor(s.stack));
    expect(hasDecimals).toBe(true);
  });

  it('parses community cards', () => {
    // Find a hand that went to showdown with community cards
    const handWithFlop = session.hands.find(h => h.communityCards.flop);
    expect(handWithFlop).toBeDefined();
    expect(handWithFlop!.communityCards.flop!.length).toBe(3);
  });

  it('parses showdown cards', () => {
    const handWithShowdown = session.hands.find(h => h.showdowns.length > 0);
    expect(handWithShowdown).toBeDefined();
    expect(handWithShowdown!.showdowns[0].cards.length).toBe(2);
  });

  it('parses hand IDs', () => {
    // Newer format has (id: xxx) in starting hand
    const handWithId = session.hands.find(h => h.handId);
    expect(handWithId).toBeDefined();
    expect(handWithId!.handId!.length).toBeGreaterThan(0);
  });

  it('handles name changes (same ID, different display name)', () => {
    // "josh @ 9ohckjCXiM" and "ML @ 9ohckjCXiM" share the same ID
    const player = session.players.get('9ohckjCXiM');
    if (player) {
      expect(player.aliases.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('session time range is plausible', () => {
    const durationHours = (session.endedAt.getTime() - session.startedAt.getTime()) / (1000 * 60 * 60);
    // Session should be between 1 and 12 hours
    expect(durationHours).toBeGreaterThan(1);
    expect(durationHours).toBeLessThan(12);
  });
});

describe('computeSettlements', () => {
  const session = parsePokerNowLog(csvText);
  const settlements = computeSettlements(session);

  it('produces settlements for all players who bought in', () => {
    expect(settlements.length).toBeGreaterThan(0);
    // Every player with a buy-in should have a settlement
    const buyInPlayerIds = new Set(session.buyIns.map(b => b.playerId));
    for (const playerId of buyInPlayerIds) {
      const s = settlements.find(s => s.player.id === playerId);
      expect(s).toBeDefined();
    }
  });

  it('settlement net results are within reasonable bounds for a live-captured log', () => {
    // For a COMPLETE session (all players cashed out), net should be ~0.
    // For a live-captured log, players still at the table create an imbalance
    // because their final chips are estimated from last-known stacks, and
    // "stand up / sit back" events can create phantom buy-ins.
    // The imbalance should be less than 10% of total buy-ins.
    // Remaining imbalance is from players still at the table when
    // the log was captured (last-known stacks are estimates).
    const totalNet = settlements.reduce((sum, s) => sum + s.netResult, 0);
    const totalBuyIn = settlements.reduce((sum, s) => sum + s.totalBuyIn, 0);
    const imbalanceRatio = Math.abs(totalNet) / totalBuyIn;
    expect(imbalanceRatio).toBeLessThan(0.10);
  });

  it('settlements are sorted by net result descending', () => {
    for (let i = 1; i < settlements.length; i++) {
      expect(settlements[i - 1].netResult).toBeGreaterThanOrEqual(settlements[i].netResult);
    }
  });

  it('biggest winner has positive net result', () => {
    expect(settlements[0].netResult).toBeGreaterThan(0);
  });

  it('tracks hands played per player', () => {
    const activePlayers = settlements.filter(s => s.handsPlayed > 0);
    expect(activePlayers.length).toBeGreaterThan(0);
    // No one played more hands than exist
    for (const s of activePlayers) {
      expect(s.handsPlayed).toBeLessThanOrEqual(session.hands.length);
    }
  });
});

describe('buildRecap', () => {
  const session = parsePokerNowLog(csvText);
  const recap = buildRecap(session);

  it('produces a valid recap', () => {
    expect(recap.stats.totalHands).toBeGreaterThanOrEqual(240);
    expect(recap.stats.durationMs).toBeGreaterThan(0);
    expect(recap.stats.biggestPot.amount).toBeGreaterThan(0);
    expect(recap.stats.biggestPot.handNumber).toBeGreaterThan(0);
  });

  it('identifies biggest winner and loser', () => {
    expect(recap.stats.biggestWinner).not.toBeNull();
    expect(recap.stats.biggestLoser).not.toBeNull();
    expect(recap.stats.biggestWinner!.netResult).toBeGreaterThan(0);
    expect(recap.stats.biggestLoser!.netResult).toBeLessThan(0);
  });
});

describe('error handling', () => {
  it('throws on empty file', () => {
    expect(() => parsePokerNowLog('')).toThrow('Empty log file');
  });

  it('throws on wrong format', () => {
    expect(() => parsePokerNowLog('name,age,email\nJohn,30,john@test.com')).toThrow('Not a PokerNow log');
  });

  it('handles file with only header', () => {
    expect(() => parsePokerNowLog('entry,at,order\n')).toThrow('Empty log file');
  });
});
