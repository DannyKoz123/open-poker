import { Room } from './room';

const rooms = new Map<string, Room>();

export function getOrCreateRoom(id: string): Room {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id);
    rooms.set(id, room);
  }
  return room;
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id);
}

export function deleteRoom(id: string): void {
  rooms.delete(id);
}

/** Generate a short, readable room ID */
export function generateRoomId(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // No confusing chars (0/O, 1/l/I)
  let id = '';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    id += chars[byte % chars.length];
  }
  return id;
}
