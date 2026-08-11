import { describe, expect, it } from 'vitest'
import type { Migration } from './migrations'
import { MIGRATIONS, runMigrations } from './migrations'

describe('runMigrations', () => {
  it('applies a single migration and stamps the new version + field', () => {
    const testMigrations: Record<number, Migration> = {
      1: (raw) => ({ ...raw, schema_version: 2, newField: 'default-value' }),
    }
    const v1Fixture = { schema_version: 1, rating: 1200 }
    const migrated = runMigrations(v1Fixture, 1, testMigrations)
    expect(migrated).toEqual({ ...v1Fixture, schema_version: 2, newField: 'default-value' })
  })

  it('passes through unchanged when no migration exists for the version', () => {
    const testMigrations: Record<number, Migration> = {
      1: (raw) => ({ ...raw, schema_version: 2 }),
    }
    const v5 = { schema_version: 5, rating: 1300 }
    expect(runMigrations(v5, 5, testMigrations)).toEqual(v5)
  })

  it('passes through unchanged with an empty migration map', () => {
    const v1 = { schema_version: 1, rating: 1200 }
    expect(runMigrations(v1, 1, {})).toBe(v1)
  })

  it('chains a multi-step migration (1 -> 2 -> 3) in order', () => {
    const testMigrations: Record<number, Migration> = {
      1: (raw) => ({ ...raw, schema_version: 2, addedAtV2: true }),
      2: (raw) => ({ ...raw, schema_version: 3, addedAtV3: 'x' }),
    }
    const migrated = runMigrations({ schema_version: 1, rating: 1200 }, 1, testMigrations)
    expect(migrated).toEqual({
      schema_version: 3,
      rating: 1200,
      addedAtV2: true,
      addedAtV3: 'x',
    })
  })

  it('stops without looping forever if a key is explicitly set to undefined', () => {
    // Object.prototype.hasOwnProperty is true here even though the value is
    // undefined (as opposed to the key being absent) — the runner's guard
    // against that must be exercised directly, since normal migration maps
    // never construct entries this way.
    const testMigrations: Record<number, Migration> = { 1: undefined as unknown as Migration }
    const v1 = { schema_version: 1, rating: 1200 }
    expect(runMigrations(v1, 1, testMigrations)).toBe(v1)
  })

  it('runs migrations strictly in ascending version order', () => {
    const order: number[] = []
    const testMigrations: Record<number, Migration> = {
      1: (raw) => {
        order.push(1)
        return { ...raw, schema_version: 2 }
      },
      2: (raw) => {
        order.push(2)
        return { ...raw, schema_version: 3 }
      },
    }
    runMigrations({ schema_version: 1 }, 1, testMigrations)
    expect(order).toEqual([1, 2])
  })
})

describe('MIGRATIONS: full chain from v1 to the current version', () => {
  it('v1 -> v7, stamping schema_version 7, adding null dailyCompletion + rushStats + bestRunStreak 0 + bossStats + a generated anonId, and preserving every existing field untouched', () => {
    const v1Profile = {
      schema_version: 1,
      rating: 1342.75,
      ratedAttemptCount: 7,
      streak: { currentStreak: 3, longestStreak: 9, lastActiveDate: '2026-07-14' },
      requeueState: [{ puzzleId: 'p9', stage: 2, served: 12 }],
      storagePersisted: true,
    }

    const migrated = runMigrations(v1Profile, 1, MIGRATIONS)
    const { anonId, ...rest } = migrated

    expect(typeof anonId).toBe('string')
    expect((anonId as string).length).toBeGreaterThan(0)
    expect(rest).toEqual({
      ...v1Profile,
      schema_version: 7,
      dailyCompletion: null,
      rushStats: null,
      bestRunStreak: 0,
      bossStats: null,
    })
  })
})

describe('MIGRATIONS[3]: v3 -> v4 (profile shape unchanged — the v4 bump is driven by AttemptSchema, not UserProfile)', () => {
  it('stamps schema_version 4 and preserves every existing field untouched, adding nothing', () => {
    const v3Profile = {
      schema_version: 3,
      rating: 1420.5,
      ratedAttemptCount: 22,
      streak: { currentStreak: 4, longestStreak: 15, lastActiveDate: '2026-07-25' },
      requeueState: [{ puzzleId: 'p7', stage: 0, served: 2 }],
      storagePersisted: true,
      dailyCompletion: { date: '2026-07-25', attemptId: 'a9', correct: false },
      rushStats: { bestScore: 12, bestStreak: 8, runs: 3, lastRunAt: '2026-07-24T10:00:00.000Z' },
    }

    // Calls MIGRATIONS[3] directly rather than through runMigrations, which
    // would keep chaining into MIGRATIONS[4] now that it's registered too —
    // this test's whole point is to isolate v3->v4's own behavior.
    const v3Migration = MIGRATIONS[3]
    if (!v3Migration) throw new Error('MIGRATIONS[3] is not registered')
    const migrated = v3Migration(v3Profile)

    expect(migrated).toEqual({ ...v3Profile, schema_version: 4 })
  })
})

describe('MIGRATIONS[4]: v4 -> v5 (Phase 5b: resets rushStats, adds bestRunStreak)', () => {
  it('stamps schema_version 5, resets a non-null rushStats to null, adds bestRunStreak 0, and preserves every other field untouched', () => {
    const v4Profile = {
      schema_version: 4,
      rating: 1512.25,
      ratedAttemptCount: 30,
      streak: { currentStreak: 2, longestStreak: 20, lastActiveDate: '2026-08-01' },
      requeueState: [{ puzzleId: 'p2', stage: 1, served: 5 }],
      storagePersisted: true,
      dailyCompletion: { date: '2026-08-01', attemptId: 'a5', correct: true },
      rushStats: { bestScore: 40, bestStreak: 25, runs: 9, lastRunAt: '2026-07-30T09:00:00.000Z' },
    }

    const v4Migration = MIGRATIONS[4]
    if (!v4Migration) throw new Error('MIGRATIONS[4] is not registered')
    const migrated = v4Migration(v4Profile)

    expect(migrated).toEqual({
      ...v4Profile,
      schema_version: 5,
      rushStats: null,
      bestRunStreak: 0,
    })
  })
})

