import type { ActionType, BettingRound, Card, HandEvaluation, PlayerStatus } from '../../types/poker';

export interface ReplaySeat {
  playerId: string;
  name: string;
  seatIndex: number;
  startingChips: number;
  endingChips: number | null;
  chipDelta: number | null;
  finalStatus: PlayerStatus | null;
  reachedShowdown: boolean;
}

export interface ReplayAction {
  seq: number;
  ts: number;
  street: BettingRound;
  playerId: string;
  playerName: string;
  seatIndex: number;
  type: ActionType;
  /** Raw action amount from the engine contract. Raises use total-bet semantics. */
  amount: number | null;
  /** Chips committed by the actor on this action. */
  invested: number;
  potBefore: number;
  potAfter: number;
  playerBetBefore: number;
  playerBetAfter: number;
  playerChipsBefore: number;
  playerChipsAfter: number;
}

export interface ReplayStreet {
  street: BettingRound;
  /** Community cards visible during this street. */
  board: Card[];
  /** Newly revealed community cards for this street. */
  newCards: Card[];
  potAtStart: number;
  potAtEnd: number;
  actions: ReplayAction[];
}

export interface ReplayWinner {
  playerId: string;
  name: string;
  seatIndex: number;
  amount: number;
  description?: string;
}

export interface ReplayShowdownPlayer {
  playerId: string;
  name: string;
  seatIndex: number;
  holeCards: [Card, Card];
  evaluation: HandEvaluation;
}

export interface ReplayShowdown {
  players: ReplayShowdownPlayer[];
}

export interface ReplayHand {
  schemaVersion: 1;
  handId: string;
  roomId: string;
  maxSeats: number;
  startedAt: number;
  completedAt: number;
  smallBlind: number;
  bigBlind: number;
  seats: ReplaySeat[];
  streets: ReplayStreet[];
  finalBoard: Card[];
  winners: ReplayWinner[];
  showdown: ReplayShowdown | null;
}
