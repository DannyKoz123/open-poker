import { applyAction, evaluateHand } from '../../engine';
import type { PersistedHandRecord } from '../../server/store/types';
import type { BettingRound, Card, GameState, Player } from '../../types/poker';
import type {
  ReplayAction,
  ReplayHand,
  ReplaySeat,
  ReplayShowdownPlayer,
  ReplayStreet,
  ReplayWinner,
} from './types';

const STREETS: BettingRound[] = ['preflop', 'flop', 'turn', 'river'];

function isBettingRound(phase: GameState['phase']): phase is BettingRound {
  return STREETS.includes(phase as BettingRound);
}

function totalPot(state: GameState): number {
  return state.pots.reduce((sum, pot) => sum + pot.amount, 0);
}

function streetBoard(street: BettingRound, communityCards: Card[]): Card[] {
  switch (street) {
    case 'preflop':
      return [];
    case 'flop':
      return communityCards.slice(0, 3);
    case 'turn':
      return communityCards.slice(0, 4);
    case 'river':
      return communityCards.slice(0, 5);
  }
}

function streetNewCards(street: BettingRound, board: Card[]): Card[] {
  switch (street) {
    case 'preflop':
      return [];
    case 'flop':
      return board.slice(0, 3);
    case 'turn':
      return board.slice(3, 4);
    case 'river':
      return board.slice(4, 5);
  }
}

function ensureStreet(streets: ReplayStreet[], street: BettingRound, state: GameState): ReplayStreet {
  const existing = streets.find(entry => entry.street === street);
  if (existing) {
    return existing;
  }

  const board = streetBoard(street, state.communityCards);
  const pot = totalPot(state);
  const entry: ReplayStreet = {
    street,
    board: [...board],
    newCards: streetNewCards(street, board),
    potAtStart: pot,
    potAtEnd: pot,
    actions: [],
  };

  const insertAt = streets.findIndex(candidate => STREETS.indexOf(candidate.street) > STREETS.indexOf(street));
  if (insertAt === -1) {
    streets.push(entry);
  } else {
    streets.splice(insertAt, 0, entry);
  }

  return entry;
}

function revealStreetEntries(streets: ReplayStreet[], state: GameState) {
  ensureStreet(streets, 'preflop', state);

  if (state.communityCards.length >= 3) {
    ensureStreet(streets, 'flop', state);
  }
  if (state.communityCards.length >= 4) {
    ensureStreet(streets, 'turn', state);
  }
  if (state.communityCards.length >= 5) {
    ensureStreet(streets, 'river', state);
  }
}

function getPlayerById(state: GameState, playerId: string): Player {
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player) {
    throw new Error(`Replay adapter could not find player ${playerId} in hand ${state.handId}`);
  }
  return player;
}

function buildReplayAction(
  street: BettingRound,
  playerName: string,
  seatIndex: number,
  beforeState: GameState,
  afterState: GameState,
  persistedAction: PersistedHandRecord['actions'][number],
): ReplayAction {
  const beforePlayer = getPlayerById(beforeState, persistedAction.action.playerId);
  const afterPlayer = getPlayerById(afterState, persistedAction.action.playerId);

  return {
    seq: persistedAction.seq,
    ts: persistedAction.ts,
    street,
    playerId: persistedAction.action.playerId,
    playerName,
    seatIndex,
    type: persistedAction.action.type,
    amount: persistedAction.action.amount ?? null,
    invested: afterPlayer.totalBet - beforePlayer.totalBet,
    potBefore: totalPot(beforeState),
    potAfter: totalPot(afterState),
    playerBetBefore: beforePlayer.currentBet,
    playerBetAfter: afterPlayer.currentBet,
    playerChipsBefore: beforePlayer.chips,
    playerChipsAfter: afterPlayer.chips,
  };
}

