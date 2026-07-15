import { describe, expect, it } from 'vitest'
import { getDailyPuzzleIndex, hashDateString } from './daily'

// 2028 is a leap year, so this covers all 366 possible MM-DD combinations,
// including Feb 29.
function allDatesIn2028(): string[] {
  const dates: string[] = []
  const cursor = new Date('2028-01-01T00:00:00Z')
  const end = new Date('2028-12-31T00:00:00Z')

  while (cursor.getTime() <= end.getTime()) {
    const isoDate = cursor.toISOString().slice(0, 10)
    dates.push(isoDate)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return dates
}

describe('hashDateString / getDailyPuzzleIndex', () => {
  it('is deterministic for the same date string', () => {
    const a = getDailyPuzzleIndex('2026-07-15', 150)
    const b = getDailyPuzzleIndex('2026-07-15', 150)
    const c = getDailyPuzzleIndex('2026-07-15', 150)

    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('throws for a zero pool size', () => {
    expect(() => getDailyPuzzleIndex('2026-07-15', 0)).toThrow()
  })

  it('throws for a negative pool size', () => {
    expect(() => getDailyPuzzleIndex('2026-07-15', -5)).toThrow()
  })

  it('produces an in-bounds integer index for every date in a leap year', () => {
    const poolSize = 150
    const dates = allDatesIn2028()
    expect(dates).toHaveLength(366)

    for (const date of dates) {
      const index = getDailyPuzzleIndex(date, poolSize)
      expect(Number.isInteger(index)).toBe(true)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(poolSize)
    }
  })

  it('does not skew the distribution wildly across a full year of dates', () => {
    const poolSize = 150
    const dates = allDatesIn2028()
    const counts = new Map<number, number>()

    for (const date of dates) {
      const index = getDailyPuzzleIndex(date, poolSize)
      counts.set(index, (counts.get(index) ?? 0) + 1)
    }

    // Expected average hits per index is 366/150 ~= 2.44. A generous 4x
    // multiple (~9.76, rounded up to 10) gives plenty of headroom for
    // ordinary hash variance without being a precise statistical claim —
    // it only exists to catch a degenerate hash (e.g. one that always
    // returns the same index).
    const threshold = 10
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(threshold)
    }
  })

  it('produces many distinct indices across a year of dates (hash is not degenerate)', () => {
    const poolSize = 150
    const dates = allDatesIn2028()
    const indices = new Set(dates.map((date) => getDailyPuzzleIndex(date, poolSize)))

    expect(indices.size).toBeGreaterThanOrEqual(50)
  })

  it('exposes the raw hash as an unsigned 32-bit integer', () => {
    const hash = hashDateString('2026-07-15')
    expect(Number.isInteger(hash)).toBe(true)
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThanOrEqual(0xffffffff)
  })
})
