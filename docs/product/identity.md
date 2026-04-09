# Product Identity

Open Poker is a public-good poker project, not a startup waiting for a pricing
page.

## Locked decisions

- License: AGPL-3.0 across the whole project.
- Revenue posture: no paid tier, no ads, no open-core split.
- Public-by-default posture: completed games are intended to become permanent,
  shareable hand URLs.
- Identity posture: two-tier. Anonymous-stable (device-local, localStorage) is
  the default; username + password accounts (lichess-style, optional email for
  recovery) are the opt-in path for cross-device continuity and profile pages.

## Hard non-goals

The only hard non-goal is money play. This is not a "later maybe" and will not
be revisited without a deliberate reopening of the question. The exclusion is
load-bearing: removing the money incentive structurally collapses the class of
threats (collusion, chip dumping, chargebacks, regulatory exposure) that the
project otherwise has no capacity to defend against.

## Day 1 scope

Day 1 ships exactly:

- The poker play flow (already in the repo).
- Post-hand analysis via the public `/hand/[id]` replay page and the
  `/hand/[id].phh` export.
- Optional username + password accounts for cross-device continuity.

Day 1 deliberately does NOT ship: in-game chat, ratings, tournaments, player
pools, leaderboards, studies, spectator chat, forums, teams, puzzles, variants
beyond NLHE, bots, or any feature that introduces a moderation surface or
infrastructure cost the project is not yet ready to carry.

## Possible future features

None of the following are promised, but none are forbidden either. Each will
be evaluated on its own merits and will be paired with the moderation,
infrastructure, or anti-abuse investment it requires before shipping:

- In-game chat (requires moderation tooling and a report workflow)
- Ratings per variant and time control, lichess-style (requires anti-
  multi-account and basic collusion detection)
- Tournaments: arena, swiss, team battles, heads-up matches
- Player pools and leaderboards
- Studies (private analysis workspaces, shared by link)
- Additional variants: PLO, short-deck, stud, draw, mixed games
- Additional time controls and formats

The absence of any given feature from Day 1 is a scoping choice, not a
statement that it will never exist.

## Why this matters to the repo

- Avoid adding features that assume private games by default.
- Avoid building moderation-heavy surfaces into the core play flow before the
  moderation investment is ready to accompany them.
- Prefer architecture that supports public hand replay, PHH export, and later
  analysis over social features.
- When a possible-future-feature is being added, treat "what moderation or
  infrastructure must land with it" as part of the scope, not as a separate
  later decision.
