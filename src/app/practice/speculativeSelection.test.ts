import { describe, expect, it } from 'vitest'
import { emptyRequeueState } from '../../engine'
import type { Puzzle as EnginePuzzle } from '../../engine'
import { speculativeNextIds } from './speculativeSelection'

// A wide, evenly-spaced pool so the ±200 base window plus widening always
// has plenty of eligible candidates — keeps every draw in this file on the
// (uniform, unranked) window path rather than needing requeue fixtures.
const WIDE_POOL: EnginePuzzle[] = Array.from({ length: 20 }, (_, i) => ({
  id: `w${String(i)}`,
  rating: 1000 + i * 20,
}))

describe('speculativeNextIds', () => {
  it('returns up to 3 candidate ids from the pool', () => {
    const ids = speculativeNextIds({
      pool: WIDE_POOL,
      rating: 1200,
      requeueState: emptyRequeueState,
      lastSource: null,
      recentIds: [],
    })

    expect(ids.length).toBeLessThanOrEqual(3)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(WIDE_POOL.some((p) => p.id === id)).toBe(true)
    }
  })

  it('the 3 draws never repeat an id against each other (chained recentIds)', () => {
    const ids = speculativeNextIds({
      pool: WIDE_POOL,
      rating: 1200,
      requeueState: emptyRequeueState,
      lastSource: null,
      recentIds: [],
    })

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns an empty array for an empty pool, without throwing', () => {
    const ids = speculativeNextIds({
      pool: [],
      rating: 1200,
      requeueState: emptyRequeueState,
      lastSource: null,
      recentIds: [],
    })

    expect(ids).toEqual([])
  })

  it('does not mutate the requeueState it was given (pure — safe to discard every result)', () => {
    const requeueState = [{ puzzleId: 'w0', stage: 0 as const, served: 2 }]
    const snapshotBefore = JSON.stringify(requeueState)

    speculativeNextIds({
      pool: WIDE_POOL,
      rating: 1200,
      requeueState,
      lastSource: null,
      recentIds: [],
    })

    expect(JSON.stringify(requeueState)).toBe(snapshotBefore)
  })

  it('is deterministic in candidate SET across repeated calls with the same real inputs only insofar as it always draws from the same eligible window (not asserting exact ids — draws use a throwaway rng)', () => {
    // Repeated calls must never throw and must always stay within the pool —
    // this is the practical, rng-independent invariant callers rely on.
    for (let i = 0; i < 10; i++) {
      const ids = speculativeNextIds({
        pool: WIDE_POOL,
        rating: 1200,
        requeueState: emptyRequeueState,
        lastSource: null,
        recentIds: [],
      })
      for (const id of ids) {
        expect(WIDE_POOL.some((p) => p.id === id)).toBe(true)
      }
    }
  })

  it('respects the requeue starvation guard: draw 1 is the due entry when lastSource is null, and is NOT the due entry when lastSource is "requeue"', () => {
    // Fix-round finding #5: the previous version of this test only proved
    // `lastSource: 'requeue'` doesn't crash or get silently dropped on the
    // way into `selectNext` — it never actually asserted the guard's real
    // behaviour (a due entry MUST win draw 1 when eligible, and MUST NOT
    // when starved), so a regression that broke `lastSource` pass-through
    // entirely would have gone undetected.
    //
    // w0 due after exactly one `advance()` tick: stage 0's ladder interval
    // is 3 (requeue.ts's LADDER_INTERVALS), so `served: 2` becomes `3` (due)
    // on draw 1's own internal `advance()` call.
    const requeueState = [{ puzzleId: 'w0', stage: 0 as const, served: 2 }]
    // w0 rated far outside the ±200 rating window (and the rest of the pool
    // already supplies >= MIN_ELIGIBLE (10) within that window, so widening
    // never reaches out to it) — isolates the requeue-priority path from
    // window-sampling noise: w0 can only ever be draw 1's pick via the
    // requeue branch, never as an ordinary window candidate.
    const poolWithFarOutlier: typeof WIDE_POOL = [
      { id: 'w0', rating: 1200 + 5000 },
      ...WIDE_POOL.slice(1),
    ]

    const whenEligible = speculativeNextIds({
      pool: poolWithFarOutlier,
      rating: 1200,
      requeueState,
      lastSource: null,
      recentIds: [],
    })
    // No randomness on the requeue path (selection.ts's `due` loop returns
    // the first in-pool due entry directly, no `sample()` call) — draw 1
    // must be exactly w0, not just "eventually" one of the 3 draws.
    expect(whenEligible[0]).toBe('w0')

    const whenStarved = speculativeNextIds({
      pool: poolWithFarOutlier,
      rating: 1200,
      requeueState,
      lastSource: 'requeue',
      recentIds: [],
    })
    // Only draw 1 is asserted here, not the whole array: the starvation
    // guard is a PER-TICK check (selection.ts's own `lastSource` doc
    // comment), so draw 2 legitimately reopens the requeue branch once
    // draw 1's own result carries `source: 'window'` forward — w0
    // reappearing later in the chain is correct, not a guard failure.
    expect(whenStarved[0]).not.toBe('w0')
  })
})
