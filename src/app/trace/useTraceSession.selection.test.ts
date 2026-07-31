import { describe, expect, it } from 'vitest'
import { emptyRequeueState, selectNext } from '../../engine'
import type { Puzzle as EnginePuzzle, Rng, SelectionSource } from '../../engine'
import { traceRecentIdsWindow } from './useTraceSession'

/**
 * Small-pool investigation (build-plan Task 1, item 6) — see
 * useTraceSession.ts's `traceRecentIdsWindow` doc comment for the full
 * writeup. This file proves both halves of that finding directly against
 * engine's real `selectNext`, using a 5-item fixture pool matching
 * `scrubberPool`'s current pilot size:
 *
 * 1. `selectNext` never gets stuck (never returns `null`, MIN_ELIGIBLE=10
 *    notwithstanding) against a 5-item pool.
 * 2. Practice's flat RECENT_IDS_WINDOW (20) applied unmodified to a 5-item
 *    pool eventually lets the just-served puzzle repeat immediately —
 *    Trace's clamped `poolSize - 1` window structurally prevents that for
 *    as long as the pool has 2+ puzzles.
 *
 * The clamp itself (`traceRecentIdsWindow`) is imported from the real
 * useTraceSession.ts module below rather than re-declared locally — a local
 * copy would keep this whole suite green even if the shipped function
 * regressed (e.g. someone silently reverted it back to the flat
 * PRACTICE_RECENT_IDS_WINDOW).
 */

// Deterministic seeded RNG (mulberry32) — same generator selection.test.ts
// itself uses, reproducible in [0, 1).
function mulberry32(seed: number): Rng {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Mirrors scrubberPool's actual pilot size/rating spread closely enough to
// exercise the same widening path real Trace content does.
const FIVE_ITEM_POOL: EnginePuzzle[] = [
  { id: 's0', rating: 1100 },
  { id: 's1', rating: 1300 },
  { id: 's2', rating: 1400 },
  { id: 's3', rating: 1500 },
  { id: 's4', rating: 1700 },
]

describe('selectNext against a 5-item pool (scrubberPool pilot-content size)', () => {
  it('never returns null across a long run, despite MIN_ELIGIBLE (10) exceeding the pool size', () => {
    let requeueState = emptyRequeueState
    let lastSource: SelectionSource | null = null
    const recentIds: string[] = []

    for (let tick = 0; tick < 200; tick++) {
      const result = selectNext({
        pool: FIVE_ITEM_POOL,
        rating: 1200,
        recentIds,
        requeueState,
        rng: mulberry32(tick),
        lastSource,
      })
      expect(result).not.toBeNull()
      if (!result) throw new Error('unreachable — asserted above')
      lastSource = result.source
      requeueState = result.newRequeueState
      recentIds.unshift(result.puzzle.id)
      recentIds.length = Math.min(recentIds.length, 20)
    }
  })

  it('Practice-style flat window (20) eventually lets the just-served puzzle repeat on the very next serve', () => {
    // rng fixed at 0: sample() always picks index 0 of whatever candidate
    // list survives the recency filter — once recentIds saturates all 5
    // ids (guaranteed within the pool's own size well under a 20-wide
    // window), notRecent goes permanently empty and pickFromWindow falls
    // back to the *unfiltered* eligible set, which starts back at index 0
    // — i.e. the same puzzle most recently served can come right back.
    let requeueState = emptyRequeueState
    let lastSource: SelectionSource | null = null
    const recentIds: string[] = []
    const servedIds: string[] = []

    for (let tick = 0; tick < 30; tick++) {
      const result = selectNext({
        pool: FIVE_ITEM_POOL,
        rating: 1200,
        recentIds,
        requeueState,
        rng: () => 0,
        lastSource,
      })
      if (!result) throw new Error('expected a puzzle')
      lastSource = result.source
      requeueState = result.newRequeueState
      servedIds.push(result.puzzle.id)
      recentIds.unshift(result.puzzle.id)
      recentIds.length = Math.min(recentIds.length, 20) // Practice's flat window, unmodified
    }

    const hasImmediateRepeat = servedIds.some((id, i) => i > 0 && id === servedIds[i - 1])
    expect(hasImmediateRepeat).toBe(true)
  })

  it('Trace-clamped window (poolSize - 1) never lets the just-served puzzle repeat on the next serve, same rng/pool', () => {
    let requeueState = emptyRequeueState
    let lastSource: SelectionSource | null = null
    const recentIds: string[] = []
    const servedIds: string[] = []
    const window = traceRecentIdsWindow(FIVE_ITEM_POOL.length)

    for (let tick = 0; tick < 30; tick++) {
      const result = selectNext({
        pool: FIVE_ITEM_POOL,
        rating: 1200,
        recentIds,
        requeueState,
        rng: () => 0,
        lastSource,
      })
      if (!result) throw new Error('expected a puzzle')
      lastSource = result.source
      requeueState = result.newRequeueState
      servedIds.push(result.puzzle.id)
      recentIds.unshift(result.puzzle.id)
      recentIds.length = Math.min(recentIds.length, window)
    }

    const hasImmediateRepeat = servedIds.some((id, i) => i > 0 && id === servedIds[i - 1])
    expect(hasImmediateRepeat).toBe(false)
  })
})
