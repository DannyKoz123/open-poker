import type { LayoutServerLoad } from './$types';
import { getAuthSession } from '$lib/server/auth/session';

export const load: LayoutServerLoad = async ({ cookies }) => {
  return {
    auth: getAuthSession(cookies),
  };
};
