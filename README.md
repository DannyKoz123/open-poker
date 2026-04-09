# Open Poker

Open Poker is an AGPL-3.0 Texas Hold'em project built around three ideas:

- free infrastructure, not a monetized platform
- single-node now, no rewrite later
- public hand replay and analysis as the long-term product thesis

## Status

Pre-alpha.

What works today:

- pure poker engine in `src/lib/engine/`
- authoritative in-memory room runtime with a serialized action queue
- SvelteKit lobby and table UI
- Bun-based tests for the engine

What is still being built:

- durable room persistence
- a production WebSocket entrypoint
- reconnect authentication
- public hand replay and PHH export

## Product posture

This repo follows the approved product identity in `docs/product/identity.md`.

- License: AGPL-3.0 top to bottom
- **Only hard non-goal: money play.** Structurally excluded to collapse the
  class of threats (collusion, chip dumping, chargebacks, regulation) the
  project has no capacity to defend against.
- Day 1 ships the play flow plus public `/hand/[id]` replay and PHH export.
- Day 1 deliberately omits chat, ratings, tournaments, pools, leaderboards,
  studies, variants beyond NLHE, and every other lichess-grade feature. None
  of those are foreclosed — each is a possible future feature that will be
  paired with its required moderation / infra work when it ships.
- Public hand replay is the intended analysis surface.

## Docs

- `docs/architecture/server.md` - approved single-node server architecture
- `docs/architecture/source-layout.md` - repo structure and ownership
- `docs/product/identity.md` - identity and hard scope decisions
- `docs/product/day-1-hand-analysis.md` - first analysis feature scope

## Quickstart

Requires Bun 1.3+.

```sh
bun install
bun run dev
```

Local commands:

```sh
bun run check
bun test
bun run build
```

## Current repo shape

```text
docs/                  Design and architecture summaries that are meant to live in the repo
src/lib/engine/        Pure poker rules and evaluation
src/lib/server/        Room runtime plus future persistence/scaling seams
src/lib/analysis/      Post-hand analysis contracts
src/lib/hand-history/  PHH-focused hand history contracts
src/routes/            SvelteKit pages and endpoints
```

## Near-term build order

1. keep the room runtime authoritative while extracting clearer server seams
2. add room creation and health endpoints as durable HTTP surfaces
3. land event-sourced persistence and reconnect auth
4. build the public `/hand/[id]` replay and `/hand/[id].phh` export paths
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
