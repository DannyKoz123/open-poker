import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRoom } from '$lib/server/room/room-registry';

export const POST: RequestHandler = async ({ getClientAddress }) => {
  const room = createRoom();

  return json({
    roomId: room.id,
    creatorIp: getClientAddress()
  });
};
