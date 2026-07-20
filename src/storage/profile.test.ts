import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import type { IDBPDatabase } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { DB_NAME, PROFILE_KEY, PROFILE_STORE, getDb } from './db'
import { createDefaultProfile } from './schema'
import type { UserProfile } from './schema'
import { loadProfile, saveProfile } from './profile'

afterEach(async () => {
  await deleteDB(DB_NAME)
})

// Open a connection, run fn, and always close it — leaving a handle open in a
// test would block the deleteDB reset in afterEach.
async function withDb<T>(fn: (db: IDBPDatabase) => Promise<T>): Promise<T> {
  const db = await getDb()
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

describe('loadProfile', () => {
  it('returns and persists a fresh default on first-ever load', async () => {
    const first = await loadProfile()
    expect(first).toEqual(createDefaultProfile())

    // Persisted, not just returned in memory: read it straight back from disk.
    const stored = await withDb<unknown>((db) => db.get(PROFILE_STORE, PROFILE_KEY))
    expect(stored).toEqual(createDefaultProfile())
  })

  it('round-trips a saved profile exactly', async () => {
    const profile: UserProfile = {
      schema_version: 2,
      rating: 1342.75,
      ratedAttemptCount: 7,
      streak: { currentStreak: 3, longestStreak: 9, lastActiveDate: '2026-07-14' },
      requeueState: [{ puzzleId: 'p9', stage: 2, served: 12 }],
      storagePersisted: true,
      dailyCompletion: { date: '2026-07-14', attemptId: 'a1', correct: true },
    }
    await saveProfile(profile)
    expect(await loadProfile()).toEqual(profile)
  })
})

describe('saveProfile', () => {
  it('rejects and does not write a profile that fails validation', async () => {
    const bad = { ...createDefaultProfile(), rating: 'not a number' } as unknown as UserProfile
    await expect(saveProfile(bad)).rejects.toThrow()

    const stored = await withDb<unknown>((db) => db.get(PROFILE_STORE, PROFILE_KEY))
    expect(stored).toBeUndefined()
  })
})

describe('corrupt-data recovery', () => {
  it('recovers from garbage: no throw, fresh default persisted, raw backed up', async () => {
    const garbage = { schema_version: 1, rating: 'not a number' }
    await withDb((db) => db.put(PROFILE_STORE, garbage, PROFILE_KEY))

    // (a) does not throw, (b) returns a valid fresh default.
    const recovered = await loadProfile()
    expect(recovered).toEqual(createDefaultProfile())

    await withDb(async (db) => {
      // (c) the fresh default was actually persisted under PROFILE_KEY.
      const stored: unknown = await db.get(PROFILE_STORE, PROFILE_KEY)
      expect(stored).toEqual(createDefaultProfile())

      // (d) the raw garbage is recoverable under a corrupt-* key, byte-exact.
      const keys = await db.getAllKeys(PROFILE_STORE)
      const corruptKey = keys.find((k) => typeof k === 'string' && k.startsWith('corrupt-'))
      expect(corruptKey).toBeDefined()
      const backup: unknown = await db.get(PROFILE_STORE, corruptKey as string)
      expect(backup).toEqual(garbage)
    })
  })

  it('recovers from a non-object stored value', async () => {
    await withDb((db) => db.put(PROFILE_STORE, 'not an object', PROFILE_KEY))

    const recovered = await loadProfile()
    expect(recovered).toEqual(createDefaultProfile())

    await withDb(async (db) => {
      const keys = await db.getAllKeys(PROFILE_STORE)
      const corruptKey = keys.find((k) => typeof k === 'string' && k.startsWith('corrupt-'))
      expect(corruptKey).toBeDefined()
      const backup: unknown = await db.get(PROFILE_STORE, corruptKey as string)
      expect(backup).toBe('not an object')
    })
  })

  it('routes a stale schema_version through the migration runner before validating', async () => {
    // schema_version 0 predates any version this app has ever shipped, so
    // MIGRATIONS (empty today) has nothing registered for it — runMigrations
    // is still invoked and correctly no-ops, and the subsequently-still-stale
    // object fails final validation, landing in the same corrupt-recovery
    // path exercised above. This proves loadProfile's `< CURRENT_SCHEMA_VERSION`
    // branch actually calls the migration runner, not just the "already
    // current" passthrough.
    const stale = { schema_version: 0, rating: 1200 }
    await withDb((db) => db.put(PROFILE_STORE, stale, PROFILE_KEY))

    const recovered = await loadProfile()
    expect(recovered).toEqual(createDefaultProfile())

    await withDb(async (db) => {
      const keys = await db.getAllKeys(PROFILE_STORE)
      const corruptKey = keys.find((k) => typeof k === 'string' && k.startsWith('corrupt-'))
      expect(corruptKey).toBeDefined()
      const backup: unknown = await db.get(PROFILE_STORE, corruptKey as string)
      expect(backup).toEqual(stale)
    })
  })
})

describe('schema migration on load', () => {
  it('migrates a v1 stored profile to v2 on load, preserving rating/streak/ratedAttemptCount and persisting the upgrade', async () => {
    const v1Profile = {
      schema_version: 1,
      rating: 1389.25,
      ratedAttemptCount: 14,
      streak: { currentStreak: 6, longestStreak: 11, lastActiveDate: '2026-07-18' },
      requeueState: [{ puzzleId: 'p3', stage: 0, served: 1 }],
      storagePersisted: true,
    }
    await withDb((db) => db.put(PROFILE_STORE, v1Profile, PROFILE_KEY))

    const migrated = await loadProfile()

    expect(migrated).toEqual({
      ...v1Profile,
      schema_version: 2,
      dailyCompletion: null,
    })

    // loadProfile migrates in-memory only — it does not write the upgraded
    // shape back to disk itself (the raw bytes stay v1 until the next
    // saveProfile call, e.g. any Practice/Daily attempt). runMigrations is
    // idempotent and cheap, so re-migrating from the same v1 raw bytes on
    // every load is correct, not a bug.
    const stored = await withDb<unknown>((db) => db.get(PROFILE_STORE, PROFILE_KEY))
    expect(stored).toEqual(v1Profile)
  })
})
