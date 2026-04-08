import type { GameState, Action, Player, Phase, AvailableActions, Pot, Card } from '../types/poker';
import { createDeck, shuffleDeck, deal } from './deck';
import { evaluateHand, compareHands } from './evaluate';

/**
 * Create the initial game state for a new hand.
 * This is the only function that uses randomness (deck shuffle).
 * All subsequent state transitions are pure.
 */
export function createHand(
  players: { id: string; name: string; chips: number }[],
  dealerIndex: number,
  smallBlind: number,
  bigBlind: number,
  handId?: string,
): GameState {
  const activePlayers = players.filter(p => p.chips > 0);
  if (activePlayers.length < 2) {
    throw new Error('Need at least 2 players with chips to start a hand');
  }

  const deck = shuffleDeck(createDeck());
  const gamePlayers: Player[] = players.map(p => ({
    id: p.id,
    name: p.name,
    chips: p.chips,
    holeCards: null,
    status: p.chips > 0 ? 'active' : 'sitting-out',
    currentBet: 0,
    totalBet: 0,
  }));

  const state: GameState = {
    handId: handId || crypto.randomUUID(),
    players: gamePlayers,
    dealerIndex,
    activePlayerIndex: -1,
    communityCards: [],
    deck,
    phase: 'waiting',
    pots: [{ amount: 0, eligible: [] }],
    currentBet: 0,
    minRaise: bigBlind,
    smallBlind,
    bigBlind,
    lastRaiserIndex: null,
    actionsThisRound: 0,
    winners: [],
  };

  return dealPreflop(state);
}

/** Deal hole cards and post blinds. */
function dealPreflop(state: GameState): GameState {
  let s = { ...state, players: state.players.map(p => ({ ...p })), deck: [...state.deck] };
  const active = getActiveSeatIndices(s);

  // Deal 2 cards to each active player
  for (const i of active) {
    const [cards, remaining] = deal(s.deck, 2);
    s.players[i].holeCards = cards as [Card, Card];
    s.deck = remaining;
  }

  // Post blinds
  const sbIndex = active.length === 2
    ? s.dealerIndex  // Heads-up: dealer posts SB
    : nextActiveIndex(s, s.dealerIndex);
  const bbIndex = nextActiveIndex(s, sbIndex);

  s = postBlind(s, sbIndex, s.smallBlind);
  s = postBlind(s, bbIndex, s.bigBlind);

  s.currentBet = s.bigBlind;
  s.minRaise = s.bigBlind;
  s.phase = 'preflop';

  // Action starts left of BB (or SB in heads-up)
  s.activePlayerIndex = nextActiveIndex(s, bbIndex);
  s.lastRaiserIndex = bbIndex; // BB is the "last raiser" for preflop
  s.actionsThisRound = 0;

  // Update pot eligible list
  s.pots[0].eligible = active.map(i => s.players[i].id);

  return s;
}

function postBlind(state: GameState, playerIndex: number, amount: number): GameState {
  const s = { ...state, players: state.players.map(p => ({ ...p })), pots: state.pots.map(p => ({ ...p, eligible: [...p.eligible] })) };
  const player = s.players[playerIndex];
  const actual = Math.min(amount, player.chips);
  player.chips -= actual;
  player.currentBet = actual;
  player.totalBet = actual;
  s.pots[0].amount += actual;
  if (player.chips === 0) {
    player.status = 'all-in';
  }
  return s;
}

/**
 * Apply an action to the game state. Returns the new state.
 * This is the core pure function: (GameState, Action) => GameState
 */
