# TODOS

Deferred work from plan-eng-review on 2026-04-07 of the
`dannykoz-main-design-20260407-232921.md` design.

---

## 1. Playwright browser E2E tests

**What:** Full end-to-end browser tests for the complete game flow using
Playwright or equivalent. Cover: create room → two browsers join → play a
hand to showdown → verify UI state matches server state.

**Why:** The `test/crash-recovery.test.ts` subprocess test covers the server
contract for crash recovery and H1/H2/H3. It does NOT cover the browser
client behavior: localStorage `playerSecret` persistence, WS reconnect
logic, game UI rendering, room and table UX, or any client-side bugs.

**Pros:** Catches client-side regressions. Real integration coverage.
Documents the intended user flow as executable spec.

**Cons:** Playwright is slow (browser spawn ~2-3s per test). Flaky timers
in an async multiplayer game are hard to write deterministically. Needs a
test harness that starts the dev server or a built server.

**Context:** Defer until the UI stabilizes. Building Playwright tests
against a client that is still being shaped wastes effort rewriting them.
When the first "real user" plays a hand without hand-holding, that's the
signal to start E2E coverage.

**Depends on / blocked by:** UI must be stable enough that test selectors
don't churn on every commit.

---

## 2. Loud logging on rehydrate failures

**What:** When `RoomRehydrator` encounters a corrupt event payload or a
replay error, log the failure loudly: the `roomId`, the event seq, the
error, and the fact that the room was skipped. Print a startup banner
listing any skipped rooms so the operator sees it on boot. Optionally
write skipped-room IDs to a sidecar file (`/var/lib/open-poker/skipped.log`).

**Why:** The current design's failure mode for corrupt events is "skip,
log, continue." That's correct — a single bad event should not block the
whole server from booting. But a "skip + log" that nobody sees means a
room can silently disappear after a restart, and the implementer has no
trail to investigate.

**Pros:** Visibility on a critical failure mode. Cheap to add. Turns a
silent data-loss bug into a loud operational alert.

**Cons:** None meaningful. Ten lines of code and a startup print.

**Context:** This belongs in `room-rehydrator.ts` when it's built. Add a
`skippedRooms: string[]` return value from rehydrate, and log a banner in
`src/server.ts` if it is non-empty. Consider a `/healthz` response field
(`skippedRoomsCount`) once the `/healthz` endpoint exists.

**Depends on / blocked by:** `RoomRehydrator` must be built first (step 7
of the design doc Next Steps).

---

## ~~4. Mid-hand `sitPlayer` guard~~ **Completed:** v0.1.0.0 (2026-04-12)

Guard added at `Room.ts:162-165`. Players attempting to sit during an active hand
receive an error message and stay unseated until the next hand.

---

## 3. `broadcastGameState` per-player clone performance

**What:** `Room.broadcastGameState()` currently calls `getPlayerView` once
per connected player per state change. At a full 9-player table with
normal play rate, that is ~9 deep clones per action, ~tens of KB of
allocation per action. Consider computing a single base view and deriving
per-player diffs, or caching public state and only overriding hole cards.

**Why:** At the stated scale (hundreds concurrent, max 9 per table) this
is almost certainly fine. better-sqlite3 writes will dwarf clone cost.
But if the game ever feels laggy, this is a likely suspect.

**Pros:** Cheaper broadcasts. Lower GC pressure. Measurable only if the
table is hot.

**Cons:** Adds complexity to `getPlayerView` and the broadcast path.
Invalidating "hot" optimization paths during engine changes is error-prone.

**Context:** Benchmark first. A simple `bun test bench/broadcast.ts` that
measures broadcasts per second at 9 players is cheap to write. Only
optimize if the benchmark shows a concrete problem, and use the benchmark
as the regression guard. Do NOT optimize blind.

**Depends on / blocked by:** Nothing. Runs against the post-surgery `Room`
once it exists.

---
