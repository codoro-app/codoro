import { describe, expect, it } from 'vitest'
import type { RushPuzzle } from '../../engine'
import { speculativeRushIds } from './speculativeRushSelection'

const POOL: RushPuzzle[] = Array.from({ length: 12 }, (_, i) => ({
  id: `p${String(i)}`,
  rating: 700 + i * 20,
  interaction: i % 2 === 0 ? 'mcq' : 'swipe-binary',
}))

describe('speculativeRushIds', () => {
  it('returns up to 3 candidate ids, all drawn from the pool and never duplicated within the result', () => {
    const ids = speculativeRushIds({ pool: POOL, difficulty: 800, usedIds: new Set() })

    expect(ids.length).toBeGreaterThan(0)
    expect(ids.length).toBeLessThanOrEqual(3)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(POOL.some((p) => p.id === id)).toBe(true)
    }
  })

  it('never returns an id already in the passed-in usedIds set', () => {
    // Leaves 6 unused (comfortably more than N=3) so this can never spill
    // into rush.ts's pool-exhaustion fallback (see the dedicated test below
    // for that case) — that fallback deliberately DROPS the no-repeat
    // preference once every id is used, so asserting "never in usedIds"
    // against a near-exhausted pool would be asserting something rush.ts
    // itself doesn't guarantee.
    const usedIds = new Set(POOL.slice(0, 6).map((p) => p.id))
    const ids = speculativeRushIds({ pool: POOL, difficulty: 800, usedIds })

    for (const id of ids) {
      expect(usedIds.has(id)).toBe(false)
    }
  })

  it('does not mutate the usedIds set it was given', () => {
    const usedIds = new Set(['p0'])
    const before = new Set(usedIds)
    speculativeRushIds({ pool: POOL, difficulty: 800, usedIds })
    expect(usedIds).toEqual(before)
  })

  it('returns an empty array when the pool is empty', () => {
    expect(speculativeRushIds({ pool: [], difficulty: 800, usedIds: new Set() })).toEqual([])
  })

  it('falls back to a repeat (pool-exhaustion) rather than throwing when every id is already used', () => {
    const usedIds = new Set(POOL.map((p) => p.id))
    const ids = speculativeRushIds({ pool: POOL, difficulty: 800, usedIds })

    // rush.ts's pool-exhaustion fallback drops the no-repeat preference for
    // this one pick rather than returning null — so a speculative draw
    // against a fully-used pool should still surface (repeat) candidates,
    // not silently come back empty.
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(POOL.some((p) => p.id === id)).toBe(true)
    }
  })
})