export function applyAction(state: GameState, action: Action): GameState {
  // Validate it's the right player's turn
  const activePlayer = state.players[state.activePlayerIndex];
  if (!activePlayer || activePlayer.id !== action.playerId) {
    throw new Error(`Not ${action.playerId}'s turn. Expected ${activePlayer?.id}`);
  }

  if (state.phase === 'waiting' || state.phase === 'showdown' || state.phase === 'hand-complete') {
    throw new Error(`Cannot act during ${state.phase} phase`);
  }

  const available = getAvailableActions(state);

  let s: GameState;
  switch (action.type) {
    case 'fold':
      if (!available.canFold) throw new Error('Cannot fold');
      s = applyFold(state);
      break;
    case 'check':
      if (!available.canCheck) throw new Error('Cannot check');
      s = applyCheck(state);
      break;
    case 'call':
      if (!available.canCall) throw new Error('Cannot call');
      s = applyCall(state);
      break;
    case 'raise':
      if (!available.canRaise) throw new Error('Cannot raise');
      if (action.amount === undefined) throw new Error('Raise requires an amount');
      if (action.amount < available.minRaise || action.amount > available.maxRaise) {
        throw new Error(`Raise amount ${action.amount} out of range [${available.minRaise}, ${available.maxRaise}]`);
      }
      s = applyRaise(state, action.amount);
      break;
    case 'all-in':
      if (!available.canAllIn) throw new Error('Cannot go all-in');
      s = applyAllIn(state);
      break;
    default:
      throw new Error(`Unknown action type: ${(action as Action).type}`);
  }

  return advanceGame(s);
}

function applyFold(state: GameState): GameState {
  const s = cloneState(state);
  s.players[s.activePlayerIndex].status = 'folded';
  s.actionsThisRound++;
  return s;
}

function applyCheck(state: GameState): GameState {
  const s = cloneState(state);
  s.actionsThisRound++;
  return s;
}

function applyCall(state: GameState): GameState {
  const s = cloneState(state);
  const player = s.players[s.activePlayerIndex];
  const callAmount = Math.min(s.currentBet - player.currentBet, player.chips);
  player.chips -= callAmount;
  player.currentBet += callAmount;
  player.totalBet += callAmount;
  s.pots[0].amount += callAmount;
  if (player.chips === 0) {
    player.status = 'all-in';
  }
  s.actionsThisRound++;
  return s;
}

function applyRaise(state: GameState, totalBet: number): GameState {
  const s = cloneState(state);
  const player = s.players[s.activePlayerIndex];
  const raiseAmount = totalBet - player.currentBet;
  player.chips -= raiseAmount;
  player.currentBet = totalBet;
  player.totalBet += raiseAmount;
  s.pots[0].amount += raiseAmount;
  s.minRaise = totalBet - s.currentBet + totalBet; // min next raise = current raise size + new total
  s.currentBet = totalBet;
  s.lastRaiserIndex = s.activePlayerIndex;
  s.actionsThisRound = 1; // Reset: everyone needs to act again
  if (player.chips === 0) {
    player.status = 'all-in';
  }
  return s;
}

function applyAllIn(state: GameState): GameState {
  const s = cloneState(state);
  const player = s.players[s.activePlayerIndex];
  const allInAmount = player.chips;
  const newBet = player.currentBet + allInAmount;
  player.chips = 0;
  player.currentBet = newBet;
  player.totalBet += allInAmount;
  s.pots[0].amount += allInAmount;
  player.status = 'all-in';

  if (newBet > s.currentBet) {
    const raiseSize = newBet - s.currentBet;
    if (raiseSize >= s.minRaise) {
      // Full raise: reopens betting
      s.minRaise = raiseSize + newBet;
      s.lastRaiserIndex = s.activePlayerIndex;
      s.actionsThisRound = 1;
    }
    s.currentBet = newBet;
  }
  if (s.actionsThisRound >= 0) s.actionsThisRound++;
  return s;
}

/**
 * After an action, check if the betting round is complete and advance the game.
 */
function advanceGame(state: GameState): GameState {
  let s = state;

  // Check if only one player remains (everyone else folded)
  const remaining = s.players.filter(p => p.status === 'active' || p.status === 'all-in');
  if (remaining.length === 1) {
    return awardPotToLastPlayer(s, remaining[0].id);
  }

  // Check if betting round is complete
  if (isBettingRoundComplete(s)) {
    s = buildSidePots(s);
    s = advancePhase(s);
  } else {
    // Move to next active player
    s = { ...s, activePlayerIndex: nextActivePlayerIndex(s) };
  }

  return s;
}

