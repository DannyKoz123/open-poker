# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager: **bun** (see `bun.lock`, `.npmrc`).

- `bun run dev` — start Vite dev server (also boots the WebSocket server, see Architecture)
- `bun run build` — production build via `@sveltejs/adapter-node`
- `bun run preview` — preview the production build
- `bun run check` — `svelte-kit sync` + `svelte-check` type/diagnostics pass
- `bun test` — run all tests (uses the built-in `bun test` runner, not Vitest)
- `bun test src/lib/engine/evaluate.test.ts` — run a single test file
- `bun test --test-name-pattern "flush"` — filter by test name

## Architecture

Open Poker is a SvelteKit 2 + Svelte 5 (runes mode forced via `svelte.config.js`) Texas Hold'em app. There are three layers worth understanding before editing:

### 1. Pure poker engine — `src/lib/engine/`

`deck.ts`, `evaluate.ts`, `game.ts` implement Texas Hold'em as **pure functions over `GameState`** (types in `src/lib/types/poker.ts`). The only randomness lives in `createHand` (deck shuffle); every other transition (`applyAction`, `getAvailableActions`, `getPlayerView`) is deterministic given the prior state. Tests (`*.test.ts`) live next to the engine files and exercise it directly without the server. When fixing rules bugs (betting rounds, side pots, hand ranking), change the engine — the server layer should stay a thin coordinator.

`getPlayerView(state, playerId)` is what hides opponents' hole cards before serializing — never broadcast raw `GameState`.

### 2. Authoritative room server — `src/lib/server/`

`vite-ws-plugin.ts` is a custom Vite plugin that spins up a **separate WebSocket server on port 5174** (in addition to Vite's HTTP server) when `vite dev` runs. Clients connect to `ws://localhost:5174/ws/game/<roomId>?playerId=<uuid>`. The plugin is registered in `vite.config.ts`. Note: this WS server is dev-only as currently wired — adapter-node production builds do not yet host it; this is a known gap if you're adding deploy support.

`rooms.ts` is an in-memory `Map<string, Room>` (no persistence). `room.ts` (`Room` class) is the authoritative state holder per game and owns:
- **Action queue** (`enqueue` / `processQueue`): every incoming client message and every turn-timer auto-fold goes through a single FIFO queue. This is the concurrency model — do not call engine mutations directly from a `setTimeout` or socket handler; always go through `enqueue`.
- **Reconnect grace** (`RECONNECT_GRACE_MS = 30s`): on socket close mid-hand, the player is kept in `players` and only removed if they don't reconnect in time. Reconnection is matched by `playerId` from the URL query, and stale `close` events are ignored by comparing `player.ws !== disconnectedWs`.
- **Turn timer** (`TURN_TIMER_MS = 30s`): auto-folds the active player. Cleared on every action and restarted from `broadcastGameState`.
- **Per-player views**: `sendGameState` calls `getPlayerView` and attaches `availableActions` only for the player whose turn it is.

Constants worth knowing: `STARTING_CHIPS = 1000`, `MAX_SEATS = 9`, blinds default to 5/10.

### 3. Client — `src/routes/`

`+page.svelte` is the lobby; `game/[id]/+page.svelte` is the table. Wire protocol is defined by `src/lib/types/messages.ts` (`ClientMessage` / `ServerMessage`) — both client and server import these types, so changing a message shape is a single source-of-truth edit.
