# content/

Puzzle data + Zod schema + validation. Built out in Phase 3.

## Three entry points, not one

The default entry point is the barrel `src/content/index.ts`:
`puzzleMeta` (every puzzle's id/pattern/difficulty_rating/interaction, and
nothing else), its `quizMeta`/`scrubberMeta` derivatives (see below),
`getPuzzleBody(id)`, `PATTERN_SLUGS`/`PATTERN_LABELS`, `PuzzleSchema`, and
the `Puzzle`/`McqPuzzle`/`SwipeBinaryPuzzle`/`TapLinePuzzle`/
`DragOrderPuzzle`/`ScrubberPuzzle`/`QuizPuzzle` types. `schema.ts` and
`patterns.ts` stay internal, same barrel convention as `storage/`.

Two files are deliberately **excluded** from that barrel and must be
deep-imported instead — `src/content/pools.ts` and
`src/content/devPuzzles.ts`. This is not a style preference and not
negotiable; re-exporting either one from `index.ts` reintroduces a measured
performance regression:

- **`pools.ts`** — `puzzlePool` (every _fully-loaded_ puzzle, aggregated
  eagerly at build time) plus `quizPool`/`scrubberPool`. Import from
  `'../../content/pools'` (adjust depth), never from the barrel.
- **`devPuzzles.ts`** — `DEV_STUB_PUZZLES`. Import from
  `'../../content/devPuzzles'`, never from the barrel.

Why: ES modules evaluate per _file_, not per binding. A re-export like
`export { puzzlePool } from './pools'` makes `pools.ts` reachable from every
chunk that imports _anything_ from the barrel, so its eager 214-file glob —
and every puzzle body — lands on every route's critical path, even where
nothing reads the binding. Measured, not assumed: with the re-export
`dist/assets/content-*.js` was 79.74 KB and statically imported all 214
puzzle chunks; without it, 53.84 KB and zero. The same mechanism defeats
`import.meta.env.DEV` guards around `DEV_STUB_PUZZLES` — a guard can gate
whether code _runs_, never whether a file is _included_. See
`pools.ts`'s and `index.ts`'s own header comments, and
docs/superpowers/plans/2026-08-24-content-metadata-lazy-load.md.

`barrelBoundary.test.ts` enforces this mechanically: it scans every file
under `src/` and fails if any of the four names is imported from a path
ending at `content`. An eslint `no-restricted-imports` rule would be
strictly better (it would flag this in-editor rather than at test time) and
should replace that test if `eslint.config.js` is ever opened for it — the
config is write-protected in this repo's tooling, which is why the check
lives in a test. Either way, understand the reason above rather than working
around the check.

## Choosing a pool

Prefer **metadata** (`puzzleMeta`/`quizMeta`/`scrubberMeta`) plus
`getPuzzleBody(id)` for anything player-facing. Selection, mastery
bucketing, and pattern counts only need id/pattern/rating/interaction; going
through metadata means a route loads exactly the one puzzle body it serves,
not all 214.

`quizMeta`/`scrubberMeta` partition `puzzleMeta` by interaction exactly as
`quizPool`/`scrubberPool` partition `puzzlePool` — Practice and Daily select
from `quizMeta` (scrubber has its own mode, Phase 3); Trace selects from
`scrubberMeta`. Rush is the one deliberate exception: its eligibility is a
positive allow-list (mcq/swipe-binary/tap-line, so drag-order is out too),
which is a genuinely different rule, so it filters `puzzleMeta` with its own
`isRushEligible` predicate rather than building on `quizMeta`.

Do **not** re-implement `interaction !== 'scrubber'` at a call site. That
partition is derived once, centrally, for a reason: Phase 2's scrubber
puzzles were servable — and unplayable — in Practice precisely because an
unfiltered pool was passed straight through with no filter at the call site.
See docs/v2-phase2-review.md (P0) for why an unfiltered pool reaching a quiz
surface is a live bug class, not a style preference.

Reach for the eager `puzzlePool`/`quizPool`/`scrubberPool` only where a full
body genuinely is needed for _every_ puzzle at once and the cost is
acceptable: content-wide tooling (`contentStats.ts`, `validateContent.ts`),
the dev debug harness, and pool-level tests (see the testing standard
below). Application routes should not.

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
- **`drag-order`** — `blocks` (>=3 strings, in authored/display order —
  never re-shuffled at runtime), `correct_order` (a permutation of
  `blocks`' indices: `correct_order[i]` is the index into `blocks` that
  belongs at position `i` of the correct sequence)

`cf-009`, `err-011`, and `rec-009` (the initial `drag-order` puzzles) were
hand-authored fixtures. Phase 6 added 20 more `drag-order` puzzles (also
hand-authored through chat, in two locked formats — reorder code blocks, or
order output lines — see `docs/v2-build-plan.md`'s Phase 6 authoring
amendment), bringing the total to 23. No generation run has targeted
`drag-order` yet (see `GENERATING_PUZZLES.md` /
`tools/generatePuzzles.ts`'s `Interaction` type, which can target it but
isn't wired into any manifest logic this phase).

## Tooling (`tools/`)

Node-side CLI scripts — not imported by app code, read puzzle files straight
off disk via `fs` rather than through Vite's `import.meta.glob` (see
`pools.ts`'s doc comment for why the two paths are kept separate).

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

## Testing standard: UI guarantees about checkpoint presentation must hit real content

Any test asserting what a player actually sees at a Trace checkpoint — a
choice label, a masked value, a reveal string — must run against the real
`scrubberPool` export from `src/content/pools.ts`, not a hand-built fixture.
A fixture puzzle is written by whoever writes the test, so it silently
encodes the author's own assumptions about the content shape; it cannot
catch a defect that only exists because real content violates one of those
assumptions.

This is not a hypothetical: the Phase 3 pre-merge corrective found two
player-facing bugs that shipped past a fully green suite for exactly this
reason. `CheckpointPanel.test.tsx` and `Scrubber.test.tsx` each used a
synthetic fixture where every `next-line` checkpoint's choices happened to
render unambiguously and no two variable rows ever shared a value — neither
property holds across the real pool. The two defects:

- **Line-number base mismatch.** `next-line` choices are validated as
  0-indexed line offsets (matching `ScrubberStepSchema.line`), but the code
  gutter and the answer reveal both display 1-indexed line numbers. Every
  fixture's choices happened to still "look right" either way; three real
  puzzles (`mut-009`, `oob-009`, `scl-009`) did not, and a player saw a
  choice list that disagreed with its own reveal.
- **Mask defeated by a co-valued row.** Masking only the target row is
  correct in a fixture where no other row shares its value. In real content
  built around mutable-state aliasing (e.g. `mut-009`, where `original` and
  `cart` are the same array by construction), the masked answer was sitting
  in plain text one row away.

Going forward, any new assertion of this kind — "this string is/isn't
visible at this checkpoint," "this label reads as X" — needs a pool-level
test (see `CheckpointPanel.pool.test.tsx` and the mask-propagation pool test
added alongside it) iterating the real `scrubberPool`, in addition to any
fixture-level test kept for fast, targeted regression coverage.
