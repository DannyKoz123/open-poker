import { describe, expect, it } from 'bun:test';
import { createHand, applyAction, getAvailableActions, getPlayerView } from './game';
import type { GameState, Action, Card } from '../types/poker';

function makePlayers(count: number, chips = 1000) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    chips,
  }));
}

describe('createHand', () => {
  it('creates a valid initial state for 2 players', () => {
    const state = createHand(makePlayers(2), 0, 5, 10);
    expect(state.phase).toBe('preflop');
    expect(state.players.length).toBe(2);
    expect(state.communityCards.length).toBe(0);
    // Both players should have hole cards
    for (const p of state.players) {
      expect(p.holeCards).not.toBeNull();
      expect(p.holeCards!.length).toBe(2);
    }
    // Blinds should be posted
    const totalBlinds = state.players.reduce((sum, p) => sum + p.totalBet, 0);
    expect(totalBlinds).toBe(15); // 5 + 10
    expect(state.pots[0].amount).toBe(15);
  });

  it('creates a valid initial state for 6 players', () => {
    const state = createHand(makePlayers(6), 0, 5, 10);
    expect(state.phase).toBe('preflop');
    expect(state.players.length).toBe(6);
    // SB is player index 1 (left of dealer 0), BB is player index 2
    expect(state.players[1].totalBet).toBe(5);  // SB
    expect(state.players[2].totalBet).toBe(10); // BB
    // Action should be on player 3 (UTG)
    expect(state.activePlayerIndex).toBe(3);
  });

  it('handles heads-up blinds correctly', () => {
    const state = createHand(makePlayers(2), 0, 5, 10);
    // Heads-up: dealer posts SB (index 0), other posts BB (index 1)
    expect(state.players[0].totalBet).toBe(5);  // Dealer = SB
    expect(state.players[1].totalBet).toBe(10); // BB
    // Action on dealer/SB first preflop in heads-up
    expect(state.activePlayerIndex).toBe(0);
  });

  it('rejects fewer than 2 players', () => {
    expect(() => createHand(makePlayers(1), 0, 5, 10)).toThrow();
  });
});

describe('applyAction - basic flow', () => {
  it('allows fold', () => {
    const state = createHand(makePlayers(3), 0, 5, 10);
    const active = state.players[state.activePlayerIndex];
    const next = applyAction(state, { type: 'fold', playerId: active.id });
    const foldedPlayer = next.players.find(p => p.id === active.id)!;
    expect(foldedPlayer.status).toBe('folded');
  });

  it('allows call', () => {
    const state = createHand(makePlayers(3), 0, 5, 10);
    const active = state.players[state.activePlayerIndex];
    const next = applyAction(state, { type: 'call', playerId: active.id });
    const calledPlayer = next.players.find(p => p.id === active.id)!;
    expect(calledPlayer.currentBet).toBe(10); // Called the BB
  });

  it('allows raise', () => {
    const state = createHand(makePlayers(3), 0, 5, 10);
    const active = state.players[state.activePlayerIndex];
    const actions = getAvailableActions(state);
    const next = applyAction(state, { type: 'raise', playerId: active.id, amount: actions.minRaise });
    expect(next.currentBet).toBe(actions.minRaise);
  });

  it('rejects action from wrong player', () => {
    const state = createHand(makePlayers(3), 0, 5, 10);
    expect(() => applyAction(state, { type: 'fold', playerId: 'wrong-player' })).toThrow();
  });

  it('completes a hand when all but one fold', () => {
    let state = createHand(makePlayers(3), 0, 5, 10);
    // UTG folds
    state = applyAction(state, { type: 'fold', playerId: state.players[state.activePlayerIndex].id });
    // SB folds
    state = applyAction(state, { type: 'fold', playerId: state.players[state.activePlayerIndex].id });
    // BB wins
    expect(state.phase).toBe('hand-complete');
    expect(state.winners.length).toBe(1);
    expect(state.winners[0].playerId).toBe('p3'); // BB (index 2 = p3)
  });
});

