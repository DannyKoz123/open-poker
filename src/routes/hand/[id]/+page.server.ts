import { getReplayHandAnalysis } from '$lib/server/hands';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const replayHandAnalysis = getReplayHandAnalysis(params.id);
  if (!replayHandAnalysis) {
    throw error(404, 'Hand not found.');
  }

  return replayHandAnalysis;
};
