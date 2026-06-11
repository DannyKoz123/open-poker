import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthStore, AUTH_COOKIE_NAME, AuthStoreError } from '$lib/server/auth/store';
import { authCookieOptions } from '$lib/server/auth/session';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const body = (await request.json().catch(() => null)) as {
    username?: unknown;
    password?: unknown;
  } | null;

  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    throw error(400, 'Username and password are required.');
  }

  try {
    const result = getAuthStore().login(body.username, body.password);
    cookies.set(
      AUTH_COOKIE_NAME,
      result.sessionToken,
      authCookieOptions(url.protocol === 'https:'),
    );
    return json({ account: result.account });
  } catch (caught) {
    if (caught instanceof AuthStoreError) {
      throw error(caught.status, caught.message);
    }
    throw caught;
  }
};
