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
import type { Puzzle } from './schema'

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

export { PATTERN_SLUGS, PATTERN_LABELS } from './patterns'
export type { PatternSlug } from './patterns'

export { DAILY_CALENDAR } from './dailyCalendar'

export { DEV_STUB_PUZZLES } from './devPuzzles'

export { PuzzleSchema, MIN_DIFFICULTY, MAX_DIFFICULTY } from './schema'
export type { Puzzle, McqPuzzle, SwipeBinaryPuzzle, TapLinePuzzle } from './schema'
