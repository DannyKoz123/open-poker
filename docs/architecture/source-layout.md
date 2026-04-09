# Source Layout

The repo is organized by stable responsibilities, not by current implementation
size.

## Top-level areas

- `src/lib/engine/`
  - Pure poker rules and evaluation logic.
- `src/lib/types/`
  - Shared protocol and game-state types.
- `src/lib/server/`
  - Runtime room logic plus the persistence and scaling seams around it.
- `src/lib/analysis/`
  - Post-hand analysis contracts.
- `src/lib/hand-history/`
  - Hand history formats, starting with PHH.
- `src/lib/ids/`
  - Shared ID generation helpers.
- `src/routes/`
  - SvelteKit pages and server endpoints.

## Server subtree

- `server/room/`
  - The current authoritative room runtime.
- `server/gateway/`
  - WebSocket entry and future socket ownership layer.
- `server/bus/`
  - Room event contracts and local bus implementation.
- `server/store/`
  - Event store contracts.
- `server/directory/`
  - Room ownership contracts.
- `server/ws/`
  - Upgrade-path helpers reserved for the unified HTTP + WS server.

## Practical rule

If a module exists only to describe a future seam, keep it small and contractual.
Do not build placeholder complexity into the runtime just to look "architected".
