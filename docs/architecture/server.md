# Server Architecture

Open Poker is intentionally "single-node now, no rewrite later".

## Current state

- The poker engine is pure and lives in `src/lib/engine/`.
- The authoritative game runtime lives in `src/lib/server/room/`.
- Development WebSocket hosting currently comes from a Vite-mounted server in
  `src/lib/server/gateway/dev-websocket-plugin.ts`.
- Rooms are still in-memory today.

## Approved seams

The approved server design introduces four explicit server boundaries:

1. `Gateway`
   - Owns sockets and upgrade handling.
   - Translates transport traffic into room events and outbound player messages.
2. `RoomBus`
   - Carries client actions, accept/reject replies, and state broadcasts.
   - Local implementation can stay in-process first.
3. `RoomStore`
   - Event-sourced persistence, first on SQLite, later swappable.
   - Owns replay, snapshots, and timer durability.
4. `RoomDirectory`
   - Resolves room ownership.
   - Trivial locally, useful later if the project ever needs multiple nodes.

## Non-negotiables

- Keep the pure engine untouched by server architecture work.
- Persist, then publish.
- Draw the distributed seams now even if the first implementation is local.
- Dev and prod should converge on the same WebSocket upgrade path over time.

## Near-term routes and endpoints

- `POST /api/rooms` is the creation seam for new rooms.
- `/healthz` is the operational probe surface.
- `/hand/[id]` and `/hand/[id].phh` are reserved for the first public analysis feature.
