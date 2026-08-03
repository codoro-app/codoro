# content/

Puzzle data + Zod schema + validation. Built out in Phase 3.

Public API is `src/content/index.ts` — the only file anything outside this
folder should import from: `puzzlePool` (every validated puzzle, aggregated
at build time), its `quizPool`/`scrubberPool` derivatives (see below),
`PATTERN_SLUGS`/`PATTERN_LABELS`, `PuzzleSchema`, and the
`Puzzle`/`McqPuzzle`/`SwipeBinaryPuzzle`/`TapLinePuzzle`/`DragOrderPuzzle`/
`ScrubberPuzzle`/`QuizPuzzle` types. `schema.ts` and `patterns.ts` are
internal, same barrel convention as `storage/`.

`quizPool` and `scrubberPool` partition `puzzlePool` by interaction —
Practice, Daily, and Rush consume `quizPool` (scrubber has its own mode,
Phase 3); the scrubber mode and the dev debug harness consume
`scrubberPool`. Reach for `puzzlePool` itself only where the full union is
genuinely correct: content-wide tooling (`contentStats.ts`,
`validateContent.ts`) and pattern/mastery lookups that must resolve _any_
puzzle id regardless of interaction (`mastery.ts`'s callers). Prefer the
split pools everywhere else — see docs/v2-phase2-review.md (P0) for why an
unfiltered pool reaching a quiz surface is a live bug class, not a style
preference.

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

`cf-009`, `err-011`, and `rec-009` (the initial `drag-order` puzzles) are
hand-authored fixtures, not output from `generatePuzzles.ts` — no generation
run has targeted `drag-order` yet (see `GENERATING_PUZZLES.md` /
`tools/generatePuzzles.ts`'s `Interaction` type, which can target it but
isn't wired into any manifest logic this phase).

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

## Testing standard: UI guarantees about checkpoint presentation must hit real content

Any test asserting what a player actually sees at a Trace checkpoint — a
choice label, a masked value, a reveal string — must run against the real
`scrubberPool` export from `src/content/index.ts`, not a hand-built fixture.
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
