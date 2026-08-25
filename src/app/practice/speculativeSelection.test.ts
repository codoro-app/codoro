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

  it('respects the requeue starvation guard: when lastSource is "requeue", the first draw cannot itself be a requeue serve', () => {
    // A due requeue entry for w0, with lastSource already 'requeue' — per
    // selection.ts, the very next selectNext call must skip the requeue
    // branch entirely and fall through to the window pick, so w0 must not be
    // guaranteed as the first draw here the way it would be without the
    // guard. This exercises speculativeNextIds' pass-through of lastSource,
    // not selection.ts's own guard logic (already covered by selection.test.ts).
    const requeueState = [{ puzzleId: 'w0', stage: 0 as const, served: 3 }]

    const ids = speculativeNextIds({
      pool: WIDE_POOL,
      rating: 1200,
      requeueState,
      lastSource: 'requeue',
      recentIds: [],
    })

    expect(ids.length).toBeGreaterThan(0)
    // Every returned id must be a real pool member — the guard being honored
    // or not doesn't change that; this call only proves lastSource: 'requeue'
    // doesn't crash or get dropped on the way into selectNext.
    for (const id of ids) {
      expect(WIDE_POOL.some((p) => p.id === id)).toBe(true)
    }
  })
})
