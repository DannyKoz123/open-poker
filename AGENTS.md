# Open Poker Repo Guidelines

## Stack

- Package manager: Bun
- App framework: SvelteKit 2 + Svelte 5
- Language: TypeScript (ESM)
- Test runner: `bun test`
- Type checks: `bun run check`
- Build: `bun run build`

## Working Rules

- Keep `src/lib/engine/` pure. Do not mix sockets, persistence, timers, or HTTP concerns into the poker engine.
- Treat `src/lib/types/messages.ts` as the shared wire contract for client and server. Change it deliberately.
- Current product scope follows `docs/product/identity.md`. Money play is the only hard non-goal. Chat, ratings, tournaments, pools, leaderboards, and studies are not shipped on Day 1 but are not foreclosed either — treat them as possible future features that each require their own design pass and accompanying moderation/infra work.
- Prefer adding server seams in `src/lib/server/**` over rewriting behavior in place. The next phase is about clearer boundaries, not clever abstractions.
- Add structure in small pieces. If a future subsystem is not implemented yet, define its contract first and keep the implementation local.

## Repo Map

- `docs/architecture/` - approved server architecture and source layout docs
- `docs/product/` - product identity and day 1 analysis scope
- `src/lib/engine/` - pure poker engine
- `src/lib/server/` - room runtime, gateway, and future persistence/scaling seams
- `src/lib/analysis/` - post-hand analysis contracts
- `src/lib/hand-history/` - PHH-focused hand history code
- `src/lib/ids/` - shared identifier utilities
- `src/routes/` - SvelteKit pages and endpoints

## Commands

- `bun run dev` - local dev server
- `bun run check` - Svelte type and diagnostics pass
- `bun test` - test suite
- `bun run build` - production build
