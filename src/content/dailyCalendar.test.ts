import { describe, expect, it } from 'vitest'
import { DAILY_CALENDAR } from './dailyCalendar'
import { puzzlePool } from './pools'

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
  'nul-001',
  'con-002',
  'mut-002',
  'cf-002',
  'oob-002',
  'tc-002',
  'mut-001',
  'err-001',
  'scl-002',
  'res-003',
  'dsm-001',
  'rec-002',
  'scl-001',
  'dsm-003',
  'con-001',
  'inp-001',
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
})
