import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RATING_FLOOR } from '../engine'
import { DB_NAME } from './db'
import type { Attempt, UserProfile } from './schema'
import { appendAttempt, listAttempts } from './attempts'
import { loadProfile, saveProfile } from './profile'
import { exportData, importData } from './exportImport'

afterEach(async () => {
  await deleteDB(DB_NAME)
})

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    schema_version: 4,
    rating: RATING_FLOOR,
    ratedAttemptCount: 3,
    streak: { currentStreak: 2, longestStreak: 5, lastActiveDate: '2026-07-14' },
    requeueState: [{ puzzleId: 'p9', stage: 1, served: 4 }],
    storagePersisted: true,
    dailyCompletion: null,
    rushStats: null,
    ...overrides,
  }
}

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    puzzleId: 'p1',
    puzzleRating: 1200,
    mode: 'practice',
    correct: true,
    time_ms: 4200,
    choice_index: 2,
    checkpoint_results: null,
    userRatingBefore: 1180,
    userRatingAfter: 1195,
    localDateString: '2026-07-15',
    createdAt: '2026-07-15T12:00:00.000Z',
    ...overrides,
  }
}

describe('exportData / importData round-trip', () => {
  it('round-trips a profile with an empty attempts list', async () => {
    const profile = makeProfile()
    await saveProfile(profile)

    const json = await exportData()

    await deleteDB(DB_NAME)

    await importData(json)

    expect(await loadProfile()).toEqual(profile)
    expect(await listAttempts()).toEqual([])
  })

  it('round-trips a profile with several attempts, edge values intact', async () => {
    const profile = makeProfile({
      rating: RATING_FLOOR,
      requeueState: [{ puzzleId: 'p9', stage: 1, served: 4 }],
    })
    await saveProfile(profile)

    const attempts = [
      makeAttempt({ id: 'a-1', createdAt: '2026-07-01T00:00:00.000Z' }),
      makeAttempt({
        id: 'a-2',
        createdAt: '2026-07-10T00:00:00.000Z',
        correct: false,
        choice_index: null,
      }),
      makeAttempt({ id: 'a-3', createdAt: '2026-07-20T00:00:00.000Z' }),
    ]
    for (const attempt of attempts) {
      await appendAttempt(attempt)
    }

    const json = await exportData()

    await deleteDB(DB_NAME)

    await importData(json)

    expect(await loadProfile()).toEqual(profile)
    const restored = await listAttempts()
    expect(restored).toEqual(attempts)
  })
})

describe('importData rejects malformed/tampered input', () => {
  it('throws on garbage JSON and leaves existing data untouched', async () => {
    const profile = makeProfile()
    const attempt = makeAttempt()
    await saveProfile(profile)
    await appendAttempt(attempt)

    await expect(importData('{not valid json')).rejects.toThrow(/Import failed/)

    expect(await loadProfile()).toEqual(profile)
    expect(await listAttempts()).toEqual([attempt])
  })

  it('throws on syntactically-valid JSON that fails schema validation and leaves existing data untouched', async () => {
    const profile = makeProfile()
    const attempt = makeAttempt()
    await saveProfile(profile)
    await appendAttempt(attempt)

    const tampered = JSON.stringify({
      schema_version: 1,
      exportedAt: new Date().toISOString(),
      profile,
      attempts: [{ puzzleId: 'missing-id' }],
    })

    await expect(importData(tampered)).rejects.toThrow(/Import failed/)

    expect(await loadProfile()).toEqual(profile)
    expect(await listAttempts()).toEqual([attempt])
  })

  it('falls back to String(err) when JSON.parse throws a non-Error value', async () => {
    // JSON.parse only ever throws a real SyntaxError in practice, but the
    // fallback exists for defensive correctness — exercise it directly by
    // making JSON.parse throw a bare string, the way a hostile/synthetic
    // environment might.
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error, to exercise the String(err) fallback
      throw 'not an Error instance'
    })
    try {
      await expect(importData('irrelevant')).rejects.toThrow(
        /Import failed: invalid JSON \(not an Error instance\)/,
      )
    } finally {
      spy.mockRestore()
    }
  })
})
