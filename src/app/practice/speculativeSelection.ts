/**
 * Speculative "likely next N" candidate ids for Practice/Trace's shared
 * selection mechanism (`engine/selectNext`) — content-metadata-lazy-load
 * Task 5. Per the selection audit
 * (docs/superpowers/plans/2026-08-24-content-metadata-lazy-load-selection-audit.md,
 * Step 3): no natural top-K exists in `selectNext` (nothing is ever scored),
 * but `selectNext` is verifiably pure and O(pool)-cheap (see the audit's
 * Step 1.2), so re-running it N extra times approximates a candidate set at
 * negligible cost relative to a network fetch.
 *
 * Every draw here is fully speculative — each `SelectionResult` except its
 * `puzzle.id` is discarded, never committed to real session state. That's
 * what makes calling this safe: `selectNext`'s requeue ladder only actually
 * advances when a caller stores `result.newRequeueState` (every real caller
 * does that as an explicit, separate step — see selection.ts's own module
 * doc and the audit's Step 1.2), and nothing here ever does.
 *
 * Draw i+1 chains off draw i's own result — `requeueState`/`lastSource` as
 * they would be immediately after draw i actually happened, and `recentIds`
 * extended with draw i's own pick — so the N draws can't collide with each
 * other the way N independent draws against the same starting state could.
 *
 * `rng` is a throwaway generator, deliberately NOT `Math.random` — a
 * separate PRNG instance whose sequence nothing else reads, so speculative
 * draws can never perturb a sequence a future seeded-RNG session might rely
 * on (see the audit's Step 1.2 caveat). Every real call site passes
 * `Math.random` today, so this doesn't fix an active bug — it's cheap
 * insurance against one that doesn't exist yet.
 */
import { selectNext } from '../../engine'
import type { Puzzle as EnginePuzzle, RequeueState, Rng, SelectionSource } from '../../engine'

const N_SPECULATIVE = 3

/** mulberry32 — the same tiny deterministic generator selection.test.ts and useTraceSession.selection.test.ts already use, seeded fresh per call so it never repeats (or shares) a sequence any other caller could observe or depend on. */
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

export interface SpeculativeSelectionState {
  readonly pool: readonly EnginePuzzle[]
  readonly rating: number
  readonly requeueState: RequeueState
  readonly lastSource: SelectionSource | null
  readonly recentIds: readonly string[]
}

/**
 * Returns up to `N_SPECULATIVE` (3) candidate ids for the puzzle a real
 * `selectNext` call is likely to serve next, given the state that real call
 * will actually see (post-answer rating/requeueState — see this task's own
 * report for why the caller must compute those FIRST, before calling this).
 * Stops early if a draw returns `null` (empty pool) — nothing further to
 * speculate about.
 */
export function speculativeNextIds(state: SpeculativeSelectionState): string[] {
  const ids: string[] = []
  let requeueState = state.requeueState
  let lastSource = state.lastSource
  let recentIds = state.recentIds

  for (let i = 0; i < N_SPECULATIVE; i++) {
    const result = selectNext({
      pool: state.pool,
      rating: state.rating,
      recentIds,
      requeueState,
      lastSource,
      rng: throwawayRng(),
    })
    if (result === null) break
    ids.push(result.puzzle.id)
    requeueState = result.newRequeueState
    lastSource = result.source
    recentIds = [result.puzzle.id, ...recentIds]
  }

  return ids
}
