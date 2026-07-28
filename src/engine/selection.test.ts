import { describe, expect, it } from 'vitest'
import type { Puzzle, Rng, SelectionSource } from './selection'
import { selectNext } from './selection'
import type { RequeueState } from './requeue'
import { advance, emptyRequeueState, recordMiss } from './requeue'

// Deterministic seeded RNG (mulberry32) — reproducible, in [0, 1).
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

function pool(...ratings: readonly number[]): Puzzle[] {
  return ratings.map((rating, i) => ({ id: `p${String(i)}@${String(rating)}`, rating }))
}

// noUncheckedIndexedAccess-safe element access (no non-null assertions allowed).
function at(puzzles: readonly Puzzle[], index: number): Puzzle {
  const puzzle = puzzles[index]
  if (puzzle === undefined) {
    throw new Error(`no puzzle at index ${String(index)}`)
  }
  return puzzle
}

describe('selectNext — empty pool', () => {
  it('returns null and does not need to advance the ladder', () => {
    const result = selectNext({
      pool: [],
      rating: 1000,
      recentIds: [],
      requeueState: emptyRequeueState,
      rng: mulberry32(1),
      lastSource: null,
    })
    expect(result).toBeNull()
  })
})

describe('selectNext — rating window & widening', () => {
  it('samples from the ±200 window when it already holds >= 10 puzzles', () => {
    // 12 puzzles all within ±150; widening must NOT trigger.
    const p = pool(850, 900, 950, 1000, 1050, 1100, 1150, 950, 1000, 1050, 900, 1100)
    const result = selectNext({
      pool: p,
      rating: 1000,
      recentIds: [],
      requeueState: emptyRequeueState,
      rng: mulberry32(42),
      lastSource: null,
    })
    expect(result?.source).toBe('window')
    expect(Math.abs((result?.puzzle.rating ?? 0) - 1000)).toBeLessThanOrEqual(200)
  })

  it('widens the window when the ±200 band has fewer than 10 puzzles', () => {
    // 6 near (within ±200) + 6 far (distance 250–300). ±200 => 6 eligible (<10);
    // ±300 => all 12 eligible. A far puzzle being served proves widening.
    const near = pool(1000, 1050, 950, 1100, 900, 1150)
    const far = [1250, 1260, 1270, 1280, 1290, 1300].map((rating, i) => ({
      id: `far${String(i)}`,
      rating,
    }))
    const p = [...near, ...far]

    // Search seeds until one lands on a far puzzle, proving the far band is in
    // the sampled (widened) candidate set. Deterministic given the seed.
    let servedFar: Puzzle | undefined
    for (let seed = 0; seed < 50 && !servedFar; seed++) {
      const result = selectNext({
        pool: p,
        rating: 1000,
        recentIds: [],
        requeueState: emptyRequeueState,
        rng: mulberry32(seed),
        lastSource: null,
      })
      if (result && result.puzzle.rating > 1200) {
        servedFar = result.puzzle
      }
    }
    expect(servedFar).toBeDefined()
    expect(Math.abs((servedFar?.rating ?? 0) - 1000)).toBeGreaterThan(200)
  })

  it('terminates and returns a puzzle when the whole pool never reaches 10', () => {
    // Tiny, widely-spread pool: widening can never reach 10 but must not loop.
    const p = pool(200, 1000, 3000)
    const result = selectNext({
      pool: p,
      rating: 1000,
      recentIds: [],
      requeueState: emptyRequeueState,
      rng: mulberry32(7),
      lastSource: null,
    })
    expect(result?.source).toBe('window')
    expect(p).toContainEqual(result?.puzzle)
  })
})

describe('selectNext — no-repeat-within-20', () => {
  it('excludes recently-served puzzles in the common case', () => {
    const p = pool(950, 1000, 1050, 900, 1100, 980, 1020, 970, 1030, 960, 1040, 990)
    // Exclude every id except one; that one must be served regardless of rng.
    const survivor = at(p, 3)
    const recentIds = p.filter((puzzle) => puzzle.id !== survivor.id).map((puzzle) => puzzle.id)

    const result = selectNext({
      pool: p,
      rating: 1000,
      recentIds,
      requeueState: emptyRequeueState,
      rng: mulberry32(3),
      lastSource: null,
    })
    expect(result?.puzzle.id).toBe(survivor.id)
  })

  it('softly allows repeats when excluding them would empty the pool', () => {
    const p = pool(950, 1000, 1050, 900, 1100, 980, 1020, 970, 1030, 960, 1040, 990)
    const recentIds = p.map((puzzle) => puzzle.id) // every eligible puzzle is "recent"

    const result = selectNext({
      pool: p,
      rating: 1000,
      recentIds,
      requeueState: emptyRequeueState,
      rng: mulberry32(9),
      lastSource: null,
    })
    expect(result).not.toBeNull()
    expect(p).toContainEqual(result?.puzzle)
  })
})

