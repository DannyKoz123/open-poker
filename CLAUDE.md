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

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
