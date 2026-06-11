// Types for parsed PokerNow CSV logs.
// These are separate from src/lib/types/poker.ts (live engine types).

export interface PNPlayer {
  /** Stable unique ID from PokerNow, e.g., "eNVKMq2Tcb" */
  id: string;
  /** Most recent display name seen for this player */
  displayName: string;
  /** All display names seen for this ID (handles name changes mid-session) */
  aliases: string[];
}

export interface PNBuyIn {
  playerId: string;
  playerName: string;
  amount: number;
  timestamp: Date;
}

export interface PNCashOut {
  playerId: string;
  playerName: string;
  amount: number;
  timestamp: Date;
}

export type PNActionType =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call'; amount: number }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'all-in-call'; amount: number }
  | { type: 'all-in-raise'; amount: number }
  | { type: 'post-blind'; blind: 'small' | 'big'; amount: number };

export interface PNHandAction {
  playerId: string;
  playerName: string;
  action: PNActionType;
  timestamp: Date;
}

export interface PNCommunityCards {
  flop?: [string, string, string];
  turn?: string;
  river?: string;
}

export interface PNShowdown {
  playerId: string;
  playerName: string;
  cards: [string, string];
}

export interface PNWinner {
  playerId: string;
  playerName: string;
  amount: number;
  handDescription?: string;
  combination?: string;
}

export interface PNHand {
  handNumber: number;
  handId?: string;
  variant: string;
  dealer: { playerId: string; playerName: string };
  playerStacks: { playerId: string; playerName: string; seatNumber: number; stack: number }[];
  actions: PNHandAction[];
  communityCards: PNCommunityCards;
  showdowns: PNShowdown[];
  winners: PNWinner[];
  uncalledBets: { playerId: string; amount: number }[];
  startedAt: Date;
  endedAt: Date;
}

export interface PNSession {
  hands: PNHand[];
  buyIns: PNBuyIn[];
  cashOuts: PNCashOut[];
  players: Map<string, PNPlayer>;
  startedAt: Date;
  endedAt: Date;
}

export interface PNSettlement {
  player: PNPlayer;
  totalBuyIn: number;
  totalCashOut: number;
  netResult: number;
  handsPlayed: number;
}

export interface PNSessionRecap {
  session: PNSession;
  settlements: PNSettlement[];
  stats: {
    totalHands: number;
    durationMs: number;
    biggestPot: { handNumber: number; amount: number };
    biggestWinner: PNSettlement | null;
    biggestLoser: PNSettlement | null;
  };
}
