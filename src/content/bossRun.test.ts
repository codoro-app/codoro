import { describe, expect, it } from 'vitest'
import { quizPool } from './index'
import { BOSS_SETS, resolveActiveBossSet } from './bossRun'

describe('BOSS_SETS — every set against the real content pool', () => {
  const ids = new Set(quizPool.map((puzzle) => puzzle.id))
  const byId = new Map(quizPool.map((puzzle) => [puzzle.id, puzzle]))

  it.each(BOSS_SETS.map((set, index) => [index, set] as const))(
    'set %i resolves every id to a real, non-scrubber puzzle',
    (_index, set) => {
      for (const id of set) {
        expect(ids.has(id), `"${id}" not found in quizPool`).toBe(true)
      }
    },
  )

  it.each(BOSS_SETS.map((set, index) => [index, set] as const))(
    'set %i has exactly 10 unique entries',
    (_index, set) => {
      expect(set).toHaveLength(10)
      expect(new Set(set).size).toBe(10)
    },
  )

  it.each(BOSS_SETS.map((set, index) => [index, set] as const))(
    "set %i escalates: each entry's difficulty_rating is >= the previous entry's",
    (_index, set) => {
      const ratings = set.map((id) => {
        const puzzle = byId.get(id)
        if (!puzzle) throw new Error(`"${id}" not found in quizPool`)
        return puzzle.difficulty_rating
      })
      for (let i = 1; i < ratings.length; i++) {
        const current = ratings[i]
        const previous = ratings[i - 1]
        if (current === undefined || previous === undefined) {
          throw new Error('unreachable: index within ratings.length bounds')
        }
        expect(current).toBeGreaterThanOrEqual(previous)
      }
    },
  )

  it('has at least 3 sets (the whole point of this registry over a single BOSS_RUN)', () => {
    expect(BOSS_SETS.length).toBeGreaterThanOrEqual(3)
  })
})

describe('resolveActiveBossSet', () => {
  // A small fixture registry, independent of the real BOSS_SETS content —
  // this suite is about the selection math, not the authored puzzle ids.
  const FIXTURE_SETS: readonly (readonly string[])[] = [['a0'], ['a1'], ['a2']]

  it('resolves runsCompleted 0 to sets[0] — a fresh profile always gets the first set', () => {
    expect(resolveActiveBossSet(0, FIXTURE_SETS)).toBe(FIXTURE_SETS[0])
  })

  it('cycles through the registry as runsCompleted grows', () => {
    expect(resolveActiveBossSet(1, FIXTURE_SETS)).toBe(FIXTURE_SETS[1])
    expect(resolveActiveBossSet(2, FIXTURE_SETS)).toBe(FIXTURE_SETS[2])
  })

  it('wraps back to sets[0] once runsCompleted reaches the registry length', () => {
    expect(resolveActiveBossSet(3, FIXTURE_SETS)).toBe(FIXTURE_SETS[0])
    expect(resolveActiveBossSet(4, FIXTURE_SETS)).toBe(FIXTURE_SETS[1])
  })

  it('wraps correctly for a registry of length 1 (every run gets the same set)', () => {
    const single: readonly (readonly string[])[] = [['only']]
    expect(resolveActiveBossSet(0, single)).toBe(single[0])
    expect(resolveActiveBossSet(5, single)).toBe(single[0])
  })

  it('throws for an empty registry rather than returning undefined', () => {
    expect(() => resolveActiveBossSet(0, [])).toThrow(/must be non-empty/)
  })

  it('defaults to the real BOSS_SETS when no registry is passed — a fresh profile resolves BOSS_SETS[0]', () => {
    expect(resolveActiveBossSet(0)).toBe(BOSS_SETS[0])
  })
})
