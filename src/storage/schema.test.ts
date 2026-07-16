import { describe, expect, it } from 'vitest'
import {
  AttemptSchema,
  CURRENT_SCHEMA_VERSION,
  UserProfileSchema,
  createDefaultProfile,
} from './schema'

const validProfile = {
  schema_version: CURRENT_SCHEMA_VERSION,
  rating: 1247.5,
  ratedAttemptCount: 3,
  streak: { currentStreak: 2, longestStreak: 5, lastActiveDate: '2026-07-15' },
  requeueState: [{ puzzleId: 'p1', stage: 1, served: 4 }],
  storagePersisted: true,
}

const validAttempt = {
  id: 'a1',
  puzzleId: 'p1',
  puzzleRating: 1300,
  mode: 'practice',
  correct: true,
  time_ms: 4200,
  choice_index: 2,
  userRatingBefore: 1200,
  userRatingAfter: 1215,
  localDateString: '2026-07-15',
  createdAt: '2026-07-15T12:00:00.000Z',
}

describe('UserProfileSchema', () => {
  it('parses a valid profile', () => {
    expect(UserProfileSchema.parse(validProfile)).toEqual(validProfile)
  })

  it('accepts a null lastActiveDate and null storagePersisted', () => {
    const parsed = UserProfileSchema.parse({
      ...validProfile,
      streak: { currentStreak: 0, longestStreak: 0, lastActiveDate: null },
      storagePersisted: null,
    })
    expect(parsed.streak.lastActiveDate).toBeNull()
    expect(parsed.storagePersisted).toBeNull()
  })

  it('rejects a wrong schema_version', () => {
    expect(() => UserProfileSchema.parse({ ...validProfile, schema_version: 2 })).toThrow()
  })

  it('rejects a missing required field', () => {
    const withoutRating: Record<string, unknown> = { ...validProfile }
    delete withoutRating.rating
    expect(() => UserProfileSchema.parse(withoutRating)).toThrow()
  })

  it('rejects a rating of the wrong type', () => {
    expect(() => UserProfileSchema.parse({ ...validProfile, rating: 'high' })).toThrow()
  })

  it('rejects a negative ratedAttemptCount', () => {
    expect(() => UserProfileSchema.parse({ ...validProfile, ratedAttemptCount: -1 })).toThrow()
  })

  it('rejects an out-of-range requeue stage', () => {
    expect(() =>
      UserProfileSchema.parse({
        ...validProfile,
        requeueState: [{ puzzleId: 'p1', stage: 3, served: 0 }],
      }),
    ).toThrow()
  })
})

describe('AttemptSchema', () => {
  it('parses a valid attempt', () => {
    expect(AttemptSchema.parse(validAttempt)).toEqual(validAttempt)
  })

  it('accepts a null choice_index (not forced non-null)', () => {
    const parsed = AttemptSchema.parse({ ...validAttempt, choice_index: null })
    expect(parsed.choice_index).toBeNull()
  })

  it('rejects an empty id', () => {
    expect(() => AttemptSchema.parse({ ...validAttempt, id: '' })).toThrow()
  })

  it('rejects an unknown mode', () => {
    expect(() => AttemptSchema.parse({ ...validAttempt, mode: 'blitz' })).toThrow()
  })

  it('rejects a negative time_ms', () => {
    expect(() => AttemptSchema.parse({ ...validAttempt, time_ms: -1 })).toThrow()
  })

  it('rejects a missing correct field', () => {
    const withoutCorrect: Record<string, unknown> = { ...validAttempt }
    delete withoutCorrect.correct
    expect(() => AttemptSchema.parse(withoutCorrect)).toThrow()
  })
})

describe('createDefaultProfile', () => {
  it('produces a profile that passes UserProfileSchema', () => {
    expect(() => UserProfileSchema.parse(createDefaultProfile())).not.toThrow()
  })

  it('starts a brand-new user at the initial rating with empty state', () => {
    const profile = createDefaultProfile()
    expect(profile.schema_version).toBe(CURRENT_SCHEMA_VERSION)
    expect(profile.ratedAttemptCount).toBe(0)
    expect(profile.requeueState).toEqual([])
    expect(profile.streak).toEqual({ currentStreak: 0, longestStreak: 0, lastActiveDate: null })
    expect(profile.storagePersisted).toBeNull()
  })
})
