import { generateReadableRoomId } from '../../ids/room-id';
import { getCompletedHandStore } from '../store/completed-hand-store';
import { Room, type RoomOptions } from './Room';

const rooms = new Map<string, Room>();
const completedHandStore = getCompletedHandStore();

export function getOrCreateRoom(id: string): Room {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id, { completedHandStore });
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

export function createRoom(options: RoomOptions = {}, id = generateReadableRoomId()): Room {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id, { ...options, completedHandStore });
    rooms.set(id, room);
  }
  return room;
}

export function getActiveRoomCount(): number {
  return rooms.size;
}

export function listRoomIds(): string[] {
  return [...rooms.keys()];
}

/** Compatibility export for older call sites. */
export function generateRoomId(): string {
  return generateReadableRoomId();
}
