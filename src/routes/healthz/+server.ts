import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getActiveRoomCount, listRoomIds } from '$lib/server/room/room-registry';

export const GET: RequestHandler = async () => {
  return json({
    status: 'ok',
    uptime_s: Math.floor(process.uptime()),
    active_rooms: getActiveRoomCount(),
    room_ids: listRoomIds()
  });
};