export function buildReplayHand(hand: PersistedHandRecord): ReplayHand {
  if (!hand.finalState || hand.completedAt === null) {
    throw new Error(`Replay hand ${hand.handId} is incomplete`);
  }

  const playerMeta = new Map(hand.players.map(player => [player.playerId, player]));
  const finalState = hand.finalState;
  let replayState = structuredClone(hand.initialState);
  const streets: ReplayStreet[] = [];
  revealStreetEntries(streets, replayState);

  for (const persistedAction of hand.actions) {
    if (!isBettingRound(replayState.phase)) {
      throw new Error(
        `Replay adapter expected betting round before action ${persistedAction.seq}, got ${replayState.phase}`,
      );
    }

    const street = replayState.phase;
    const playerInfo = playerMeta.get(persistedAction.action.playerId);
    if (!playerInfo) {
      throw new Error(
        `Replay adapter could not find seat metadata for player ${persistedAction.action.playerId}`,
      );
    }

    let nextState: GameState;
    try {
      nextState = applyAction(replayState, persistedAction.action);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Replay adapter failed to apply action ${persistedAction.seq} in hand ${hand.handId}: ${message}`,
      );
    }

    const streetEntry = ensureStreet(streets, street, replayState);
    streetEntry.actions.push(
      buildReplayAction(street, playerInfo.name, playerInfo.seatIndex, replayState, nextState, persistedAction),
    );
    streetEntry.potAtEnd = totalPot(nextState);

    revealStreetEntries(streets, nextState);
    replayState = nextState;
  }

  revealStreetEntries(streets, finalState);

  const hasShowdown = finalState.winners.some(winner => winner.hand !== undefined);
  const showdownPlayers: ReplayShowdownPlayer[] = hasShowdown
    ? finalState.players
        .filter(
          (player): player is Player & { holeCards: [Card, Card] } =>
            player.status !== 'folded' && player.holeCards !== null,
        )
        .map(player => {
          const playerInfo = playerMeta.get(player.id);
          if (!playerInfo) {
            throw new Error(`Replay adapter could not find seat metadata for showdown player ${player.id}`);
          }

          return {
            playerId: player.id,
            name: playerInfo.name,
            seatIndex: playerInfo.seatIndex,
            holeCards: [...player.holeCards] as [Card, Card],
            evaluation: evaluateHand(player.holeCards, finalState.communityCards),
          };
        })
    : [];

  const showdownPlayerIds = new Set(showdownPlayers.map(player => player.playerId));
  const finalPlayers = new Map(finalState.players.map(player => [player.id, player]));

  const seats: ReplaySeat[] = [...hand.players]
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map(player => {
      const finalPlayer = finalPlayers.get(player.playerId);
      return {
        playerId: player.playerId,
        name: player.name,
        seatIndex: player.seatIndex,
        startingChips: player.startingChips,
        endingChips: player.endingChips,
        chipDelta: player.endingChips === null ? null : player.endingChips - player.startingChips,
        finalStatus: finalPlayer?.status ?? null,
        reachedShowdown: showdownPlayerIds.has(player.playerId),
      };
    });

  const winners: ReplayWinner[] = hand.winners.map(winner => {
    const playerInfo = playerMeta.get(winner.playerId);
    if (!playerInfo) {
      throw new Error(`Replay adapter could not find winner metadata for player ${winner.playerId}`);
    }

    return {
      playerId: winner.playerId,
      name: playerInfo.name,
      seatIndex: playerInfo.seatIndex,
      amount: winner.amount,
      description: winner.description,
    };
  });

  return {
    schemaVersion: 1,
    handId: hand.handId,
    roomId: hand.roomId,
    maxSeats: hand.maxSeats,
    startedAt: hand.startedAt,
    completedAt: hand.completedAt,
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    seats,
    streets,
    finalBoard: [...finalState.communityCards],
    winners,
    showdown: showdownPlayers.length > 0 ? { players: showdownPlayers } : null,
  };
}
