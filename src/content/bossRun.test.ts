import { describe, expect, it } from 'vitest'
import { quizPool } from './index'
import { BOSS_RUN } from './bossRun'

describe('BOSS_RUN — against the real content pool', () => {
  it('resolves every id to a real, non-scrubber puzzle', () => {
    const ids = new Set(quizPool.map((puzzle) => puzzle.id))
    for (const id of BOSS_RUN) {
      expect(ids.has(id), `"${id}" not found in quizPool`).toBe(true)
    }
  })

  it('has exactly 10 unique entries', () => {
    expect(BOSS_RUN).toHaveLength(10)
    expect(new Set(BOSS_RUN).size).toBe(10)
  })

  it("escalates: each entry's difficulty_rating is >= the previous entry's", () => {
    const byId = new Map(quizPool.map((puzzle) => [puzzle.id, puzzle]))
    const ratings = BOSS_RUN.map((id) => {
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
  })
})
