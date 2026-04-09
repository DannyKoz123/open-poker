# reference/

Third-party open-source poker libraries cloned here for **local reading and
analysis** — not vendored, not imported, not built. This directory is
`.gitignored`.

## Why

WebFetch gives rendered HTML snapshots. Cloning the real source lets Claude
(and you) grep, follow call graphs, check actual API shapes, and cite line
numbers. For a handful of high-value libraries, that's worth the disk space.

## Convention

- One subdirectory per upstream repo, named after the repo (e.g.
  `reference/pokerkit/`, `reference/rust-poker/`).
- Prefer `git clone --depth 1 <url> reference/<name>` unless history matters.
- For giants (OpenSpiel, etc.), use sparse-checkout to pull only the poker
  subdirectory.
- Nothing in here should be `import`ed by `src/`. If we want to reuse code,
  port or rewrite it under a compatible license — don't cross the boundary.
- If a clone is no longer useful, delete it. This directory is disposable.

## What's here

_Populated as libraries are selected from the open-source poker survey._
