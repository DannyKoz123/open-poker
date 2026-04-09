import type { BettingRound } from '../../types/poker';

export interface PlayerEquityShare {
  playerId: string;
  equity: number;
}

export interface PotEquitySnapshot {
  potIndex: number;
  eligiblePlayerIds: string[];
  players: PlayerEquityShare[];
}

export interface StreetEquitySnapshot {
  street: BettingRound;
  pots: PotEquitySnapshot[];
}
