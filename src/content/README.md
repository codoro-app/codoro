# content/

Puzzle data + Zod schema + validation. Built out in Phase 3.

Public API is `src/content/index.ts` — the only file anything outside this
folder should import from: `puzzlePool` (every validated puzzle, aggregated
at build time), `PATTERN_SLUGS`/`PATTERN_LABELS`, `PuzzleSchema`, and the
`Puzzle`/`McqPuzzle`/`SwipeBinaryPuzzle`/`TapLinePuzzle` types. `schema.ts`
and `patterns.ts` are internal, same barrel convention as `storage/`.

`PATTERNS.md` and `CALIBRATION.md` are the product-facing docs behind the
schema — the pattern taxonomy and the difficulty-rating rubric,
respectively. Both are drafts pending sign-off; `patterns.ts`'s
`PATTERN_SLUGS` is the machine-readable form of `PATTERNS.md` and must stay
in sync with it by hand (no codegen — 13 entries doesn't warrant it).

## Puzzle files

One JSON file per puzzle in `puzzles/<pattern>/<id>.json`. `id` is stable
and never reused — it's referenced forever by stored attempt history once
puzzles ship. Every puzzle has `id`, `pattern`, `difficulty_rating` (800-2400),
`explanation`, `prompt`, `language`, and `snippet`, plus interaction-specific
fields:

- **`mcq`** — `choices` (2-5 strings), `correct_choice` (index into `choices`)
- **`swipe-binary`** — `left_label`, `right_label`, `correct_direction`
  (`'left' | 'right'`)
- **`tap-line`** — `correct_line` (0-based line index into `snippet`)

## Tooling (`tools/`)

Node-side CLI scripts — not imported by app code, read puzzle files straight
off disk via `fs` rather than through Vite's `import.meta.glob` (see
`index.ts`'s doc comment for why the two paths are kept separate).

- **`pnpm validate:content`** — schema-validates every file under
  `puzzles/` plus pool-wide `id` uniqueness (the one check no single file's
  schema can express alone). Wired into CI; a bad puzzle fails the build.
- **`pnpm content:stats`** — per-pattern counts, a difficulty histogram, and
  per-interaction-type counts, so coverage gaps are visible while authoring.
  Not CI-gated — a developer-facing report only.

Coverage note: the CI coverage gate (`vite.config.ts`) is still scoped to
`engine/` and `storage/` only, per Phase 2. It was deliberately **not**
extended to `content/` here — `schema.ts` and `tools/validatePuzzles.ts` have
solid unit tests, but the two CLI entrypoints (`validateContent.ts`,
`contentStats.ts`) are thin I/O/console glue that don't lend themselves to
the same 100%-branches bar. Revisit if that tradeoff stops feeling right.
