import { describe, expect, it } from 'vitest'
import {
  getRatingHistory,
  getActivityCalendar,
  getLifetimeTotals,
  ACTIVITY_CALENDAR_WEEKS,
} from './statsData'
import { DEFAULT_PREFERENCES } from '../../storage'
import type { Attempt, UserProfile } from '../../storage'

const NOW_ISO = '2026-08-14T12:00:00.000Z'

function attempt(overrides: Partial<Attempt> & Pick<Attempt, 'id' | 'localDateString'>): Attempt {
  return {
    puzzleId: `puzzle-${overrides.id}`,
    puzzleRating: 1200,
    mode: 'practice',
    correct: true,
    time_ms: 4000,
    choice_index: null,
    checkpoint_results: null,
    userRatingBefore: 1200,
    userRatingAfter: 1210,
    createdAt: `${overrides.localDateString}T10:00:00.000Z`,
    ...overrides,
  }
}

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    schema_version: 9,
    rating: 1250,
    ratedAttemptCount: 40,
    streak: { currentStreak: 3, longestStreak: 12, lastActiveDate: '2026-08-14' },
    requeueState: [],
    storagePersisted: null,
    dailyCompletion: null,
    rushStats: null,
    bestRunStreak: 0,
    bossStats: null,
    missionProgress: null,
    missionStats: null,
    preferences: DEFAULT_PREFERENCES,
    anonId: 'test-anon-id',
    ...overrides,
  }
}

describe('getRatingHistory', () => {
  it('returns no points when there are no attempts', () => {
    expect(getRatingHistory([], null, NOW_ISO)).toEqual([])
  })

  it("collapses same-day attempts to that day's last userRatingAfter", () => {
    const attempts = [
      attempt({ id: '1', localDateString: '2026-08-10', userRatingAfter: 1205 }),
      attempt({ id: '2', localDateString: '2026-08-10', userRatingAfter: 1198 }),
      attempt({ id: '3', localDateString: '2026-08-10', userRatingAfter: 1212 }),
    ]
    expect(getRatingHistory(attempts, null, NOW_ISO)).toEqual([
      { date: '2026-08-10', rating: 1212 },
    ])
  })

  it('returns one point per day, sorted ascending by date', () => {
    const attempts = [
      attempt({ id: '1', localDateString: '2026-08-12', userRatingAfter: 1220 }),
      attempt({ id: '2', localDateString: '2026-08-10', userRatingAfter: 1205 }),
      attempt({ id: '3', localDateString: '2026-08-11', userRatingAfter: 1215 }),
    ]
    expect(getRatingHistory(attempts, null, NOW_ISO)).toEqual([
      { date: '2026-08-10', rating: 1205 },
      { date: '2026-08-11', rating: 1215 },
      { date: '2026-08-12', rating: 1220 },
    ])
  })

  it('a 7-day window excludes points older than 7 days before nowIso', () => {
    const attempts = [
      attempt({ id: '1', localDateString: '2026-08-06', userRatingAfter: 1190 }),
      attempt({ id: '2', localDateString: '2026-08-08', userRatingAfter: 1200 }),
    ]
    expect(getRatingHistory(attempts, 7, NOW_ISO)).toEqual([{ date: '2026-08-08', rating: 1200 }])
  })

  it('a null window returns all-time history, unfiltered', () => {
    const attempts = [attempt({ id: '1', localDateString: '2025-01-01', userRatingAfter: 1000 })]
    expect(getRatingHistory(attempts, null, NOW_ISO)).toEqual([
      { date: '2025-01-01', rating: 1000 },
    ])
  })

  it('7-day window correctly uses calendar dates for cutoff, not timestamps', () => {
    // Validates that cutoff is calculated as a calendar date string and compared
    // lexicographically, not parsed as a UTC timestamp. This prevents timezone-
    // dependent boundary errors where new Date('YYYY-MM-DD') reinterprets the
    // date-only string as UTC midnight rather than local midnight.
    // NOW_ISO is 2026-08-14T12:00:00.000Z, so 7 days back is 2026-08-07.
    const attempts = [
      attempt({ id: '1', localDateString: '2026-08-07', userRatingAfter: 1200 }), // exactly 7 days back, included
      attempt({ id: '2', localDateString: '2026-08-06', userRatingAfter: 1190 }), // 8 days back, excluded
    ]
    const result = getRatingHistory(attempts, 7, NOW_ISO)
    expect(result).toEqual([{ date: '2026-08-07', rating: 1200 }])
    expect(result).toHaveLength(1)
  })

  it('a 30-day window filters correctly', () => {
    const attempts = [
      attempt({ id: '1', localDateString: '2026-07-14', userRatingAfter: 1180 }), // 31 days back, excluded
      attempt({ id: '2', localDateString: '2026-07-15', userRatingAfter: 1185 }), // 30 days back, included
      attempt({ id: '3', localDateString: '2026-08-10', userRatingAfter: 1210 }), // 4 days back, included
    ]
    expect(getRatingHistory(attempts, 30, NOW_ISO)).toEqual([
      { date: '2026-07-15', rating: 1185 },
      { date: '2026-08-10', rating: 1210 },
    ])
  })
})

describe('getActivityCalendar', () => {
  it(`returns exactly ${String(ACTIVITY_CALENDAR_WEEKS * 7)} days ending on nowIso's local date`, () => {
    const days = getActivityCalendar([], NOW_ISO)
    expect(days).toHaveLength(ACTIVITY_CALENDAR_WEEKS * 7)
    expect(days[days.length - 1]).toEqual({ date: '2026-08-14', active: false })
  })

  it('marks a day active when an attempt shares its localDateString, others stay inactive', () => {
    const days = getActivityCalendar([attempt({ id: '1', localDateString: '2026-08-12' })], NOW_ISO)
    expect(days.find((d) => d.date === '2026-08-12')?.active).toBe(true)
    expect(days.find((d) => d.date === '2026-08-11')?.active).toBe(false)
  })
})

describe('getLifetimeTotals', () => {
  it('returns all zeros for a fresh profile with no attempts', () => {
    const fresh = profile({ streak: { currentStreak: 0, longestStreak: 0, lastActiveDate: null } })
    expect(getLifetimeTotals([], fresh)).toEqual({
      solved: 0,
      bestStreak: 0,
      totalTimeMs: 0,
      modesPlayed: 0,
    })
  })

  it('sums solved count and total time, counts distinct modes, reads bestStreak from the profile', () => {
    const attempts = [
      attempt({ id: '1', localDateString: '2026-08-10', mode: 'practice', time_ms: 3000 }),
      attempt({ id: '2', localDateString: '2026-08-11', mode: 'daily', time_ms: 5000 }),
      attempt({ id: '3', localDateString: '2026-08-12', mode: 'practice', time_ms: 4000 }),
    ]
    expect(getLifetimeTotals(attempts, profile())).toEqual({
      solved: 3,
      bestStreak: 12,
      totalTimeMs: 12000,
      modesPlayed: 2,
    })
  })
})
