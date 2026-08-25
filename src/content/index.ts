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
 *     Enforced mechanically, not just by comment: barrelBoundary.test.ts
 *     fails if any file imports those names from a '.../content' path.
 *   - `DEV_STUB_PUZZLES` lives in ./devPuzzles and is deep-imported from
 *     there by its four consumers (devPuzzleMode.ts and the Practice/Rush/
 *     Trace session hooks), so that dev-only stub content can't be pulled
 *     into a production chunk. Their own `import.meta.env.DEV` guards are
 *     necessary but NOT sufficient: module inclusion is decided by whether
 *     the FILE is reachable, so a `export { DEV_STUB_PUZZLES } from
 *     './devPuzzles'` re-export here put the stubs in the production entry
 *     chunk regardless of those guards (confirmed in a real build by the
 *     final whole-branch review).
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

/**
 * The metadata-only counterparts of ./pools's `quizPool`/`scrubberPool`,
 * partitioning `puzzleMeta` by interaction with the identical predicates.
 *
 * Derived once here, for the same reason the pools are (see pools.ts's own
 * comment): Phase 2's scrubber puzzles were servable — and unplayable — in
 * Practice precisely because an unfiltered pool was passed straight through
 * with no filter at the call site (docs/v2-phase2-review.md, P0). The
 * metadata path introduced by this perf pass initially re-opened that gap by
 * having each of Practice/Trace re-implement `interaction !== 'scrubber'`
 * against raw `puzzleMeta` independently; these two exports close it again.
 * Prefer them over filtering `puzzleMeta` by hand at a call site.
 *
 * Pure `.filter()`s over an array that's already fully in memory — unlike the
 * pools, these pull no puzzle bodies and cost nothing beyond the walk.
 *
 * Rush deliberately does NOT build on `quizMeta`: its eligibility rule is a
 * positive allow-list (mcq/swipe-binary/tap-line — see `isRushEligible` in
 * useRushSession.ts), not "everything except scrubber", so drag-order is
 * excluded there but present here. That's a genuinely different rule, not
 * duplicated filtering.
 */
export const quizMeta: PuzzleMeta[] = puzzleMeta.filter((meta) => meta.interaction !== 'scrubber')

/** The scrubber-only complement of `quizMeta` — Trace's selection pool. See `quizMeta`'s comment. */
export const scrubberMeta: PuzzleMeta[] = puzzleMeta.filter(
  (meta) => meta.interaction === 'scrubber',
)

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
 * where ./pools's `puzzlePool` still holds everything eagerly. Always
 * zod-validates (even in production, unlike `puzzlePool`'s DEV-only
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

// NOTE: `DEV_STUB_PUZZLES` is deliberately NOT re-exported here either —
// import it from './devPuzzles' ('../../content/devPuzzles' etc.) instead.
// See this file's header comment for why the consumers' own
// `import.meta.env.DEV` guards can't do this job on their own.

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
