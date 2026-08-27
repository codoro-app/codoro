/**
 * Speculative "likely next N" candidate ids for Rush's own selection
 * mechanism (`engine/rush.ts`'s `selectRushPuzzle`) — content-metadata-
 * lazy-load Task 5b. Deliberately a separate module from
 * `practice/speculativeSelection.ts`, not a shared generic: `rush.ts` is
 * itself a standalone implementation from `selection.ts` (see its own doc
 * comment — "deliberately not sharing code"), and `selectRushPuzzle`'s
 * input/output shapes (`RushSelectionInput`/`RushSelectionResult`,
 * `ReadonlySet<string>` usedIds instead of an ordered `recentIds` array) are
 * different enough that a shared abstraction would buy nothing over two
 * small, independently-readable files — matching the audit's own reasoning
 * for keeping the engines apart
 * (docs/superpowers/plans/2026-08-24-content-metadata-lazy-load-selection-audit.md,
 * Step 2.1).
 *
 * Per the audit's "Exact parameters for Task 5": `selectRushPuzzle` is
 * unconditionally side-effect-free (no requeue-style state to discard —
 * `usedIds` is only ever `.has()`'d inside the engine, and the hook's own
 * `usedIdsRef.current.add(...)` mutation happens outside it), so re-running
 * it N extra times to approximate a candidate set is exactly as safe as
 * Practice/Trace's mechanism, just with no `requeueState`/`lastSource` to
 * thread through between draws — only `usedIds`, extended with each draw's
 * own pick so the N draws can't collide.
 *
 * N=3, same as Practice/Trace: the audit invites tuning it down given
 * Rush's narrower `MIN_ELIGIBLE=1` pool, but doesn't mandate it. Kept at 3
 * here — cost is still negligible (rush pool cost is O(pool), pool size
 * ~148 at most), and a narrower pool is exactly the case where an extra
 * draw or two is most likely to land on a genuinely different candidate
 * (vs. wide-open Practice, where 3 draws barely dent a 70+ candidate
 * window) — see the audit's own hit-rate note that Rush's candidate set
 * actually *shrinks* over a run as `usedIds` grows, so N=3 costs the same
 * three-fetches-at-most today but keeps paying off better later in a run
 * than it would early on. Tune down later with real telemetry if the extra
 * draws prove not to earn their bandwidth.
 *
 * `rng` is a throwaway generator (same mulberry32 shape
 * `speculativeSelection.ts` uses), deliberately not `Math.random` — see that
 * file's own doc comment for why (nothing reads `Math.random`'s sequence in
 * production today, but speculative draws should never be able to perturb a
 * future seeded-RNG session's sequence either).
 */
import { selectRushPuzzle } from '../../engine'
import type { RushPuzzle, Rng } from '../../engine'

const N_SPECULATIVE = 3

/** mulberry32, seeded fresh per call — see speculativeSelection.ts's identical helper for the full rationale. */
function throwawayRng(): Rng {
  let a = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) | 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SpeculativeRushState {
  readonly pool: readonly RushPuzzle[]
  readonly difficulty: number
  readonly usedIds: ReadonlySet<string>
}

/**
 * Returns up to `N_SPECULATIVE` (3) candidate ids for the puzzle a real
 * `selectRushPuzzle` call is likely to serve next, given the difficulty/
 * usedIds that real call will actually see (post-answer — see
 * useRushSession.ts's handleAnswered for why `pendingDifficultyRef.current`,
 * not the currently-served puzzle's difficulty, is what's passed in). Stops
 * early if a draw returns `null` (empty pool) — nothing further to
 * speculate about.
 */
export function speculativeRushIds(state: SpeculativeRushState): string[] {
  const ids: string[] = []
  let usedIds = state.usedIds

  for (let i = 0; i < N_SPECULATIVE; i++) {
    const result = selectRushPuzzle({
      pool: state.pool,
      difficulty: state.difficulty,
      usedIds,
      rng: throwawayRng(),
    })
    if (result === null) break
    ids.push(result.puzzle.id)
    usedIds = new Set(usedIds).add(result.puzzle.id)
  }

  return ids
}
