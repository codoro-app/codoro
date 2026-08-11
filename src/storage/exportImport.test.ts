import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RATING_FLOOR } from '../engine'
import { DB_NAME } from './db'
import { CURRENT_SCHEMA_VERSION } from './schema'
import type { Attempt, UserProfile } from './schema'
import { appendAttempt, listAttempts } from './attempts'
import { loadProfile, saveProfile } from './profile'
import { commitImport, exportData, importData, resolveImportCandidate } from './exportImport'

afterEach(async () => {
  await deleteDB(DB_NAME)
})

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    rating: RATING_FLOOR,
    ratedAttemptCount: 3,
    streak: { currentStreak: 2, longestStreak: 5, lastActiveDate: '2026-07-14' },
    requeueState: [{ puzzleId: 'p9', stage: 1, served: 4 }],
    storagePersisted: true,
    dailyCompletion: null,
    rushStats: null,
    bestRunStreak: 0,
    bossStats: null,
    anonId: 'anon-fixture-1',
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

// Phase 7 Item 1: resolveImportCandidate/commitImport back the Settings UI's
// confirm-before-write flow. resolveImportCandidate never touches storage —
// these tests confirm that explicitly (not just by reading the source) —
// and the four named states it can return.
describe('resolveImportCandidate', () => {
  it('returns invalid-json for unparseable input, without touching storage', async () => {
    const profile = makeProfile()
    await saveProfile(profile)

    expect(resolveImportCandidate('{not valid json')).toEqual({ status: 'invalid-json' })

    expect(await loadProfile()).toEqual(profile)
  })

  it('returns not-export-blob for well-formed JSON that is not an export (no schema_version)', () => {
    expect(resolveImportCandidate(JSON.stringify({ hello: 'world' }))).toEqual({
      status: 'not-export-blob',
    })
  })

  it('returns not-export-blob for well-formed JSON that parses to something other than an object (a bare number, a bare null)', () => {
    expect(resolveImportCandidate('42')).toEqual({ status: 'not-export-blob' })
    expect(resolveImportCandidate('null')).toEqual({ status: 'not-export-blob' })
    expect(resolveImportCandidate('[1,2,3]')).toEqual({ status: 'not-export-blob' })
  })

  it('returns not-export-blob for an older-version envelope whose profile field is not an object', () => {
    const bad = JSON.stringify({
      schema_version: CURRENT_SCHEMA_VERSION - 1,
      exportedAt: new Date().toISOString(),
      profile: null,
      attempts: [],
    })
    expect(resolveImportCandidate(bad)).toEqual({ status: 'not-export-blob' })
  })

  it('returns not-export-blob for a version older than any registered migration reaches', () => {
    // MIGRATIONS is keyed 1-5 (schema.ts's CURRENT_SCHEMA_VERSION is 6) —
    // version 0 predates any registered migration, so runMigrations is a
    // documented no-op and the profile's own schema_version never actually
    // advances to CURRENT_SCHEMA_VERSION, failing the final validation.
    const ancient = JSON.stringify({
      schema_version: 0,
      exportedAt: new Date().toISOString(),
      profile: { schema_version: 0, rating: 1200 },
      attempts: [],
    })
    expect(resolveImportCandidate(ancient)).toEqual({ status: 'not-export-blob' })
  })

  it('returns not-export-blob for well-formed JSON with the right envelope shape but an invalid profile', () => {
    const bad = JSON.stringify({
      schema_version: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      profile: { schema_version: CURRENT_SCHEMA_VERSION },
      attempts: [],
    })
    expect(resolveImportCandidate(bad)).toEqual({ status: 'not-export-blob' })
  })

  it('returns unknown-version for a schema_version newer than this app understands', () => {
    const future = JSON.stringify({
      schema_version: CURRENT_SCHEMA_VERSION + 1,
      exportedAt: new Date().toISOString(),
      profile: makeProfile({ schema_version: CURRENT_SCHEMA_VERSION + 1 }),
      attempts: [],
    })
    expect(resolveImportCandidate(future)).toEqual({
      status: 'unknown-version',
      foundVersion: CURRENT_SCHEMA_VERSION + 1,
    })
  })

  it('returns ok with migratedFromVersion null for a current-version export', () => {
    const profile = makeProfile()
    const json = JSON.stringify({
      schema_version: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      profile,
      attempts: [],
    })
    const result = resolveImportCandidate(json)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.migratedFromVersion).toBeNull()
      expect(result.data.profile).toEqual(profile)
    }
  })

  it('migrates an older-version export forward and returns ok with migratedFromVersion set', () => {
    // A v5 profile — one version before anonId (Phase 7 Item 6) existed.
    const v5Profile = {
      schema_version: 5,
      rating: RATING_FLOOR,
      ratedAttemptCount: 3,
      streak: { currentStreak: 2, longestStreak: 5, lastActiveDate: '2026-07-14' },
      requeueState: [],
      storagePersisted: true,
      dailyCompletion: null,
      rushStats: null,
      bestRunStreak: 0,
      // no anonId, no bossStats — genuinely v5-shaped (bossStats didn't
      // exist until v7); this is the whole point of the test.
    }
    const json = JSON.stringify({
      schema_version: 5,
      exportedAt: new Date().toISOString(),
      profile: v5Profile,
      attempts: [],
    })

    const result = resolveImportCandidate(json)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.migratedFromVersion).toBe(5)
      expect(result.data.profile.schema_version).toBe(CURRENT_SCHEMA_VERSION)
      expect(typeof result.data.profile.anonId).toBe('string')
      expect(result.data.profile.anonId.length).toBeGreaterThan(0)
      expect(result.data.profile.rating).toBe(v5Profile.rating)
    }
  })
})

describe('commitImport', () => {
  it('writes the given data and preserves the current device anonId, not the imported file anonId', async () => {
    await saveProfile(makeProfile({ anonId: 'device-own-anon-id', rating: 1000 }))

    const incoming = makeProfile({ anonId: 'someone-elses-anon-id', rating: 1999 })
    await commitImport({
      schema_version: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      profile: incoming,
      attempts: [],
    })

    const loaded = await loadProfile()
    // The rest of the profile is replaced (this is what "import" means)...
    expect(loaded.rating).toBe(1999)
    // ...but this device's own identity survives the import untouched — the
    // "import collision" fix (Phase 7 Item 6): two different people's data
    // landing on one device must never merge their telemetry identity.
    expect(loaded.anonId).toBe('device-own-anon-id')
  })

  it('seeds a fresh anonId when committing on a device with no prior profile at all', async () => {
    const incoming = makeProfile({ anonId: 'someone-elses-anon-id' })
    await commitImport({
      schema_version: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      profile: incoming,
      attempts: [],
    })

    const loaded = await loadProfile()
    expect(loaded.anonId).not.toBe('someone-elses-anon-id')
    expect(typeof loaded.anonId).toBe('string')
    expect(loaded.anonId.length).toBeGreaterThan(0)
  })
})