function isBettingRoundComplete(state: GameState): boolean {
  const activePlayers = state.players.filter(p => p.status === 'active');

  // If no active players (all folded or all-in), round is complete
  if (activePlayers.length === 0) return true;

  // If only one active player and everyone else is folded or all-in
  if (activePlayers.length === 1) {
    const othersAllIn = state.players.filter(p => p.status === 'all-in').length;
    if (othersAllIn > 0 && activePlayers[0].currentBet >= state.currentBet) return true;
  }

  // All active players must have matched the current bet and had a chance to act
  const allMatched = activePlayers.every(p => p.currentBet === state.currentBet);
  if (!allMatched) return false;

  // Everyone who can act has acted
  const totalWhoCanAct = activePlayers.length;
  return state.actionsThisRound >= totalWhoCanAct;
}

function advancePhase(state: GameState): GameState {
  const s = cloneState(state);

  // Reset per-round state
  for (const p of s.players) {
    p.currentBet = 0;
  }
  s.currentBet = 0;
  s.lastRaiserIndex = null;
  s.actionsThisRound = 0;

  const nextPhase: Record<string, Phase> = {
    preflop: 'flop',
    flop: 'turn',
    turn: 'river',
    river: 'showdown',
  };

  s.phase = nextPhase[s.phase] || 'showdown';

  // Deal community cards
  if (s.phase === 'flop') {
    const [cards, remaining] = deal(s.deck, 3);
    s.communityCards = [...s.communityCards, ...cards];
    s.deck = remaining;
  } else if (s.phase === 'turn' || s.phase === 'river') {
    const [cards, remaining] = deal(s.deck, 1);
    s.communityCards = [...s.communityCards, ...cards];
    s.deck = remaining;
  }

  if (s.phase === 'showdown') {
    return resolveShowdown(s);
  }

  // Check if we need to run out remaining cards (all players all-in)
  const activePlayers = s.players.filter(p => p.status === 'active');
  if (activePlayers.length === 0) {
    // Everyone is all-in or folded, deal remaining boards
    return runOutBoard(s);
  }

  // Set first active player (left of dealer)
  s.activePlayerIndex = nextActiveIndex(s, s.dealerIndex);
  s.minRaise = s.bigBlind;

  return s;
}

/** Deal remaining community cards when all players are all-in */
function runOutBoard(state: GameState): GameState {
  let s = cloneState(state);

  while (s.communityCards.length < 5) {
    const [cards, remaining] = deal(s.deck, 1);
    s.communityCards = [...s.communityCards, ...cards];
    s.deck = remaining;
  }

  s.phase = 'showdown';
  return resolveShowdown(s);
}

/**
 * Build side pots from players' totalBet values.
 */
function buildSidePots(state: GameState): GameState {
  const s = cloneState(state);

  // Collect all players who put money in
  const bettors = s.players
    .filter(p => p.totalBet > 0)
    .map(p => ({ id: p.id, totalBet: p.totalBet, status: p.status }))
    .sort((a, b) => a.totalBet - b.totalBet);

  if (bettors.length === 0) return s;

  // Only build side pots if someone is all-in with less than the max bet
  const allInPlayers = bettors.filter(b => s.players.find(p => p.id === b.id)?.status === 'all-in');
  if (allInPlayers.length === 0) return s; // No side pots needed

  const pots: Pot[] = [];
  let previousLevel = 0;

  // Get unique bet levels from all-in players
  const betLevels = [...new Set(bettors.map(b => b.totalBet))].sort((a, b) => a - b);

  for (const level of betLevels) {
    const contribution = level - previousLevel;
    if (contribution <= 0) continue;

    const eligible = bettors
      .filter(b => b.totalBet >= level && s.players.find(p => p.id === b.id)?.status !== 'folded')
      .map(b => b.id);

    const contributors = bettors.filter(b => b.totalBet >= level);
    const potAmount = contribution * contributors.length;

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligible });
    }
    previousLevel = level;
  }

  // If pots were created, replace the existing pot structure
  if (pots.length > 0) {
    s.pots = pots;
  }

  return s;
}

