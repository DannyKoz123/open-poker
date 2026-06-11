import { computeShowdownEquities } from '../analysis/equity/compute-showdown-equities';
import type { StreetEquitySnapshot } from '../analysis/equity/types';
import { buildReplayHand } from '../analysis/replay/build-replay-hand';
import type { ReplayHand } from '../analysis/replay/types';
import { getCompletedHandStore } from './store/completed-hand-store';
import type { PersistedHandRecord } from './store/types';

export interface ReplayHandAnalysis {
  replayHand: ReplayHand;
  equitySnapshots: StreetEquitySnapshot[];
}

export function getCompletedHand(handId: string): PersistedHandRecord | null {
  return getCompletedHandStore().loadCompletedHand(handId);
}

export function getReplayHand(handId: string): ReplayHand | null {
  const hand = getCompletedHand(handId);
  if (!hand) {
    return null;
  }

  return buildReplayHand(hand);
}

export function getReplayHandAnalysis(handId: string): ReplayHandAnalysis | null {
  const hand = getCompletedHand(handId);
  if (!hand) {
    return null;
  }

  const replayHand = buildReplayHand(hand);
  return {
    replayHand,
    equitySnapshots: computeShowdownEquities(hand, replayHand),
  };
}