describe('MIGRATIONS[5]: v5 -> v6 (Phase 7 Item 6: adds anonId)', () => {
  it('stamps schema_version 6, adds a non-empty generated anonId, and preserves every other field untouched', () => {
    const v5Profile = {
      schema_version: 5,
      rating: 1580.5,
      ratedAttemptCount: 44,
      streak: { currentStreak: 1, longestStreak: 22, lastActiveDate: '2026-08-05' },
      requeueState: [{ puzzleId: 'p4', stage: 0, served: 3 }],
      storagePersisted: true,
      dailyCompletion: { date: '2026-08-05', attemptId: 'a11', correct: true },
      rushStats: null,
      bestRunStreak: 6,
    }

    const v5Migration = MIGRATIONS[5]
    if (!v5Migration) throw new Error('MIGRATIONS[5] is not registered')
    const migrated = v5Migration(v5Profile)
    const { anonId, ...rest } = migrated

    expect(typeof anonId).toBe('string')
    expect((anonId as string).length).toBeGreaterThan(0)
    expect(rest).toEqual({ ...v5Profile, schema_version: 6 })
  })

  it('generates a different anonId on each call (never a fixed/shared value)', () => {
    const v5Migration = MIGRATIONS[5]
    if (!v5Migration) throw new Error('MIGRATIONS[5] is not registered')
    const a = v5Migration({ schema_version: 5 }) as { anonId: string }
    const b = v5Migration({ schema_version: 5 }) as { anonId: string }
    expect(a.anonId).not.toBe(b.anonId)
  })
})

describe('MIGRATIONS[1]: v1 -> v2 (adds dailyCompletion)', () => {
  it('stamps schema_version 2, adds a null dailyCompletion, and preserves every existing field untouched', () => {
    const v1Profile = {
      schema_version: 1,
      rating: 1256.5,
      ratedAttemptCount: 3,
      streak: { currentStreak: 1, longestStreak: 4, lastActiveDate: '2026-07-10' },
      requeueState: [{ puzzleId: 'p1', stage: 0, served: 1 }],
      storagePersisted: true,
    }

    // Calls MIGRATIONS[1] directly rather than through runMigrations, which
    // would keep chaining into MIGRATIONS[2] now that it's registered too —
    // this test's whole point is to isolate v1->v2's own behavior, the same
    // way every other MIGRATIONS[N] describe block below isolates its own
    // step. The only prior coverage of this step was indirect, through the
    // full v1->v6 chain test above.
    const v1Migration = MIGRATIONS[1]
    if (!v1Migration) throw new Error('MIGRATIONS[1] is not registered')
    const migrated = v1Migration(v1Profile)

    expect(migrated).toEqual({
      ...v1Profile,
      schema_version: 2,
      dailyCompletion: null,
    })
  })
})

describe('MIGRATIONS[2]: v2 -> v3 (adds rushStats)', () => {
  it('stamps schema_version 3, adds a null rushStats, and preserves every existing field untouched, including a non-null dailyCompletion', () => {
    const v2Profile = {
      schema_version: 2,
      rating: 1389.25,
      ratedAttemptCount: 14,
      streak: { currentStreak: 6, longestStreak: 11, lastActiveDate: '2026-07-18' },
      requeueState: [{ puzzleId: 'p3', stage: 0, served: 1 }],
      storagePersisted: true,
      dailyCompletion: { date: '2026-07-20', attemptId: 'a1', correct: true },
    }

    // Calls MIGRATIONS[2] directly rather than through runMigrations, which
    // would keep chaining into MIGRATIONS[3] now that it's registered too —
    // this test's whole point is to isolate v2->v3's own behavior.
    const v2Migration = MIGRATIONS[2]
    if (!v2Migration) throw new Error('MIGRATIONS[2] is not registered')
    const migrated = v2Migration(v2Profile)

    expect(migrated).toEqual({
      ...v2Profile,
      schema_version: 3,
      rushStats: null,
    })
  })
})

describe('MIGRATIONS[6]: v6 -> v7 (v3 Phase 1: adds bossStats)', () => {
  it('stamps schema_version 7, adds bossStats: null, and preserves every other field untouched', () => {
    const v6Profile = {
      schema_version: 6,
      rating: 1450.75,
      ratedAttemptCount: 18,
      streak: { currentStreak: 5, longestStreak: 12, lastActiveDate: '2026-08-05' },
      requeueState: [{ puzzleId: 'p4', stage: 2, served: 1 }],
      storagePersisted: true,
      dailyCompletion: { date: '2026-08-05', attemptId: 'a11', correct: true },
      rushStats: { bestScore: 15, bestStreak: 9, runs: 4, lastRunAt: '2026-08-04T12:00:00.000Z' },
      bestRunStreak: 22,
      anonId: 'anon-abc-123',
    }

    const v6Migration = MIGRATIONS[6]
    if (!v6Migration) throw new Error('MIGRATIONS[6] is not registered')
    const migrated = v6Migration(v6Profile)

    expect(migrated).toEqual({
      ...v6Profile,
      schema_version: 7,
      bossStats: null,
    })
  })
})
