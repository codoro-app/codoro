import { describe, expect, it } from 'vitest'
import { DAILY_EPOCH, getDailyCalendarIndex, getDailyNumber } from './daily'

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

/** `count` consecutive date strings starting at `start` (inclusive). */
function consecutiveDates(start: string, count: number): string[] {
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)

  for (let i = 0; i < count; i++) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return dates
}

describe('getDailyCalendarIndex', () => {
  it('is deterministic for the same date and calendar length', () => {
    const a = getDailyCalendarIndex('2026-07-15', 16)
    const b = getDailyCalendarIndex('2026-07-15', 16)
    const c = getDailyCalendarIndex('2026-07-15', 16)

    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('throws for a zero calendar length', () => {
    expect(() => getDailyCalendarIndex('2026-07-15', 0)).toThrow()
  })

  it('throws for a negative calendar length', () => {
    expect(() => getDailyCalendarIndex('2026-07-15', -5)).toThrow()
  })

  it('produces an in-bounds integer index for every date in a leap year, across several calendar lengths', () => {
    const dates = allDatesIn2028()
    expect(dates).toHaveLength(366)

    for (const calendarLength of [1, 5, 16, 40, 150]) {
      for (const date of dates) {
        const index = getDailyCalendarIndex(date, calendarLength)
        expect(Number.isInteger(index)).toBe(true)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(calendarLength)
      }
    }
  })

  it('handles dates before DAILY_EPOCH (negative day-index) without going out of bounds', () => {
    const beforeEpoch = ['2025-01-01', '2025-12-31', '2000-06-15']
    for (const date of beforeEpoch) {
      const index = getDailyCalendarIndex(date, 16)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(16)
    }
  })

  it('wraps once the day-index runs past the end of the calendar — documented degraded mode', () => {
    const calendarLength = 5
    // Day-index 0 and day-index `calendarLength` (exactly one full lap later)
    // must land on the same entry — proof the fallback is modulo, not a clamp.
    const dates = consecutiveDates(DAILY_EPOCH, calendarLength + 1)
    const dayZero = dates[0]
    const oneLapLater = dates[calendarLength]
    if (!dayZero || !oneLapLater) throw new Error('expected two dates from consecutiveDates')

    expect(getDailyNumber(oneLapLater) - 1).toBe(calendarLength)
    expect(getDailyCalendarIndex(oneLapLater, calendarLength)).toBe(
      getDailyCalendarIndex(dayZero, calendarLength),
    )
  })

  it('appending entries never changes the index for a day that was already within the old calendar length', () => {
    const oldLength = 20
    const newLength = 35 // simulates appending 15 new entries to the end
    const dates = consecutiveDates('2026-01-01', 60)

    for (const date of dates) {
      const dayIndex = getDailyNumber(date) - 1
      if (dayIndex >= 0 && dayIndex < oldLength) {
        expect(getDailyCalendarIndex(date, newLength)).toBe(getDailyCalendarIndex(date, oldLength))
      }
    }
  })

  it('same date + same calendar resolves to the same puzzle id', () => {
    const calendar = ['a', 'b', 'c', 'd', 'e']
    const date = '2026-03-10'

    const idA = calendar[getDailyCalendarIndex(date, calendar.length)]
    const idB = calendar[getDailyCalendarIndex(date, calendar.length)]

    expect(idA).toBe(idB)
    expect(idA).toBeDefined()
  })
})

describe('getDailyNumber', () => {
  it('returns 1 on the epoch date itself', () => {
    expect(getDailyNumber(DAILY_EPOCH)).toBe(1)
  })

  it('increases by exactly 1 per elapsed calendar day', () => {
    const n1 = getDailyNumber(DAILY_EPOCH)
    const dayAfter = new Date(`${DAILY_EPOCH}T00:00:00Z`)
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)
    const n2 = getDailyNumber(dayAfter.toISOString().slice(0, 10))
    expect(n2).toBe(n1 + 1)
  })

  it('is deterministic for the same date string', () => {
    expect(getDailyNumber('2026-07-19')).toBe(getDailyNumber('2026-07-19'))
  })
})
