# Day 1 Hand Analysis

The first analysis feature is intentionally solver-free.

## Ship target

- A permanent `/hand/[id]` replay page for completed hands.
- A `/hand/[id].phh` export endpoint.
- Exact per-street equity from revealed showdown cards and board state.

## Not included

- No GTO solver output
- No range-vs-range analysis
- No EV recommendations
- No profile pages
- No studies

## Dependency order

1. Event-sourced room persistence
2. PHH serializer for the supported day 1 subset
3. Exact equity enumerator
4. Replay page and PHH route

## Contract boundary

The analysis layer belongs in `src/lib/analysis/` and the PHH work belongs in
`src/lib/hand-history/`. Neither should leak back into the pure poker engine.
