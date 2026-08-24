/**
 * Public entry point for puzzle content.
 *
 * Everything outside src/content/ must import from here, never from
 * schema.ts/patterns.ts directly — same barrel convention as storage/.
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
// production and costs 214 safeParse calls plus the whole zod runtime
// (confirmed on the critical path: schemas-*.js, ~70 KB raw / 19 KB
// transferred, statically imported by this module) before first paint. In
// DEV, still validate eagerly — a bad puzzle file should fail loudly the
// moment `pnpm dev`/`pnpm test` picks it up, not silently ship; every test
// that reads `puzzlePool`/`quizPool`/`scrubberPool` directly (see
// content/index.test.ts, bossRun.test.ts, and the *.pool.test.tsx files)
// depends on this branch staying eager and validated.
// import.meta.env.DEV is a Vite build-time constant, inlined as literal
// `false` in a production build, so Rollup dead-code-eliminates the
// unreachable branch below — same pattern App.tsx already relies on for
// ScrubberDebugPage (see that file's own comment). Verified by grepping
// dist/ after a production build (Step 4 below), not just by reasoning
// about it.
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

export { PATTERN_SLUGS, PATTERN_LABELS } from './patterns'
export type { PatternSlug } from './patterns'

export { DAILY_CALENDAR } from './dailyCalendar'
export { BOSS_SETS, resolveActiveBossSet } from './bossRun'

export { DEV_STUB_PUZZLES } from './devPuzzles'

export { PuzzleSchema, ScrubberSchema, MIN_DIFFICULTY, MAX_DIFFICULTY } from './schema'
export type {
  Puzzle,
  McqPuzzle,
  SwipeBinaryPuzzle,
  TapLinePuzzle,
  DragOrderPuzzle,
  ScrubberPuzzle,
  QuizPuzzle,
} from './schema'
