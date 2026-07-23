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
  it('v1 -> v3, stamping schema_version 3, adding null dailyCompletion + rushStats, and preserving every existing field untouched', () => {
    const v1Profile = {
      schema_version: 1,
      rating: 1342.75,
      ratedAttemptCount: 7,
      streak: { currentStreak: 3, longestStreak: 9, lastActiveDate: '2026-07-14' },
      requeueState: [{ puzzleId: 'p9', stage: 2, served: 12 }],
      storagePersisted: true,
    }

    const migrated = runMigrations(v1Profile, 1, MIGRATIONS)

    expect(migrated).toEqual({
      ...v1Profile,
      schema_version: 3,
      dailyCompletion: null,
      rushStats: null,
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

    const migrated = runMigrations(v2Profile, 2, MIGRATIONS)

    expect(migrated).toEqual({
      ...v2Profile,
      schema_version: 3,
      rushStats: null,
    })
  })
})
