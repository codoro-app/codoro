import { describe, expect, it } from 'vitest'
import {
  AttemptSchema,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_PREFERENCES,
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
  dailyCompletion: { date: '2026-07-19', attemptId: 'a1', correct: true },
  rushStats: null,
  bestRunStreak: 0,
  bossStats: null,
  missionProgress: null,
  missionStats: null,
  preferences: DEFAULT_PREFERENCES,
  anonId: 'test-anon-id-1',
  challengerName: null,
  firstRunCompleted: true,
}

const validAttempt = {
  id: 'a1',
  puzzleId: 'p1',
  puzzleRating: 1300,
  mode: 'practice',
  correct: true,
  time_ms: 4200,
  choice_index: 2,
  checkpoint_results: null,
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
    expect(() => UserProfileSchema.parse({ ...validProfile, schema_version: 4 })).toThrow()
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

  it('accepts a null dailyCompletion (no attempt today yet)', () => {
    const parsed = UserProfileSchema.parse({ ...validProfile, dailyCompletion: null })
    expect(parsed.dailyCompletion).toBeNull()
  })

  it('rejects a dailyCompletion missing required fields', () => {
    expect(() =>
      UserProfileSchema.parse({ ...validProfile, dailyCompletion: { date: '2026-07-19' } }),
    ).toThrow()
  })

  it('accepts a non-null rushStats', () => {
    const parsed = UserProfileSchema.parse({
      ...validProfile,
      rushStats: { bestScore: 23, bestStreak: 31, runs: 4, lastRunAt: '2026-07-22T10:00:00.000Z' },
    })
    expect(parsed.rushStats).toEqual({
      bestScore: 23,
      bestStreak: 31,
      runs: 4,
      lastRunAt: '2026-07-22T10:00:00.000Z',
    })
  })

  it('rejects a rushStats with a negative bestScore', () => {
    expect(() =>
      UserProfileSchema.parse({
        ...validProfile,
        rushStats: { bestScore: -1, bestStreak: 0, runs: 1, lastRunAt: null },
      }),
    ).toThrow()
  })

  it('accepts a non-null missionProgress with a mix of stage-shaped completedStages', () => {
    const parsed = UserProfileSchema.parse({
      ...validProfile,
      missionProgress: {
        runId: 'mission-run-1',
        currentStage: 'boss',
        completedStages: [
          {
            stats: { stageId: 'trace', puzzlesCompleted: 3, solvedCount: 2 },
            endedReason: 'timer',
            completedAt: '2026-08-11T18:00:00.000Z',
          },
          {
            stats: { stageId: 'speed', solvedCount: 4, bestStreakThisRun: 3 },
            endedReason: 'native',
            completedAt: '2026-08-11T18:01:00.000Z',
          },
        ],
        startedAt: '2026-08-11T17:58:00.000Z',
      },
    })
    expect(parsed.missionProgress?.currentStage).toBe('boss')
    expect(parsed.missionProgress?.completedStages).toHaveLength(2)
  })

  it('rejects a missionProgress with an unknown currentStage', () => {
    expect(() =>
      UserProfileSchema.parse({
        ...validProfile,
        missionProgress: {
          runId: 'mission-run-1',
          currentStage: 'bonus',
          completedStages: [],
          startedAt: '2026-08-11T17:58:00.000Z',
        },
      }),
    ).toThrow()
  })

  it('rejects a mission stage stats object mixing fields from two different stages', () => {
    expect(() =>
      UserProfileSchema.parse({
        ...validProfile,
        missionProgress: {
          runId: 'mission-run-1',
          currentStage: 'trace',
          completedStages: [
            {
              // 'boss' stageId but Trace's fields — the discriminated union
              // must reject this, not silently accept the wrong shape.
              stats: { stageId: 'boss', puzzlesCompleted: 3, solvedCount: 2 },
              endedReason: 'timer',
              completedAt: '2026-08-11T18:00:00.000Z',
            },
          ],
          startedAt: '2026-08-11T17:58:00.000Z',
        },
      }),
    ).toThrow()
  })

  it('accepts a non-null missionStats', () => {
    const parsed = UserProfileSchema.parse({
      ...validProfile,
      missionStats: {
        completions: 3,
        lastRunAt: '2026-08-11T18:01:00.000Z',
        lastCompletedAt: '2026-08-10T12:00:00.000Z',
      },
    })
    expect(parsed.missionStats).toEqual({
      completions: 3,
      lastRunAt: '2026-08-11T18:01:00.000Z',
      lastCompletedAt: '2026-08-10T12:00:00.000Z',
    })
  })

  it('rejects a missionStats with a negative completions', () => {
    expect(() =>
      UserProfileSchema.parse({
        ...validProfile,
        missionStats: { completions: -1, lastRunAt: null, lastCompletedAt: null },
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

  it('accepts a non-null checkpoint_results array', () => {
    const parsed = AttemptSchema.parse({
      ...validAttempt,
      checkpoint_results: [
        { correct: true, choiceIndex: 0 },
        { correct: false, choiceIndex: 2 },
      ],
    })
    expect(parsed.checkpoint_results).toEqual([
      { correct: true, choiceIndex: 0 },
      { correct: false, choiceIndex: 2 },
    ])
  })

  it('rejects a checkpoint_results entry with a negative choiceIndex', () => {
    expect(() =>
      AttemptSchema.parse({
        ...validAttempt,
        checkpoint_results: [{ correct: true, choiceIndex: -1 }],
      }),
    ).toThrow()
  })

  it('rejects a checkpoint_results entry missing correct', () => {
    expect(() =>
      AttemptSchema.parse({
        ...validAttempt,
        checkpoint_results: [{ choiceIndex: 0 }],
      }),
    ).toThrow()
  })

  it('defaults checkpoint_results to null for a pre-v4 stored record missing the key entirely', () => {
    const preV4Record: Record<string, unknown> = { ...validAttempt }
    delete preV4Record.checkpoint_results
    const parsed = AttemptSchema.parse(preV4Record)
    expect(parsed.checkpoint_results).toBeNull()
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
