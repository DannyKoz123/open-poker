import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearAuthSession } from '$lib/server/auth/session';

export const POST: RequestHandler = async ({ cookies, url }) => {
  clearAuthSession(cookies, url.protocol === 'https:');
  return json({ ok: true });
};