describe('applyAction - full hand', () => {
  it('plays a complete hand to showdown', () => {
    let state = createHand(makePlayers(2), 0, 5, 10);

    // Preflop: SB/dealer calls
    state = applyAction(state, { type: 'call', playerId: state.players[state.activePlayerIndex].id });
    // BB checks
    state = applyAction(state, { type: 'check', playerId: state.players[state.activePlayerIndex].id });

    expect(state.phase).toBe('flop');
    expect(state.communityCards.length).toBe(3);

    // Flop: both check
    state = applyAction(state, { type: 'check', playerId: state.players[state.activePlayerIndex].id });
    state = applyAction(state, { type: 'check', playerId: state.players[state.activePlayerIndex].id });

    expect(state.phase).toBe('turn');
    expect(state.communityCards.length).toBe(4);

    // Turn: both check
    state = applyAction(state, { type: 'check', playerId: state.players[state.activePlayerIndex].id });
    state = applyAction(state, { type: 'check', playerId: state.players[state.activePlayerIndex].id });

    expect(state.phase).toBe('river');
    expect(state.communityCards.length).toBe(5);

    // River: both check
    state = applyAction(state, { type: 'check', playerId: state.players[state.activePlayerIndex].id });
    state = applyAction(state, { type: 'check', playerId: state.players[state.activePlayerIndex].id });

    expect(state.phase).toBe('hand-complete');
    expect(state.winners.length).toBeGreaterThan(0);
    // Total chips should be conserved
    const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChips).toBe(2000);
  });
});

describe('side pots', () => {
  it('creates side pot when short stack goes all-in', () => {
    const players = [
      { id: 'p1', name: 'Player 1', chips: 100 },
      { id: 'p2', name: 'Player 2', chips: 500 },
      { id: 'p3', name: 'Player 3', chips: 500 },
    ];
    let state = createHand(players, 0, 5, 10);

    // p3 (UTG) goes all-in for 100
    state = applyAction(state, { type: 'all-in', playerId: state.players[state.activePlayerIndex].id });
    // p1 (SB) goes all-in for 95 more (has 100 - 5 SB = 95 left)
    state = applyAction(state, { type: 'all-in', playerId: state.players[state.activePlayerIndex].id });
    // p2 (BB) calls 100
    state = applyAction(state, { type: 'call', playerId: state.players[state.activePlayerIndex].id });

    // Hand should complete (all but one all-in)
    expect(state.phase).toBe('hand-complete');
    // Total chips should be conserved
    const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChips).toBe(1100);
  });

  it('handles 3 players all-in at different stack sizes', () => {
    const players = [
      { id: 'p1', name: 'Short', chips: 50 },
      { id: 'p2', name: 'Medium', chips: 200 },
      { id: 'p3', name: 'Deep', chips: 500 },
    ];
    let state = createHand(players, 0, 5, 10);

    // All three go all-in
    // p3 (UTG) all-in for 500
    state = applyAction(state, { type: 'all-in', playerId: state.players[state.activePlayerIndex].id });
    // p1 (SB) all-in for remaining 45
    state = applyAction(state, { type: 'all-in', playerId: state.players[state.activePlayerIndex].id });
    // p2 (BB) all-in for remaining 190
    state = applyAction(state, { type: 'all-in', playerId: state.players[state.activePlayerIndex].id });

    expect(state.phase).toBe('hand-complete');
    // Total chips MUST be conserved
    const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChips).toBe(750);
  });
});

describe('getPlayerView', () => {
  it('hides other players hole cards during play', () => {
    const state = createHand(makePlayers(3), 0, 5, 10);
    const view = getPlayerView(state, 'p1');
    expect(view.players.find(p => p.id === 'p1')!.holeCards).not.toBeNull();
    expect(view.players.find(p => p.id === 'p2')!.holeCards).toBeNull();
    expect(view.players.find(p => p.id === 'p3')!.holeCards).toBeNull();
    expect(view.deck.length).toBe(0);
  });
});

describe('getAvailableActions', () => {
  it('returns correct actions for UTG preflop', () => {
    const state = createHand(makePlayers(3), 0, 5, 10);
    const actions = getAvailableActions(state);
    expect(actions.canFold).toBe(true);
    expect(actions.canCall).toBe(true);
    expect(actions.canCheck).toBe(false);
    expect(actions.callAmount).toBe(10);
    expect(actions.canRaise).toBe(true);
  });

  it('allows check when no bet to match', () => {
    let state = createHand(makePlayers(2), 0, 5, 10);
    // SB calls
    state = applyAction(state, { type: 'call', playerId: state.players[state.activePlayerIndex].id });
    // BB should be able to check
    const actions = getAvailableActions(state);
    expect(actions.canCheck).toBe(true);
  });
});
