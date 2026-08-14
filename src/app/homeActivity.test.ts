import { describe, expect, it } from 'vitest'
import { getRecentActivity, getRatingTrend } from './homeActivity'
import type { Attempt } from '../storage'

function attempt(overrides: Partial<Attempt> & Pick<Attempt, 'id'>): Attempt {
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
    localDateString: '2026-08-13',
    createdAt: '2026-08-13T10:00:00.000Z',
    ...overrides,
  }
}

describe('getRecentActivity', () => {
  it('returns null when there are no attempts yet', () => {
    expect(getRecentActivity([])).toBeNull()
  })

  it('summarizes a single-mode run: correct count, total, and net rating delta', () => {
    const attempts = [
      attempt({
        id: '1',
        mode: 'practice',
        correct: true,
        userRatingBefore: 1200,
        userRatingAfter: 1210,
      }),
      attempt({
        id: '2',
        mode: 'practice',
        correct: false,
        userRatingBefore: 1210,
        userRatingAfter: 1205,
      }),
      attempt({
        id: '3',
        mode: 'practice',
        correct: true,
        userRatingBefore: 1205,
        userRatingAfter: 1219,
      }),
    ]

    expect(getRecentActivity(attempts)).toEqual({
      mode: 'practice',
      correct: 2,
      total: 3,
      ratingDelta: 19, // 1219 (last after) - 1200 (first before)
    })
  })

  it('only counts the trailing run of attempts sharing the most recent mode', () => {
    const attempts = [
      attempt({
        id: '1',
        mode: 'daily',
        correct: true,
        userRatingBefore: 1200,
        userRatingAfter: 1208,
      }),
      attempt({
        id: '2',
        mode: 'rush',
        correct: true,
        userRatingBefore: 1208,
        userRatingAfter: 1214,
      }),
      attempt({
        id: '3',
        mode: 'rush',
        correct: false,
        userRatingBefore: 1214,
        userRatingAfter: 1211,
      }),
    ]

    expect(getRecentActivity(attempts)).toEqual({
      mode: 'rush',
      correct: 1,
      total: 2,
      ratingDelta: 3, // 1211 - 1208, daily attempt excluded
    })
  })
})

describe('getRatingTrend', () => {
  const now = '2026-08-13T12:00:00.000Z'

  it('returns null when there are no attempts within the last 7 days', () => {
    const attempts = [
      attempt({
        id: '1',
        createdAt: '2026-08-01T10:00:00.000Z',
        userRatingBefore: 1100,
        userRatingAfter: 1120,
      }),
    ]

    expect(getRatingTrend(attempts, now)).toBeNull()
  })

  it('sums the net rating change across attempts within the last 7 days', () => {
    const attempts = [
      // Outside the 7-day window (2026-08-06T12:00:00.000Z is the cutoff) — excluded.
      attempt({
        id: '1',
        createdAt: '2026-08-05T10:00:00.000Z',
        userRatingBefore: 1100,
        userRatingAfter: 1150,
      }),
      attempt({
        id: '2',
        createdAt: '2026-08-07T09:00:00.000Z',
        userRatingBefore: 1150,
        userRatingAfter: 1160,
      }),
      attempt({
        id: '3',
        createdAt: '2026-08-12T18:00:00.000Z',
        userRatingBefore: 1160,
        userRatingAfter: 1182,
      }),
    ]

    expect(getRatingTrend(attempts, now)).toBe(32) // 1182 - 1150
  })
})
