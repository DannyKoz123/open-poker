# Open Poker

Open-source real-time multiplayer Texas Hold'em. Built to run on a single
VPS today and scale to a cluster tomorrow without a rewrite. AGPL-3.0.
No accounts, no chips for sale, no fine print. Just play.

## Status

**Pre-alpha.** The poker engine works and is tested. The dev server runs.
Production hosting and persistence are designed but not yet implemented.
The first release will land the architecture work described under
[Roadmap](#roadmap) below.

What works today:

- Pure poker engine: deck, hand evaluation, full Texas Hold'em rules,
  side pots, showdown. Tested via `bun test`.
- Authoritative `Room` class with a serialized action queue, a 30 second
  turn timer (auto-fold on timeout), and a 30 second reconnect grace
  window.
- WebSocket transport for the lobby and table pages.
- Svelte 5 lobby and table UI in runes mode.

What does not work yet:

- Production WebSocket hosting. The current WS server is mounted by a
  Vite plugin and only runs during `vite dev`.
- Persistence. Rooms live in an in-memory `Map<string, Room>` and die on
  process restart.
- Multi-node. There is one process or none.
- Reconnect authentication. The current scheme trusts whatever
  `playerId` shows up in the URL.
- A real deploy pipeline.

The next phase of work fixes all of these. See the
[Architecture](#architecture) and [Roadmap](#roadmap) sections for the
plan.

## Architecture

The interesting constraint of this project is **single-node now, no
rewrite later**. The codebase is shaped so every scale axis (process
split, persistence, room ownership) has a seam in the right place from
day one, even when the second half of the seam is just an in-process
function call. When the day comes that one box is not enough, each seam
becomes a dependency swap via env var rather than a refactor.

Three layers, each with a clear job.

### 1. Pure poker engine (`src/lib/engine/`)

Functional core. `createHand`, `applyAction`, `getAvailableActions`, and
`getPlayerView` are pure functions over `GameState`. The only randomness
lives in `createHand` (deck shuffle), and that randomness is being moved
to the caller so game state is fully replayable from a persisted event
log.

The engine has zero knowledge of WebSockets, persistence, or any I/O. It
is a Texas Hold'em rules library that happens to live in this repo. You
could lift it into a CLI, a Discord bot, or a property-based test harness
without changing a line.

Tests live next to the source files (`*.test.ts`) and exercise the engine
directly.

### 2. Authoritative server (`src/lib/server/`)

The `Room` class owns one table. Every state mutation goes through a
single FIFO action queue. Turn timers and reconnect grace are part of
that queue's contract. There is no other concurrency model.

The next phase introduces three architectural seams around `Room`:

- **`RoomBus`** between a `Gateway` (which holds sockets) and `Room`
  (which holds state). Today both live in the same process and the bus
  is a Node `EventEmitter`. Tomorrow `RedisBus` slots in via env var and
  the gateway and room can run on different boxes. The bus carries three
  traffic patterns over the same channel: client action requests with
  correlation IDs, action accepted / rejected replies, and broadcast
  state-change events.
- **`RoomStore`** for event-sourced persistence. Every action that
  mutates a room appends an event row in SQLite (WAL mode). Snapshots
  every N actions. On restart, rooms rehydrate by replaying events since
  their last snapshot. Same schema works for Postgres later via one env
  var.
- **`RoomDirectory`** for room ownership. Today `LocalDirectory` returns
  "me" for every lookup. Tomorrow `RedisDirectory` is an HSET of room ID
  to owner node, used for sticky routing on multi-node deploys.

This is the lichess pattern (`lila` plus `lila-ws` plus Redis pub/sub
plus a durable store) at small scale, with every seam drawn but not yet
cut. lichess actually splits the services from day one because they run
tens of thousands of concurrent sockets across a dozen dedicated boxes.
Open Poker does not need that today. It needs the option to grow into
that without throwing the codebase away.

#### Three hazards designed for from day one

The event-sourcing model is not free. Three things have to be right
before any code is written, or you get quietly corrupt hands on restart:

- **H1, RNG determinism on replay.** A poker engine is deterministic
  given a known deck, but `shuffleDeck` is not. The persisted
  `hand-started` event captures the full dealt deck, so replay always
  produces the same cards.
- **H2, timer semantics across restart.** Turn timers fire on wall-clock
  time, not on prior events. Every timer start persists an absolute
  `deadlineTs`. On rehydrate, if the deadline has passed, the timer fires
  immediately on the next queue tick. If not, it is rescheduled for the
  remainder. Same pattern for reconnect grace timers.
- **H3, reconnect authentication.** A `playerSecret` is issued on first
  join, stored in localStorage on the client, and verified against a
  hashed copy in the store on every WS upgrade. With persistence across
  restart, a server restart is otherwise indistinguishable from a
  reconnect, and a replaying attacker could claim any seat.

A subprocess `kill -9` integration test is the contract for all three:
a hand mid-bet must survive the kill and resume with the same deal, the
same chips, and the correct timer remainder.

### 3. Client (`src/routes/`)

`+page.svelte` is the lobby. `game/[id]/+page.svelte` is the table. The
wire protocol is defined in `src/lib/types/messages.ts` (`ClientMessage`
and `ServerMessage` discriminated unions) and imported by both client
and server, so changing a message shape is a single edit at one source
of truth.

## Tech Stack

| Layer            | Choice                                  | Why                                                       |
|------------------|-----------------------------------------|-----------------------------------------------------------|
| Framework        | SvelteKit 2 + Svelte 5 (runes mode)     | Tiny runtime, sharp DX, runes for explicit reactivity     |
| Language         | TypeScript 5.9                          | Engine determinism + wire protocol typing at the boundary |
| Package manager  | Bun 1.3                                 | One tool for install, lockfile, and test runner           |
| Test runner      | `bun test`                              | Built into Bun, no extra config                           |
| WebSocket        | `ws` 8.x                                | Boring, battle-tested                                     |
| HTTP server      | adapter-node + custom entry (planned)   | Self-hosted, no platform lock-in                          |
| Persistence      | `better-sqlite3` (planned)              | Single-file embedded, WAL mode, sub-millisecond writes    |
| Reverse proxy    | Caddy (planned)                         | Auto-TLS, transparent WebSocket upgrade                   |
| Deploy target    | Hetzner VPS (planned)                   | Bare metal vibes, full control, cheap forever             |

The "planned" rows are the work the [Roadmap](#roadmap) section covers.

## Quickstart

Requires [Bun](https://bun.sh/) 1.3 or newer.

```sh
git clone git@github.com:DannyKoz123/open-poker.git
cd open-poker
bun install
bun run dev
```

The dev server starts Vite on `http://localhost:5173` and the WebSocket
server on `ws://localhost:5174`. (This dual-port setup is a development
artifact that will go away in step 8 of the build order, when production
and dev share the same HTTP server.)

To play locally, open two browser windows on `http://localhost:5173`,
create a room in one, copy the URL into the other, sit at the table, and
click Start.

### Tests

```sh
bun test                                  # all tests
bun test src/lib/engine/evaluate.test.ts  # one file
bun test --test-name-pattern "flush"      # filter by name
```

The engine tests are deterministic given their inputs and run in well
under a second.

### Type-check

```sh
bun run check
```

Runs `svelte-kit sync` followed by `svelte-check` against `tsconfig.json`.
Use this before committing to catch type errors the dev server does not
surface immediately.

### Production build (placeholder)

```sh
bun run build
```

Today this produces an `adapter-node` build but does not yet host the
WebSocket server in production. That is the work step 8 lands.

## Project Structure

```
src/
├── app.d.ts
├── app.html
├── lib/
│   ├── assets/                          # Static assets imported by code
│   ├── engine/                          # Pure poker engine, no I/O
│   │   ├── deck.ts                      # createDeck, shuffleDeck, deal
│   │   ├── evaluate.ts                  # Hand ranking, side pots, showdown
│   │   ├── evaluate.test.ts
│   │   ├── game.ts                      # createHand, applyAction, getPlayerView
│   │   ├── game.test.ts
│   │   └── index.ts
│   ├── server/                          # Authoritative server (in-memory today)
│   │   ├── room.ts                      # The Room class. Concurrency model lives here.
│   │   ├── rooms.ts                     # In-memory Map<roomId, Room>
│   │   └── vite-ws-plugin.ts            # Dev-only WS bootstrap (will be replaced)
│   └── types/
│       ├── messages.ts                  # ClientMessage / ServerMessage wire protocol
│       └── poker.ts                     # GameState, Player, PlayerAction
└── routes/
    ├── +layout.svelte
    ├── +page.svelte                     # Lobby
    └── game/
        └── [id]/
            └── +page.svelte             # Table

CLAUDE.md                                # Project context for Claude Code
TODOS.md                                 # Deferred work captured during planning
LICENSE                                  # AGPL-3.0
```

## Roadmap

The next phase replaces the dev-only WebSocket server with a single-node
production architecture that has the right seams to scale later. Build
order, smallest to largest, so every step is independently shippable:

1. ~~Baseline commit.~~ Done.
2. Extract a `ws-upgrade` handler and a `Gateway` class out of `Room`.
   Pure restructure, no behavior change. Tests still pass.
3. Rework `createHand` to accept an explicit deck. Engine stays pure;
   randomness moves to the caller. This is what unlocks deterministic
   replay (H1).
4. Introduce the `RoomBus` interface and a `LocalBus` impl wrapping a
   Node `EventEmitter`. Wire `Room` to publish, `Gateway` to subscribe.
5. Introduce the `RoomStore` interface and a `SqliteEventStore` impl
   using `better-sqlite3` in WAL mode. Append events on every mutation.
6. Add `playerSecret` to the join protocol. The server issues one on
   first join; the client persists it to localStorage; the gateway
   verifies it on every WS upgrade. Closes H3.
7. Add a `RoomRehydrator`. On startup, load active rooms from the store,
   replay events since the latest snapshot, resume turn and grace timers
   from persisted absolute deadlines. Closes H2. The subprocess
   `kill -9` integration test is the acceptance gate.
8. Replace `vite-ws-plugin.ts` with `src/server.ts` as the production
   entry. Both dev and prod mount the same WS upgrade handler on a
   single HTTP server. Dev/prod parity, one port.
9. Introduce the `RoomDirectory` interface and a trivial `LocalDirectory`
   stub. Pure seam, no behavior today.
10. Hetzner deploy. Caddy with auto-TLS and a per-IP rate limit on
    `POST /api/rooms`. systemd unit. SQLite at
    `/var/lib/open-poker/rooms.db`. First real deployment.
11. `docs/scaling.md` documenting the multi-node upgrade path: which
    env vars to flip, which services to add, in what order.

Each step is a standalone commit that leaves the system runnable.

Deferred work that is not part of this phase lives in [TODOS.md](TODOS.md).

## Contributing

Issues and PRs welcome. The architecture is changing fast right now, so
before opening a non-trivial PR, please file an issue describing what
you want to change and check that it does not collide with the roadmap
above. Small fixes (typos, doc clarifications, obvious bugs) can go
straight to a PR.

The engine in `src/lib/engine/` is the safest place to contribute today
because it is pure and well-tested. The server layer is the area being
restructured, and code there will move around in the next several
commits.

## License

[AGPL-3.0](LICENSE). The "open" in Open Poker is meaningful: anyone who
runs a modified version as a network service must publish their changes
under the same license. If you want to run a closed-source fork as a
business, that is not compatible with this license. If you want to
contribute a feature, fork the repo and send a PR.
