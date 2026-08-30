import { describe, expect, it } from 'vitest'
import { DAILY_CALENDAR } from './dailyCalendar'

/**
 * Pins the current DAILY_CALENDAR prefix so an edit, reorder, or removal of
 * an already-shipped entry fails this test instead of silently reshuffling
 * which puzzle every future date serves.
 *
 * Appending a new entry to dailyCalendar.ts? Append the SAME id(s), in the
 * SAME order, to the end of PINNED_PREFIX below — never edit an existing
 * line in this array. If a diff to this file touches anything other than an
 * append at the bottom, something in dailyCalendar.ts violated the
 * append-only contract described in that file's header comment.
 */
const PINNED_PREFIX: readonly string[] = [
  'inp-015',
  'nul-013',
  'con-014',
  'con-015',
  'dsm-025',
  'tc-027',
  'rec-028',
  'err-018',
  'rec-027',
  'mut-025',
  'err-017',
  'scl-027',
  'scl-026',
  'tc-025',
  'mut-027',
  'mut-028',
  'res-015',
  'cf-029',
  'dsm-027',
  'str-015',
  'nul-012',
  'rec-026',
  'str-014',
  'dsm-028',
  'oob-024',
  'tc-024',
  'mut-024',
  'mut-026',
  'cf-032',
  'oob-025',
  'scl-024',
  'oob-026',
  'scl-025',
  'res-016',
  'cf-030',
  'rec-025',
  'dsm-026',
]

describe('DAILY_CALENDAR append-only contract', () => {
  it('never changes an already-pinned prefix', () => {
    expect(DAILY_CALENDAR.slice(0, PINNED_PREFIX.length)).toEqual(PINNED_PREFIX)
  })

  it('has no duplicate ids', () => {
    expect(new Set(DAILY_CALENDAR).size).toBe(DAILY_CALENDAR.length)
  })

  it('is never empty', () => {
    expect(DAILY_CALENDAR.length).toBeGreaterThan(0)
  })
})

import { puzzlePool } from './pools'

describe('DAILY_CALENDAR content-shape gate', () => {
  const byId = new Map(puzzlePool.map((p) => [p.id, p]))

  it('every entry resolves to a real puzzle', () => {
    for (const id of DAILY_CALENDAR) {
      expect(byId.has(id)).toBe(true)
    }
  })

  it('no entry is mcq or swipe-binary', () => {
    const offenders = DAILY_CALENDAR.filter((id) => {
      const puzzle = byId.get(id)
      return puzzle?.interaction === 'mcq' || puzzle?.interaction === 'swipe-binary'
    })
    expect(offenders).toEqual([])
  })

  it('every scrubber entry has at least 6 checkpoints', () => {
    const offenders = DAILY_CALENDAR.filter((id) => {
      const puzzle = byId.get(id)
      return puzzle?.interaction === 'scrubber' && puzzle.checkpoints.length < 6
    })
    expect(offenders).toEqual([])
  })

  it('every drag-order entry has at least 8 blocks', () => {
    const offenders = DAILY_CALENDAR.filter((id) => {
      const puzzle = byId.get(id)
      return puzzle?.interaction === 'drag-order' && puzzle.blocks.length < 8
    })
    expect(offenders).toEqual([])
  })

  it('every tap-line entry has a snippet of at least 15 lines', () => {
    const offenders = DAILY_CALENDAR.filter((id) => {
      const puzzle = byId.get(id)
      return puzzle?.interaction === 'tap-line' && puzzle.snippet.split('\n').length < 15
    })
    expect(offenders).toEqual([])
  })

  it('every entry meets the >= 1600 Daily difficulty floor', () => {
    const offenders = DAILY_CALENDAR.filter((id) => {
      const puzzle = byId.get(id)
      return (puzzle?.difficulty_rating ?? 0) < 1600
    })
    expect(offenders).toEqual([])
  })
})
