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

export const puzzlePool: Puzzle[] = Object.entries(modules)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([filePath, raw]) => {
    const result = PuzzleSchema.safeParse(raw)
    if (!result.success) {
      throw new Error(`Invalid puzzle content at ${filePath}: ${result.error.message}`)
    }
    return result.data
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
export { BOSS_RUN } from './bossRun'

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
