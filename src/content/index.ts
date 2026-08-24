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
// tree-shaken away. (The zod schema construction graph and runtime remain
// in the bundle due to a pre-existing import chain through devPuzzleMode
// — not addressed by this task; see docs for details.)
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

// Lazy, per-file loaders keyed by path — NOT eager, unlike the `modules`
// glob above that builds puzzlePool. Each call to a loader triggers its
// own dynamic import() of exactly one puzzle's JSON, its own small chunk.
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
