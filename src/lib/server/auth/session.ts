import type { Cookies } from '@sveltejs/kit';
import type { AuthSessionData } from '../../types/identity';
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  getAuthStore,
} from './store';

export function authCookieOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  };
}

export function getAuthSession(cookies: Cookies): AuthSessionData {
  return {
    account: getAuthStore().getAccountForSessionToken(cookies.get(AUTH_COOKIE_NAME)),
  };
}

export function clearAuthSession(cookies: Cookies, secure: boolean): void {
  getAuthStore().deleteSession(cookies.get(AUTH_COOKIE_NAME));
  cookies.delete(AUTH_COOKIE_NAME, authCookieOptions(secure));
}