function resolveShowdown(state: GameState): GameState {
  const s = cloneState(state);
  s.phase = 'hand-complete';

  const contenders = s.players.filter(p => p.status !== 'folded' && p.holeCards);

  // Evaluate all hands
  const evaluations = contenders.map(p => ({
    playerId: p.id,
    hand: evaluateHand(p.holeCards!, s.communityCards),
  }));

  const winners: { playerId: string; amount: number; hand?: ReturnType<typeof evaluateHand> }[] = [];

  // Resolve each pot
  for (const pot of s.pots) {
    const potContenders = evaluations.filter(e => pot.eligible.includes(e.playerId));
    if (potContenders.length === 0) continue;

    // Find the best hand(s)
    potContenders.sort((a, b) => compareHands(b.hand, a.hand));
    const bestScore = potContenders[0].hand.score;
    const potWinners = potContenders.filter(e => e.hand.score === bestScore);

    // Split the pot
    const share = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount - share * potWinners.length;

    for (let i = 0; i < potWinners.length; i++) {
      const winAmount = share + (i === 0 ? remainder : 0); // First winner gets remainder
      const existing = winners.find(w => w.playerId === potWinners[i].playerId);
      if (existing) {
        existing.amount += winAmount;
      } else {
        winners.push({
          playerId: potWinners[i].playerId,
          amount: winAmount,
          hand: potWinners[i].hand,
        });
      }
      const player = s.players.find(p => p.id === potWinners[i].playerId)!;
      player.chips += winAmount;
    }
  }

  s.winners = winners;
  return s;
}

function awardPotToLastPlayer(state: GameState, playerId: string): GameState {
  const s = cloneState(state);
  s.phase = 'hand-complete';
  const totalPot = s.pots.reduce((sum, p) => sum + p.amount, 0);
  const winner = s.players.find(p => p.id === playerId)!;
  winner.chips += totalPot;
  s.winners = [{ playerId, amount: totalPot }];
  return s;
}

/** Get available actions for the current active player */
export function getAvailableActions(state: GameState): AvailableActions {
  const player = state.players[state.activePlayerIndex];
  if (!player || player.status !== 'active') {
    return { canFold: false, canCheck: false, canCall: false, callAmount: 0, canRaise: false, minRaise: 0, maxRaise: 0, canAllIn: false, allInAmount: 0 };
  }

  const toCall = state.currentBet - player.currentBet;
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && toCall <= player.chips;
  const callAmount = Math.min(toCall, player.chips);

  const minRaiseTotal = state.currentBet + state.minRaise;
  const maxRaiseTotal = player.chips + player.currentBet;
  const canRaise = player.chips > toCall && maxRaiseTotal >= minRaiseTotal;

  return {
    canFold: true,
    canCheck,
    canCall,
    callAmount,
    canRaise,
    minRaise: Math.min(minRaiseTotal, maxRaiseTotal),
    maxRaise: maxRaiseTotal,
    canAllIn: player.chips > 0,
    allInAmount: player.chips,
  };
}

// --- Helpers ---

function getActiveSeatIndices(state: GameState): number[] {
  return state.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.status !== 'sitting-out')
    .map(({ i }) => i);
}

function nextActiveIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let offset = 1; offset <= n; offset++) {
    const i = (fromIndex + offset) % n;
    if (state.players[i].status === 'active' || state.players[i].status === 'all-in') {
      return i;
    }
  }
  return fromIndex;
}

/** Find next player who can still act (status === 'active') */
function nextActivePlayerIndex(state: GameState): number {
  const n = state.players.length;
  for (let offset = 1; offset <= n; offset++) {
    const i = (state.activePlayerIndex + offset) % n;
    if (state.players[i].status === 'active') {
      return i;
    }
  }
  return state.activePlayerIndex;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map(p => ({ ...p, holeCards: p.holeCards ? [...p.holeCards] as [Card, Card] : null })),
    communityCards: [...state.communityCards],
    deck: [...state.deck],
    pots: state.pots.map(p => ({ ...p, eligible: [...p.eligible] })),
    winners: [...state.winners],
  };
}

/** Get game state sanitized for a specific player (hide other players' cards and deck) */
export function getPlayerView(state: GameState, playerId: string): GameState {
  const s = cloneState(state);
  s.deck = []; // Never show the deck

  for (const p of s.players) {
    if (p.id !== playerId && state.phase !== 'hand-complete') {
      p.holeCards = null; // Hide other players' cards during play
    }
  }

  return s;
}
