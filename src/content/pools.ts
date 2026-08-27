/**
 * The eager, whole-library puzzle pools — `puzzlePool` and its two derived
 * views. Deliberately NOT re-exported from ./index (the barrel every consumer
 * outside src/content/ imports from); live in this separate file precisely
 * so that the eager glob below is a *separate module* from the barrel.
 *
 * Why that matters: ES modules evaluate per file, not per binding. If these
 * were re-exported from index.ts (i.e. `export { puzzlePool } from './pools'`),
 * Rollup would treat pools.ts as side-effectful and keep its top-level `.sort().map()`
 * over the eager glob in every chunk that imports anything from the barrel. That
 * would mean importing anything at all from the barrel (PATTERN_LABELS, puzzleMeta,
 * getPuzzleBody, DEV_STUB_PUZZLES, ...) would drag all 214 puzzle bodies into the
 * importer's chunk — putting the entire content library on every route's critical
 * path (measured: with re-export, 79.74 KB statically; without it, 53.84 KB and
 * zero static imports). Living here lets Rollup drop the whole module when nothing
 * in the production graph reads these three exports (DEV/test still read them freely).
 * Consumers that need `puzzlePool`/`quizPool`/`scrubberPool` must import directly
 * from './pools' (or '../../content/pools', '../../../content/pools' etc. depending
 * on their own depth), never from the barrel.
 *
 * `puzzlePool` aggregates every file under src/content/puzzles/ at
 * build/dev time via Vite's `import.meta.glob`, parsed through
 * PuzzleSchema — so the app can never run against invalid content even if
 * `validate:content` (the CI gate) were somehow bypassed. The CLI tools
 * under tools/ read the same files a different way (straight off disk via
 * Node's fs), since they run outside Vite — see tools/loadPuzzles.ts.
 */
import { PuzzleSchema } from './schema'
import type { Puzzle, QuizPuzzle, ScrubberPuzzle } from './schema'

const modules = import.meta.glob('./puzzles/**/*.json', {
  eager: true,
  import: 'default',
})

// Perf pass (2026-08-24): `pnpm validate:content` (CI-enforced, see
// package.json) already zod-validates every puzzle file at build time —
// content is a build-time constant, so re-deriving that same guarantee
// inside every user's browser on every page load buys nothing in
// production and costs 214 runtime safeParse calls for no benefit. In DEV,
// still validate eagerly — a bad puzzle file should fail loudly the moment
// `pnpm dev`/`pnpm test` picks it up, not silently ship; every test that
// reads `puzzlePool`/`quizPool`/`scrubberPool` directly (see
// content/index.test.ts, bossRun.test.ts, and the *.pool.test.tsx files)
// depends on this branch staying eager and validated.
// import.meta.env.DEV is a Vite build-time constant, inlined as literal
// `false` in a production build, so Rollup dead-code-eliminates the
// unreachable branch below — the safeParse call site and error path are
// tree-shaken away.
export const puzzlePool: Puzzle[] = Object.entries(modules)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([filePath, raw]) => {
    if (import.meta.env.DEV) {
      const result = PuzzleSchema.safeParse(raw)
      if (!result.success) {
        throw new Error(`Invalid puzzle content at ${filePath}: ${result.error.message}`)
      }
      return result.data
    }
    return raw as Puzzle
  })

/**
 * Practice/Daily/Rush's pool — every puzzle except scrubber. Derived once
 * here rather than trusting every consumer to remember to filter: Phase 2's
 * scrubber puzzles were servable (and unplayable) in Practice precisely
 * because `puzzlePool` was passed straight through with no filter at the
 * call site. See docs/v2-phase2-review.md (P0).
 */
export const quizPool: QuizPuzzle[] = puzzlePool.filter(
  (puzzle): puzzle is QuizPuzzle => puzzle.interaction !== 'scrubber',
)

/** The scrubber-only complement of `quizPool` — Phase 3's dedicated scrubber mode consumes this, not `puzzlePool`. */
export const scrubberPool: ScrubberPuzzle[] = puzzlePool.filter(
  (puzzle): puzzle is ScrubberPuzzle => puzzle.interaction === 'scrubber',
)
