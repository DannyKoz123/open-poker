const ROOM_ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateReadableRoomId(length = 6): string {
  let id = '';
  const bytes = new Uint8Array(length);

  crypto.getRandomValues(bytes);

  for (const byte of bytes) {
    id += ROOM_ID_CHARS[byte % ROOM_ID_CHARS.length];
  }

  return id;
}
