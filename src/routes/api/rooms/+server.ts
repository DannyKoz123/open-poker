import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRoom } from '$lib/server/room/room-registry';
import { HostSession } from '$lib/server/host/HostSession';
import { getAuthStore, AUTH_COOKIE_NAME } from '$lib/server/auth/store';
import { accountPlayerId } from '$lib/types/identity';

// Chip unit = 1 cent. Lowest/highest allowed blinds (play money).
const MIN_BLIND = 1;
const MAX_BLIND = 1_000_000;

export const POST: RequestHandler = async ({ request, cookies }) => {
  let smallBlind: number | undefined;
  let bigBlind: number | undefined;
  let hosted = false;

  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = (await request.json().catch(() => null)) as {
      smallBlind?: unknown;
      bigBlind?: unknown;
      hosted?: unknown;
    } | null;
    if (body) {
      smallBlind = typeof body.smallBlind === 'number' ? body.smallBlind : undefined;
      bigBlind = typeof body.bigBlind === 'number' ? body.bigBlind : undefined;
      hosted = body.hosted === true;
    }
  }

  if (smallBlind !== undefined || bigBlind !== undefined) {
    if (
      !Number.isInteger(smallBlind) ||
      !Number.isInteger(bigBlind) ||
      smallBlind! < MIN_BLIND ||
      bigBlind! < MIN_BLIND ||
      smallBlind! > MAX_BLIND ||
      bigBlind! > MAX_BLIND ||
      smallBlind! >= bigBlind!
    ) {
      throw error(400, 'Invalid blinds: must be integers with 0 < smallBlind < bigBlind');
    }
  }

  // Validate host auth BEFORE creating the room to avoid orphan rooms on 401
  let hostAccount: { id: string; username: string } | null = null;
  if (hosted) {
    const account = getAuthStore().getAccountForSessionToken(
      cookies.get(AUTH_COOKIE_NAME) ?? null,
    );
    if (!account) {
      throw error(401, 'Host mode requires an account. Log in first.');
    }
    hostAccount = account;
  }

  const room = createRoom({ smallBlind, bigBlind });

  let hostId: string | null = null;
  if (hostAccount) {
    hostId = accountPlayerId(hostAccount.id);
    const session = new HostSession(room, hostId, hostAccount.username);
    room.hostSession = session;
  }

  return json({
    roomId: room.id,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    hostId,
  });
};
