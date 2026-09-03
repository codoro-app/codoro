import { describe, expect, it } from 'vitest'
import { quizPool, scrubberPool } from './pools'
import { BOSS_SETS } from './bossRun'
import { FIRST_RUN_SET } from './firstRun'

describe('FIRST_RUN_SET — against the real content pool', () => {
  const quizById = new Map(quizPool.map((puzzle) => [puzzle.id, puzzle]))
  const scrubberById = new Map(scrubberPool.map((puzzle) => [puzzle.id, puzzle]))

  it('has exactly 3 entries', () => {
    expect(FIRST_RUN_SET).toHaveLength(3)
  })

  it('every id resolves in either quizPool or scrubberPool, with unique ids', () => {
    for (const id of FIRST_RUN_SET) {
      const found = quizById.has(id) || scrubberById.has(id)
      expect(found, `"${id}" not found in quizPool or scrubberPool`).toBe(true)
    }
    expect(new Set(FIRST_RUN_SET).size).toBe(FIRST_RUN_SET.length)
  })

  it('serves interactions in exactly [tap-line, drag-order, scrubber] order', () => {
    const interactions = FIRST_RUN_SET.map(
      (id) => quizById.get(id)?.interaction ?? scrubberById.get(id)?.interaction,
    )
    expect(interactions).toEqual(['tap-line', 'drag-order', 'scrubber'])
  })

  it('every entry stays inside the [1000, 1300] rating band', () => {
    for (const id of FIRST_RUN_SET) {
      const puzzle = quizById.get(id) ?? scrubberById.get(id)
      if (!puzzle) throw new Error(`"${id}" not found in quizPool or scrubberPool`)
      expect(puzzle.difficulty_rating).toBeGreaterThanOrEqual(1000)
      expect(puzzle.difficulty_rating).toBeLessThanOrEqual(1300)
    }
  })

  // A first-run graduate's first Boss run shouldn't immediately repeat a
  // puzzle they just solved — see firstRun.ts's own doc comment.
  it('shares no ids with any BOSS_SETS entry', () => {
    const bossIds = new Set(BOSS_SETS.flat())
    for (const id of FIRST_RUN_SET) {
      expect(bossIds.has(id), `"${id}" also appears in BOSS_SETS`).toBe(false)
    }
  })
})
