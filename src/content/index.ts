/**
 * Public entry point for puzzle content.
 *
 * Everything outside src/content/ must import from here, never from
 * schema.ts/patterns.ts directly — same barrel convention as storage/.
 *
 * Two deliberate exceptions to that convention, both forced by the same ES
 * fact (modules evaluate per *file*, not per binding) — see each file's own
 * comment:
 *   - `puzzlePool`/`quizPool`/`scrubberPool` live in ./pools and are imported
 *     from there directly (tests, ScrubberDebugPage), not re-exported here.
 *   - src/app/devTools/devPuzzleMode.ts deep-imports ./devPuzzles, so that a
 *     dev-only toggle rendered on every route can't pull this module into
 *     the entry chunk.
 */
import { PuzzleSchema } from './schema'
import type { Puzzle } from './schema'
import { PUZZLE_META } from 'virtual:codoro-puzzle-meta'
import type { PatternSlug } from './patterns'

export interface PuzzleMeta {
  readonly id: string
  readonly pattern: PatternSlug
  readonly difficulty_rating: number
  readonly interaction: Puzzle['interaction']
}

// Perf pass follow-up (2026-08-24): every puzzle's id/pattern/
// difficulty_rating/interaction, generated at build/dev-server-start time
// by vite.config.ts's puzzleMetaPlugin straight off disk (not derived from
// puzzlePool below) — see that plugin's own comment for why. Consumers
// that only need to select a puzzle or bucket data by pattern (mastery
// calculations, pool selection) should read this, not puzzlePool/quizPool
// — it never pulls a single puzzle body (snippet/choices/explanation/...)
// into the bundle. See docs/superpowers/plans/2026-08-24-content-metadata-lazy-load.md.
export const puzzleMeta: PuzzleMeta[] = PUZZLE_META as PuzzleMeta[]

// NOTE: `puzzlePool`/`quizPool`/`scrubberPool` are deliberately NOT
// re-exported here — import them from '../../content/pools' instead. A
// re-export would defeat the whole point of the split: Rollup treats
// pools.ts as side-effectful (its top-level `.sort().map()` over the eager
// glob can't be proven pure), so `export { puzzlePool } from './pools'`
// keeps that module — and its 214 static puzzle-JSON imports — in every
// chunk that touches this barrel, even when nothing reads the binding.
// Measured, not assumed: with the re-export, dist/assets/content-*.js was
// 79.74 KB and statically imported all 214 puzzle chunks; without it, 53.84 KB
// and zero. See docs/superpowers/plans/2026-08-24-content-metadata-lazy-load.md.

// Lazy, per-file loaders keyed by path — NOT eager, unlike ./pools's glob
// that builds puzzlePool. Each call to a loader triggers its own dynamic
// import() of exactly one puzzle's JSON, its own small chunk.
const bodyLoaders = import.meta.glob('./puzzles/**/*.json', {
  import: 'default',
}) as Record<string, () => Promise<unknown>>

// Returns the [path, loader] entry itself, not just the path — with
// noUncheckedIndexedAccess on (tsconfig.app.json), re-indexing bodyLoaders
// by a key derived from Object.keys() still types as possibly-undefined,
// so this hands back the loader function found in the same pass instead.
function loaderEntryForId(id: string): [path: string, loader: () => Promise<unknown>] | undefined {
  return Object.entries(bodyLoaders).find(
    ([path]) => path.slice(path.lastIndexOf('/') + 1) === `${id}.json`,
  )
}

/**
 * Loads and validates a single puzzle body by id, on demand — the only way
 * to get a full Puzzle (snippet/choices/explanation/...) outside DEV/test,
 * where puzzlePool above still holds everything eagerly. Always
 * zod-validates (even in production, unlike puzzlePool's DEV-only
 * validation): this runs once per real navigation/prefetch, not 214x
 * before first paint, so the cost is negligible and the safety net is
 * worth keeping. Returns undefined for an unknown id rather than
 * throwing — every call site (Task 5/6 of the follow-up plan) treats a
 * missing puzzle as a real, expected case (a stale/broken shared link),
 * not a bug.
 */
export async function getPuzzleBody(id: string): Promise<Puzzle | undefined> {
  const entry = loaderEntryForId(id)
  if (!entry) return undefined
  const [key, loader] = entry
  const raw = await loader()
  const result = PuzzleSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid puzzle content at ${key}: ${result.error.message}`)
  }
  return result.data
}

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
