import { describe, expect, it } from 'vitest'
import { daysBetween, recordActivity } from './streak'
import type { StreakState } from './streak'

const empty: StreakState = { currentStreak: 0, longestStreak: 0, lastActiveDate: null }

describe('daysBetween', () => {
  it('is 1 for consecutive calendar days', () => {
    expect(daysBetween('2026-07-14', '2026-07-15')).toBe(1)
  })

  it('is 0 for the same date', () => {
    expect(daysBetween('2026-07-15', '2026-07-15')).toBe(0)
  })

  it('is negative when dateB is before dateA', () => {
    expect(daysBetween('2026-07-15', '2026-07-14')).toBe(-1)
  })

  it('crosses a month-end boundary correctly', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1)
  })

  it('crosses a year-end boundary correctly', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })

  it('handles Feb 29 in a leap year', () => {
    expect(daysBetween('2028-02-28', '2028-02-29')).toBe(1)
    expect(daysBetween('2028-02-29', '2028-03-01')).toBe(1)
  })

  it('treats 2026 as non-leap (no Feb 29)', () => {
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })
})

describe('recordActivity', () => {
  it('sets currentStreak to 1 on first-ever activity (null lastActiveDate)', () => {
    const next = recordActivity(empty, '2026-07-15')
    expect(next).toEqual({ currentStreak: 1, longestStreak: 1, lastActiveDate: '2026-07-15' })
  })

  it('increments currentStreak and longestStreak across consecutive days', () => {
    let state = recordActivity(empty, '2026-07-13')
    state = recordActivity(state, '2026-07-14')
    state = recordActivity(state, '2026-07-15')

    expect(state).toEqual({ currentStreak: 3, longestStreak: 3, lastActiveDate: '2026-07-15' })
  })

  it('is idempotent when called twice with the same date', () => {
    const first = recordActivity(empty, '2026-07-15')
    const second = recordActivity(first, '2026-07-15')

    expect(second).toEqual(first)
  })

  it('resets currentStreak to 1 on a 2-day gap', () => {
    let state = recordActivity(empty, '2026-07-13')
    state = recordActivity(state, '2026-07-14')
    state = recordActivity(state, '2026-07-16') // gap: 07-15 missed

    expect(state.currentStreak).toBe(1)
    expect(state.lastActiveDate).toBe('2026-07-16')
  })

  it('resets currentStreak to 1 on a large (30-day) gap', () => {
    let state = recordActivity(empty, '2026-06-01')
    state = recordActivity(state, '2026-07-01')

    expect(state.currentStreak).toBe(1)
    expect(state.lastActiveDate).toBe('2026-07-01')
  })

  it('preserves longestStreak after a reset drops currentStreak below the past peak', () => {
    let state = empty
    const consecutiveDates = [
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
      '2026-01-10',
    ]
    for (const date of consecutiveDates) {
      state = recordActivity(state, date)
    }
    expect(state.currentStreak).toBe(10)
    expect(state.longestStreak).toBe(10)

    // Big gap forces a reset.
    state = recordActivity(state, '2026-03-01')

    expect(state.currentStreak).toBe(1)
    expect(state.longestStreak).toBe(10)
  })

  it('increments correctly across a month-end rollover', () => {
    let state = recordActivity(empty, '2026-01-31')
    state = recordActivity(state, '2026-02-01')

    expect(state).toEqual({ currentStreak: 2, longestStreak: 2, lastActiveDate: '2026-02-01' })
  })

  it('increments correctly across a year-end rollover', () => {
    let state = recordActivity(empty, '2026-12-31')
    state = recordActivity(state, '2027-01-01')

    expect(state).toEqual({ currentStreak: 2, longestStreak: 2, lastActiveDate: '2027-01-01' })
  })

  it('increments correctly across Feb 29 in a leap year', () => {
    let state = recordActivity(empty, '2028-02-28')
    state = recordActivity(state, '2028-02-29')
    state = recordActivity(state, '2028-03-01')

    expect(state).toEqual({ currentStreak: 3, longestStreak: 3, lastActiveDate: '2028-03-01' })
  })

  it('resets to 1 (does not increment) when todayDateString is before lastActiveDate', () => {
    // Defensive case: shouldn't happen in practice (caller should always
    // pass a non-decreasing date), but an out-of-order call can't represent
    // a real streak, so resetting to 1 is the safe behavior rather than
    // silently incrementing or decrementing.
    let state = recordActivity(empty, '2026-07-10')
    state = recordActivity(state, '2026-07-11')
    expect(state.currentStreak).toBe(2)

    state = recordActivity(state, '2026-07-05')

    expect(state.currentStreak).toBe(1)
    expect(state.longestStreak).toBe(2)
    expect(state.lastActiveDate).toBe('2026-07-05')
  })
})
