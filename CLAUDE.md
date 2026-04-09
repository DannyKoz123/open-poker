# CLAUDE.md

See `AGENTS.md` first. That file is the repo-level source of truth.

## Commands

- `bun run dev`
- `bun run build`
- `bun run preview`
- `bun run check`
- `bun test`

## Key structure

- `src/lib/engine/` - pure poker engine, keep it free of I/O concerns
- `src/lib/server/room/` - current authoritative room runtime
- `src/lib/server/gateway/` - current WS dev entry and future socket layer
- `src/lib/server/bus/`, `store/`, `directory/` - planned server seams
- `src/lib/types/messages.ts` - shared client/server wire contract
- `src/routes/` - lobby, table, and server endpoints
