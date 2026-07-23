import { describe, expect, it } from 'vitest'
import { RATING_FLOOR } from './rating'
import type { Rng } from './selection'
import {
  RUSH_DIFFICULTY_STEP,
  RUSH_RATING_OFFSET,
  RUSH_STRIKE_LIMIT,
  RUSH_SWIPE_WEIGHT,
  selectRushPuzzle,
  startingRushDifficulty,
  stepDifficulty,
} from './rush'
import type { RushPuzzle } from './rush'

// Deterministic seeded RNG (mulberry32) — same generator selection.test.ts uses.
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

function puzzle(
  id: string,
  rating: number,
  interaction: RushPuzzle['interaction'] = 'mcq',
): RushPuzzle {
  return { id, rating, interaction }
}

describe('startingRushDifficulty', () => {
  it('starts RUSH_RATING_OFFSET points below the user rating', () => {
    expect(startingRushDifficulty(1200)).toBe(1200 - RUSH_RATING_OFFSET)
  })

  it('never goes below RATING_FLOOR', () => {
    expect(startingRushDifficulty(500)).toBe(RATING_FLOOR)
    expect(startingRushDifficulty(RATING_FLOOR)).toBe(RATING_FLOOR)
  })
})

describe('stepDifficulty', () => {
  it('increases by exactly RUSH_DIFFICULTY_STEP', () => {
    expect(stepDifficulty(800)).toBe(800 + RUSH_DIFFICULTY_STEP)
  })
})

describe('selectRushPuzzle — empty pool', () => {
  it('returns null', () => {
    const result = selectRushPuzzle({
      pool: [],
      difficulty: 1000,
      usedIds: new Set(),
      rng: mulberry32(1),
    })
    expect(result).toBeNull()
  })
})

describe('selectRushPuzzle — window & widening', () => {
  it('samples from the ±200 window when it already holds an unused puzzle', () => {
    const pool = [puzzle('p0', 950), puzzle('p1', 1000), puzzle('p2', 1050)]
    const result = selectRushPuzzle({
      pool,
      difficulty: 1000,
      usedIds: new Set(),
      rng: mulberry32(7),
    })
    expect(Math.abs((result?.puzzle.rating ?? 0) - 1000)).toBeLessThanOrEqual(200)
  })

  it('widens the window when the ±200 band has no unused puzzle', () => {
    const far = puzzle('far', 1500)
    const pool = [far]
    const result = selectRushPuzzle({
      pool,
      difficulty: 1000,
      usedIds: new Set(),
      rng: mulberry32(3),
    })
    expect(result?.puzzle.id).toBe('far')
  })
})

describe('selectRushPuzzle — no repeat within a run, with pool-exhaustion fallback', () => {
  it('excludes already-used puzzle ids while an unused one remains', () => {
    const pool = [puzzle('p0', 1000), puzzle('p1', 1000)]
    const result = selectRushPuzzle({
      pool,
      difficulty: 1000,
      usedIds: new Set(['p0']),
      rng: mulberry32(1),
    })
    expect(result?.puzzle.id).toBe('p1')
  })

  it('falls back to repeats rather than returning null once every puzzle has been used', () => {
    const pool = [puzzle('p0', 1000), puzzle('p1', 1000)]
    const result = selectRushPuzzle({
      pool,
      difficulty: 1000,
      usedIds: new Set(['p0', 'p1']),
      rng: mulberry32(1),
    })
    expect(result).not.toBeNull()
    expect(['p0', 'p1']).toContain(result?.puzzle.id)
  })
})

describe('selectRushPuzzle — swipe-binary weighting', () => {
  it('serves roughly RUSH_SWIPE_WEIGHT of draws from swipe-binary over many draws', () => {
    const pool = [
      puzzle('s0', 1000, 'swipe-binary'),
      puzzle('s1', 1000, 'swipe-binary'),
      puzzle('m0', 1000, 'mcq'),
      puzzle('m1', 1000, 'mcq'),
      puzzle('t0', 1000, 'tap-line'),
    ]
    const draws = 500
    let swipeCount = 0
    for (let seed = 0; seed < draws; seed++) {
      const result = selectRushPuzzle({
        pool,
        difficulty: 1000,
        usedIds: new Set(),
        rng: mulberry32(seed),
      })
      if (result?.puzzle.interaction === 'swipe-binary') swipeCount++
    }
    const proportion = swipeCount / draws
    expect(proportion).toBeGreaterThan(RUSH_SWIPE_WEIGHT - 0.15)
    expect(proportion).toBeLessThan(RUSH_SWIPE_WEIGHT + 0.15)
  })

  it('degrades gracefully to non-swipe puzzles when the swipe-binary bucket is empty at this difficulty', () => {
    const pool = [puzzle('m0', 1000, 'mcq'), puzzle('t0', 1000, 'tap-line')]
    for (let seed = 0; seed < 30; seed++) {
      const result = selectRushPuzzle({
        pool,
        difficulty: 1000,
        usedIds: new Set(),
        rng: mulberry32(seed),
      })
      expect(result).not.toBeNull()
      expect(result?.puzzle.interaction).not.toBe('swipe-binary')
    }
  })

  it('degrades gracefully to swipe-binary when the eligible pool is ONLY swipe-binary', () => {
    const pool = [puzzle('s0', 1000, 'swipe-binary')]
    const result = selectRushPuzzle({
      pool,
      difficulty: 1000,
      usedIds: new Set(),
      rng: mulberry32(1),
    })
    expect(result?.puzzle.id).toBe('s0')
  })
})

describe('exported constants', () => {
  it('RUSH_STRIKE_LIMIT is 3 (locked: 3 strikes, no countdown timer)', () => {
    expect(RUSH_STRIKE_LIMIT).toBe(3)
  })
})