describe('selectNext — requeue injection', () => {
  it('serves a due requeue puzzle with priority and advances its stage', () => {
    const p = pool(1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1110)
    const missId = at(p, 0).id

    // Miss then tick twice; selectNext's own advance makes it due (served 3).
    let state: RequeueState = recordMiss(emptyRequeueState, missId)
    state = advance(state).state
    state = advance(state).state

    const result = selectNext({
      pool: p,
      rating: 1000,
      recentIds: [missId], // even though "recent", the requeue path ignores that
      requeueState: state,
      rng: mulberry32(1),
      lastSource: null,
    })
    expect(result?.source).toBe('requeue')
    expect(result?.puzzle.id).toBe(missId)
    expect(result?.newRequeueState).toEqual([{ puzzleId: missId, stage: 1, served: 0 }])
  })

  it('picks the earliest-missed due entry when several are due on one tick', () => {
    const p = pool(1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1110)
    const first = at(p, 0).id
    const second = at(p, 1).id

    let state: RequeueState = recordMiss(emptyRequeueState, first)
    state = recordMiss(state, second)
    state = advance(state).state
    state = advance(state).state // both served 2; selectNext advances to 3 (both due)

    const result = selectNext({
      pool: p,
      rating: 1000,
      recentIds: [],
      requeueState: state,
      rng: mulberry32(1),
      lastSource: null,
    })
    expect(result?.source).toBe('requeue')
    expect(result?.puzzle.id).toBe(first)
    // The un-served, still-due entry remains in the returned state.
    expect(result?.newRequeueState).toEqual([
      { puzzleId: first, stage: 1, served: 0 },
      { puzzleId: second, stage: 0, served: 3 },
    ])
  })

  it('skips a due entry whose puzzle vanished from the pool and picks from the window', () => {
    const p = pool(1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1110)

    let state: RequeueState = recordMiss(emptyRequeueState, 'ghost') // not in pool
    state = advance(state).state
    state = advance(state).state

    const result = selectNext({
      pool: p,
      rating: 1000,
      recentIds: [],
      requeueState: state,
      rng: mulberry32(5),
      lastSource: null,
    })
    expect(result?.source).toBe('window')
    expect(p).toContainEqual(result?.puzzle)
    // The ghost entry ticked but was not resurfaced (still stage 0).
    expect(result?.newRequeueState).toEqual([{ puzzleId: 'ghost', stage: 0, served: 3 }])
  })
})

describe('selectNext — requeue starvation guard', () => {
  it('never serves two requeue entries back to back, even when several are simultaneously due', () => {
    const p = pool(1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1110)
    let state: RequeueState = emptyRequeueState
    for (const id of ['a', 'b', 'c', 'd']) {
      state = recordMiss(state, id)
    }

    // Drive 20 ticks, answering every served puzzle correctly (no more misses)
    // — mirrors the "missed a handful early, then recovers" scenario. Without
    // the guard, entries a-d would be served in an uninterrupted block
    // (verified by simulation before this fix existed).
    let lastSource: SelectionSource | null = null
    const sources: SelectionSource[] = []
    for (let tick = 0; tick < 20; tick++) {
      const result = selectNext({
        pool: p,
        rating: 1000,
        recentIds: [],
        requeueState: state,
        rng: mulberry32(tick),
        lastSource,
      })
      if (!result) throw new Error('expected a puzzle')
      sources.push(result.source)
      lastSource = result.source
      state = result.newRequeueState
    }

    for (let i = 1; i < sources.length; i++) {
      const previous = sources[i - 1]
      const current = sources[i]
      if (previous === 'requeue' && current === 'requeue') {
        throw new Error(`two requeue serves back to back at index ${String(i)}`)
      }
    }
  })

  it('keeps serving fresh window picks even when every requeued puzzle is missed again', () => {
    // The pathological case: a struggling learner who keeps missing the same
    // few puzzles. Each miss resets that entry's ladder to a 3-tick
    // countdown (requeue.ts's recordMiss), and with 3 entries cycling on
    // that reset, a due entry existed on literally every tick under the old
    // (unguarded) selectNext — window picks never ran again. Confirms the
    // guard bounds the requeue share of servings to at most half.
    const p = pool(1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1110)
    let state: RequeueState = emptyRequeueState
    for (const id of ['a', 'b', 'c']) {
      state = recordMiss(state, id)
    }

    let lastSource: SelectionSource | null = null
    let windowCount = 0
    const total = 30
    for (let tick = 0; tick < total; tick++) {
      const result = selectNext({
        pool: p,
        rating: 1000,
        recentIds: [],
        requeueState: state,
        rng: mulberry32(tick),
        lastSource,
      })
      if (!result) throw new Error('expected a puzzle')
      lastSource = result.source
      state = result.newRequeueState
      if (result.source === 'window') {
        windowCount++
      } else {
        // Simulate missing the requeued puzzle again.
        state = recordMiss(state, result.puzzle.id)
      }
    }

    expect(windowCount).toBeGreaterThanOrEqual(total / 2 - 1)
  })
})

describe('selectNext — determinism', () => {
  it('produces identical output for the same seed and inputs', () => {
    const p = pool(950, 1000, 1050, 900, 1100, 980, 1020, 970, 1030, 960, 1040, 990)
    const run = (): ReturnType<typeof selectNext> =>
      selectNext({
        pool: p,
        rating: 1000,
        recentIds: [],
        requeueState: emptyRequeueState,
        rng: mulberry32(12345),
        lastSource: null,
      })
    expect(run()).toEqual(run())
  })
})

describe('selectNext — defensive sampling guard', () => {
  it('throws if the injected rng returns an out-of-contract value (>= 1)', () => {
    const p = pool(1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1110)
    expect(() =>
      selectNext({
        pool: p,
        rating: 1000,
        recentIds: [],
        requeueState: emptyRequeueState,
        rng: () => 1,
        lastSource: null,
      }),
    ).toThrow(/out of range/)
  })
})
