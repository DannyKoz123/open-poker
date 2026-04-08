// Core poker types shared between engine, server, and client

export type Suit = 'h' | 'd' | 'c' | 's';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type HandRank =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush'
  | 'royal-flush';

export interface HandEvaluation {
  rank: HandRank;
  /** Numeric score for comparison. Higher is better. */
  score: number;
  /** The 5 cards that make the best hand */
  bestCards: Card[];
  description: string;
}

export type BettingRound = 'preflop' | 'flop' | 'turn' | 'river';

export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'sitting-out';

export interface Player {
  id: string;
  name: string;
  chips: number;
  holeCards: [Card, Card] | null;
  status: PlayerStatus;
  currentBet: number;
  /** Total chips invested in this hand (across all rounds) */
  totalBet: number;
}

export interface Pot {
  amount: number;
  /** Player IDs eligible for this pot */
  eligible: string[];
}

export type Phase =
  | 'waiting'     // waiting for enough players
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'hand-complete';

export interface GameState {
  /** Unique hand ID */
  handId: string;
  /** All players at the table (including folded/sitting-out) */
  players: Player[];
  /** Index into players array for dealer button */
  dealerIndex: number;
  /** Index of current player to act */
  activePlayerIndex: number;
  /** Community cards revealed so far */
  communityCards: Card[];
  /** The full deck (for dealing remaining cards). Only used server-side. */
  deck: Card[];
  /** Current phase */
  phase: Phase;
  /** Pots (main + side pots) */
  pots: Pot[];
  /** Current bet amount that players must match */
  currentBet: number;
  /** Minimum raise amount */
  minRaise: number;
  /** Small blind amount */
  smallBlind: number;
  /** Big blind amount */
  bigBlind: number;
  /** Index of last player who raised (to detect when betting round is complete) */
  lastRaiserIndex: number | null;
  /** Number of players who have acted this round */
  actionsThisRound: number;
  /** Winners of the hand (populated after showdown) */
  winners: { playerId: string; amount: number; hand?: HandEvaluation }[];
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

export interface Action {
  type: ActionType;
  playerId: string;
  /** Amount for raise actions (total bet, not the raise increment) */
  amount?: number;
}

/** Actions available to the current player */
export interface AvailableActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaise: number;
  maxRaise: number;
  canAllIn: boolean;
  allInAmount: number;
}
