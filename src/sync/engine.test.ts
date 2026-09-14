import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deleteDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../auth/api'
import type { ApiRequestOptions } from '../auth/api'
import type { ProfilePutRequest } from '../../workers/shared/api-types'
import type { Attempt, ExportedData } from '../storage'
import {
  CURRENT_SCHEMA_VERSION,
  appendAttempt,
  createDefaultProfile,
  loadProfile,
  saveProfile,
} from '../storage'
import { readQueueEntry, recordQueueFailure } from './queue'

// apiFetch is the ONLY thing engine.ts is allowed to reach the network
// through (per the brief: "it does not construct fetches or re-derive the
// ApiError taxonomy") -- mocked here; ApiError itself stays real so
// `err instanceof ApiError` in engine.ts keeps working against thrown mocks.
vi.mock('../auth/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const trackSyncPush = vi.fn()
const trackSyncPull = vi.fn()
const trackSyncConflict = vi.fn()
vi.mock('../telemetry', () => ({
  trackSyncPush: (...args: unknown[]): void => {
    trackSyncPush(...args)
  },
  trackSyncPull: (...args: unknown[]): void => {
    trackSyncPull(...args)
  },
  trackSyncConflict: (...args: unknown[]): void => {
    trackSyncConflict(...args)
  },
}))

const { apiFetch } = await import('../auth/api')
const apiFetchMock = vi.mocked(apiFetch)
const { createSyncEngine, SYNC_META_STORAGE_KEY, LAST_MUTATED_AT_STORAGE_KEY, readSyncMeta } =
  await import('./engine')
type SyncEngine = ReturnType<typeof createSyncEngine>

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
function loadFixture(name: string): ExportedData {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8')) as ExportedData
}
const longLived = loadFixture('long-lived')

// Review finding: the F31 switch tests below must seed a REAL local
// attempt before triggering a switch, or "attempts are exactly remote's"
// is vacuous (a local attempts array that was already empty unions
// identically to remote's regardless of whether reset or merge ran).
function accountAAttempt(): Attempt {
  return {
    id: 'account-a-attempt-1',
    puzzleId: 'con-001',
    puzzleRating: 1200,
    mode: 'practice',
    correct: true,
    time_ms: 1000,
    choice_index: 0,
    checkpoint_results: null,
    userRatingBefore: 1200,
    userRatingAfter: 1210,
    localDateString: '2024-01-01',
    createdAt: '2024-01-01T00:00:00.000Z',
  }
}

function conflictError(): ApiError {
  return new ApiError('client', 'Conflict', 409)
}
function tooLargeError(): ApiError {
  return new ApiError('client', 'Profile data too large', 413)
}
function networkError(): ApiError {
  return new ApiError('network', 'Could not reach the server.')
}
function notFoundError(): ApiError {
  return new ApiError('not-found', 'Not found', 404)
}

function methodOf(opts?: ApiRequestOptions): string | undefined {
  return opts?.method
}

/**
 * The default every test starts from: a fresh account (GET 404) that
 * pushes cleanly as revision 1 (PUT succeeds). This keeps `handleSignedIn`'s
 * own setup call side-effect-free for tests that don't care about it (no
 * leftover queue entry, no leftover non-'success' telemetry call to reason
 * around) -- tests that DO care override apiFetchMock explicitly afterward.
 */
function mockDefaultFreshAccount(): void {
  apiFetchMock.mockImplementation((_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
    if (methodOf(opts) === 'GET') return Promise.reject(notFoundError())
    if (methodOf(opts) === 'PUT') return Promise.resolve({ ok: true, revision: 1 })
    return Promise.reject(new Error('unexpected method in default mock'))
  })
}

describe('sync engine', () => {
  let engine: SyncEngine
  const getToken = vi.fn(() => Promise.resolve('test-token'))

  beforeEach(() => {
    localStorage.clear()
    apiFetchMock.mockReset()
    trackSyncPush.mockReset()
    trackSyncPull.mockReset()
    trackSyncConflict.mockReset()
    getToken.mockClear()
    mockDefaultFreshAccount()
    engine = createSyncEngine({ getToken })
  })

  afterEach(async () => {
    localStorage.clear()
    await deleteDB('codoro')
  })

  describe('first sign-in migration (local profile, server 404)', () => {
    it('pushes the local profile as revision 1 and links anonId on that same push', async () => {
      const local = await loadProfile() // seeds a real fresh default profile in IndexedDB
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') return Promise.reject(notFoundError())
          if (methodOf(opts) === 'PUT') return Promise.resolve({ ok: true, revision: 1 })
          return Promise.reject(new Error('unexpected method'))
        },
      )

      await engine.handleSignedIn('user_a')

      const putCall = apiFetchMock.mock.calls.find(([, opts]) => methodOf(opts) === 'PUT')
      if (!putCall) throw new Error('expected a PUT call to have been made')
      const putOpts = putCall[1]
      const body = putOpts?.body as ProfilePutRequest
      expect(body.baseRevision).toBe(0)
      expect(body.anonId).toBe(local.anonId)
      expect((body.payload as ExportedData).profile.anonId).toBe(local.anonId)

      expect(readSyncMeta()).toEqual({ userId: 'user_a', baseRevision: 1 })
      expect(trackSyncPush).toHaveBeenCalledWith({ outcome: 'success' })
    })
  })

  describe('B1 (review finding) — a genuinely malformed remote blob degrades silently instead of throwing', () => {
    it('pull() resolves with { kind: "error" } rather than rejecting when merge() throws', async () => {
      // Mirrors merge.ts's own doc comment: a behind-schema blob that fails
      // to migrate cleanly throws inside migrateRemoteProfileIfBehind(),
      // "T8 catches it like any other pull failure per I2." Before the B1
      // fix, this rejected doPull() -- and, reached via push()'s
      // conflict-retry, would have been an unhandled rejection.
      const malformedRemote = {
        schema_version: CURRENT_SCHEMA_VERSION - 1,
        exportedAt: new Date().toISOString(),
        profile: { schema_version: CURRENT_SCHEMA_VERSION - 1, rating: 'not a number' },
        attempts: [],
      }
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 1,
              schemaVersion: malformedRemote.schema_version,
              payload: malformedRemote,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('push must not be attempted in this test'))
        },
      )

      await expect(engine.pull()).resolves.toEqual({ kind: 'error' })
      expect(trackSyncPull).toHaveBeenCalledWith({ outcome: 'error' })
    })
  })

  describe('B2 (review finding) — the local mutation clock, not "now," decides latest-wins fields', () => {
    it('lets a genuinely newer remote value win a latest-wins field, even though a fresh exportData() call would stamp "now"', async () => {
      // Reproduces the review's exact repro: without B2's fix, local's
      // exportedAt is always the moment exportData() is called (i.e. "now"),
      // which is always >= any remote's necessarily-earlier push timestamp
      // -- so latest-wins fields (challengerName here) could never let
      // remote win. Seeding an OLD recorded mutation time directly
      // simulates "this device's last real local change was long ago,"
      // which a fresh exportData() call alone can never express.
      localStorage.setItem(LAST_MUTATED_AT_STORAGE_KEY, '2000-01-01T00:00:00.000Z')
      const localProfile = { ...createDefaultProfile(), challengerName: 'LOCAL-OLD' }
      await saveProfile(localProfile)

      const remote: ExportedData = {
        schema_version: CURRENT_SCHEMA_VERSION,
        exportedAt: new Date(Date.now() - 1000).toISOString(), // 1s ago -- newer than the seeded year-2000 clock
        profile: { ...createDefaultProfile(), challengerName: 'REMOTE-NEW' },
        attempts: [],
      }
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 2,
              schemaVersion: remote.schema_version,
              payload: remote,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('push must not be attempted in this test'))
        },
      )

      await engine.pull()

      expect((await loadProfile()).challengerName).toBe('REMOTE-NEW')
    })

    it('keeps a genuinely newer local value when the recorded mutation clock is newer than a stale remote', async () => {
      localStorage.setItem(LAST_MUTATED_AT_STORAGE_KEY, new Date().toISOString())
      const localProfile = { ...createDefaultProfile(), challengerName: 'LOCAL-NEW' }
      await saveProfile(localProfile)

      const remote: ExportedData = {
        schema_version: CURRENT_SCHEMA_VERSION,
        exportedAt: '2000-01-01T00:00:00.000Z',
        profile: { ...createDefaultProfile(), challengerName: 'REMOTE-OLD' },
        attempts: [],
      }
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 2,
              schemaVersion: remote.schema_version,
              payload: remote,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('push must not be attempted in this test'))
        },
      )

      await engine.pull()

      expect((await loadProfile()).challengerName).toBe('LOCAL-NEW')
    })

    it('notifyMutation() records the local mutation clock immediately, even before its debounced push fires', () => {
      const before = localStorage.getItem(LAST_MUTATED_AT_STORAGE_KEY)
      expect(before).toBeNull()

      engine.notifyMutation()

      expect(localStorage.getItem(LAST_MUTATED_AT_STORAGE_KEY)).not.toBeNull()
    })
  })

  describe('ordinary pull + merge (F26: against the real createDefaultProfile() shape)', () => {
    it('merges a fresh local profile against a real remote fixture with no throw', async () => {
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 4,
              schemaVersion: longLived.schema_version,
              payload: longLived,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('unexpected method in this test'))
        },
      )

      const outcome = await engine.pull()

      expect(outcome).toEqual({ kind: 'merged' })
      const saved = await loadProfile()
      // A genuinely fresh local profile contributes nothing to rating/streak
      // recompute, exercised for real against T6's own merge() -- but the
      // recomputed rating is NOT expected to equal the fixture's own stored
      // rating byte-for-byte: merge.ts's own doc comment documents a real,
      // deliberate approximation for Trace/scrubber attempts (raw ratio
      // instead of the floor-adjusted score the live engine originally
      // used), and this fixture contains one. T6's own merge.test.ts never
      // asserts fixture-exact equality here either -- only that merging
      // succeeds. What actually matters (no throw, a real finite number,
      // attempts genuinely recomputed) is what this test asserts.
      expect(Number.isFinite(saved.rating)).toBe(true)
      expect(saved.ratedAttemptCount).toBeGreaterThan(0)
      expect(readSyncMeta()).toEqual({ userId: null, baseRevision: 4 })
    })
  })

  describe('I11 — idempotence', () => {
    it('applying the same pulled revision twice is a no-op the second time', async () => {
      apiFetchMock.mockImplementation((): Promise<unknown> =>
        Promise.resolve({
          revision: 4,
          schemaVersion: longLived.schema_version,
          payload: longLived,
          updatedAt: Date.now(),
        }),
      )

      const first = await engine.pull()
      expect(first).toEqual({ kind: 'merged' })
      const afterFirst = await loadProfile()

      const second = await engine.pull()
      expect(second).toEqual({ kind: 'noop' })
      const afterSecond = await loadProfile()

      // Not just "equal by coincidence" -- the fixture's rating differs from
      // INITIAL_RATING (1200), so a non-idempotent implementation
      // (re-recomputing or re-unioning attempts a second time against
      // whatever the first pass already wrote) would visibly diverge here.
      expect(afterSecond).toEqual(afterFirst)
      expect(afterFirst.rating).not.toBe(1200)
    })
  })

  describe('I12 — pull/push mutual exclusion', () => {
    it('a pull and a push triggered in the same tick serialize; push never runs until the pull fully lands', async () => {
      await engine.handleSignedIn('user_a') // settles the initial 404-then-push cycle
      apiFetchMock.mockClear()

      let resolveGet!: (value: unknown) => void
      const getPromise = new Promise((resolve) => {
        resolveGet = resolve
      })
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') return getPromise
          if (methodOf(opts) === 'PUT') return Promise.resolve({ ok: true, revision: 99 })
          return Promise.reject(new Error('unexpected method'))
        },
      )

      const pullPromise = engine.pull()
      const pushPromise = engine.push()

      // Review finding S1: a handful of microtask ticks isn't long enough
      // to distinguish "the mutex is serializing these" from "doPushOnce's
      // own real IndexedDB work (exportData()) just hasn't resolved yet" --
      // both look identical at that timescale, so the original version of
      // this test passed even with withLock's body replaced by `return
      // fn()` (no locking at all). A generous *real* delay closes that
      // gap: without the mutex, push's own token/exportData()/apiFetch(PUT)
      // chain has unbounded real time here to complete on its own, so if
      // the PUT still hasn't fired, serialization -- not IndexedDB
      // latency -- is the only thing that explains it.
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(methodOf(apiFetchMock.mock.calls[0]?.[1])).toBe('GET')

      resolveGet({
        revision: 5,
        schemaVersion: longLived.schema_version,
        payload: longLived,
        updatedAt: Date.now(),
      })
      await Promise.all([pullPromise, pushPromise])

      expect(apiFetchMock).toHaveBeenCalledTimes(2)
      expect(methodOf(apiFetchMock.mock.calls[1]?.[1])).toBe('PUT')
    })
  })

  describe('409 conflict handling', () => {
    it('merges the server state and re-pushes with the new baseRevision on a single conflict', async () => {
      await engine.handleSignedIn('user_a')
      apiFetchMock.mockReset()

      let putCalls = 0
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 7,
              schemaVersion: longLived.schema_version,
              payload: longLived,
              updatedAt: Date.now(),
            })
          }
          if (methodOf(opts) === 'PUT') {
            putCalls += 1
            if (putCalls === 1) return Promise.reject(conflictError())
            return Promise.resolve({ ok: true, revision: 8 })
          }
          return Promise.reject(new Error('unexpected method'))
        },
      )

      await engine.push()

      const getCalls = apiFetchMock.mock.calls.filter(([, opts]) => methodOf(opts) === 'GET').length
      expect(getCalls).toBe(1)
      expect(putCalls).toBe(2)
      expect(trackSyncConflict).toHaveBeenCalledTimes(1)
      expect(trackSyncPush).toHaveBeenCalledWith({ outcome: 'conflict-resolved' })
      expect(readSyncMeta()).toEqual({ userId: 'user_a', baseRevision: 8 })
      expect(readQueueEntry()).toBeNull()
    })

    it('caps retries at 3 total push attempts and requeues instead of looping forever', async () => {
      await engine.handleSignedIn('user_a')
      apiFetchMock.mockReset()

      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 7,
              schemaVersion: longLived.schema_version,
              payload: longLived,
              updatedAt: Date.now(),
            })
          }
          if (methodOf(opts) === 'PUT') return Promise.reject(conflictError())
          return Promise.reject(new Error('unexpected method'))
        },
      )

      await engine.push()

      const putCalls = apiFetchMock.mock.calls.filter(([, opts]) => methodOf(opts) === 'PUT').length
      const getCalls = apiFetchMock.mock.calls.filter(([, opts]) => methodOf(opts) === 'GET').length
      expect(putCalls).toBe(3) // the cap: never a 4th attempt
      expect(getCalls).toBe(2) // one retry-pull after attempt 1 and after attempt 2, none after the 3rd
      expect(trackSyncConflict).toHaveBeenCalledTimes(3)
      expect(trackSyncPush).toHaveBeenCalledWith({ outcome: 'conflict-exhausted' })
      expect(readQueueEntry()).not.toBeNull() // requeued, not dropped
    })
  })

  describe('413 — terminal, not retryable', () => {
    it('drops the push without queuing a retry and records a distinct telemetry outcome', async () => {
      await engine.handleSignedIn('user_a')
      apiFetchMock.mockReset()
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'PUT') return Promise.reject(tooLargeError())
          return Promise.reject(new Error('unexpected method'))
        },
      )

      const localBefore = await loadProfile()
      await engine.push()
      const localAfter = await loadProfile()

      expect(readQueueEntry()).toBeNull()
      expect(trackSyncPush).toHaveBeenCalledWith({ outcome: 'too-large' })
      expect(localAfter).toEqual(localBefore) // local state untouched
    })

    // Review finding S4: a 413 must also clear a queue entry that was
    // ALREADY there from an earlier, unrelated network failure -- without
    // this, a device that reconnects (handleOnline drains unconditionally)
    // would repeat the same guaranteed-413 round trip forever.
    it('clears a pre-existing queued retry from an earlier failure, not just skips adding a new one', async () => {
      await engine.handleSignedIn('user_a')
      recordQueueFailure('user_a', CURRENT_SCHEMA_VERSION, Date.now()) // simulate an earlier, unrelated failure already queued
      expect(readQueueEntry()).not.toBeNull()

      apiFetchMock.mockReset()
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'PUT') return Promise.reject(tooLargeError())
          return Promise.reject(new Error('unexpected method'))
        },
      )

      await engine.push()

      expect(readQueueEntry()).toBeNull()
    })
  })

  describe('offline behavior (I2) — play continues unaffected', () => {
    it('a rejecting fetch during push never throws out of the engine, and queues a retry', async () => {
      await engine.handleSignedIn('user_a')
      apiFetchMock.mockReset()
      apiFetchMock.mockRejectedValue(networkError())

      await expect(engine.push()).resolves.toBeUndefined()

      expect(readQueueEntry()).not.toBeNull()
      expect(trackSyncPush).toHaveBeenCalledWith({ outcome: 'network-error' })
    })

    it('a rejecting fetch during pull never throws, and degrades to a silent error outcome', async () => {
      apiFetchMock.mockRejectedValue(networkError())
      await expect(engine.pull()).resolves.toEqual({ kind: 'error' })
      expect(trackSyncPull).toHaveBeenCalledWith({ outcome: 'error' })
    })
  })

  describe('reload-with-pending-queue', () => {
    it('a queue entry written before a simulated reload is drained by a fresh engine instance on the online event', async () => {
      recordQueueFailure('user_a', CURRENT_SCHEMA_VERSION, Date.now())

      // "Reload": a brand-new engine instance, same localStorage/IndexedDB.
      const reloaded = createSyncEngine({ getToken })
      apiFetchMock.mockReset()
      apiFetchMock.mockImplementation((_path: string, opts?: ApiRequestOptions): Promise<unknown> =>
        Promise.reject(
          new Error(`unexpected method in pre-signin mock: ${methodOf(opts) ?? 'none'}`),
        ),
      )

      await reloaded.handleSignedIn('user_a') // its own pull fails generically; doesn't touch the pre-seeded queue
      apiFetchMock.mockClear()
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'PUT') return Promise.resolve({ ok: true, revision: 2 })
          return Promise.reject(new Error('unexpected method'))
        },
      )

      await reloaded.handleOnline()

      const putCalls = apiFetchMock.mock.calls.filter(([, opts]) => methodOf(opts) === 'PUT').length
      expect(putCalls).toBe(1)
      expect(readQueueEntry()).toBeNull()
    })
  })

  describe('F28 — a schema-stale queue entry is dropped, not replayed', () => {
    it('handleOnline drops a queue entry built against an older schema version without ever pushing it', async () => {
      await engine.handleSignedIn('user_a') // clean setup first (would otherwise clearQueue() on its own success)
      recordQueueFailure('user_a', CURRENT_SCHEMA_VERSION - 1, Date.now())
      apiFetchMock.mockClear()

      await engine.handleOnline()

      expect(apiFetchMock).not.toHaveBeenCalled()
      expect(readQueueEntry()).toBeNull()
      expect(trackSyncPush).toHaveBeenCalledWith({ outcome: 'stale-schema-dropped' })
    })
  })

  describe('F31 — account switching on one device', () => {
    it('same user returning: existing sync metadata and queue are left alone', async () => {
      localStorage.setItem(
        SYNC_META_STORAGE_KEY,
        JSON.stringify({ userId: 'user_a', baseRevision: 7 }),
      )
      recordQueueFailure('user_a', CURRENT_SCHEMA_VERSION, Date.now())
      apiFetchMock.mockRejectedValue(networkError()) // pull fails; must not itself clear anything

      await engine.handleSignedIn('user_a')

      expect(readSyncMeta()).toEqual({ userId: 'user_a', baseRevision: 7 })
      const entry = readQueueEntry()
      if (!entry) throw new Error('expected the pre-seeded queue entry to survive')
      expect(entry.userId).toBe('user_a')
      expect(entry.attempts).toBe(1)
    })

    it('a different user arriving discards the stale metadata and queue before any pull/push runs', async () => {
      localStorage.setItem(
        SYNC_META_STORAGE_KEY,
        JSON.stringify({ userId: 'user_a', baseRevision: 7 }),
      )
      recordQueueFailure('user_a', CURRENT_SCHEMA_VERSION, Date.now())
      apiFetchMock.mockRejectedValue(networkError()) // pull fails; discard must already have happened by then

      await engine.handleSignedIn('user_b')

      expect(readSyncMeta()?.userId !== 'user_a').toBe(true)
      expect(readQueueEntry()?.userId !== 'user_a').toBe(true)
    })

    // T8b, Finding 1 (F31's second half): the test above proves the
    // *ordering* guarantee (metadata/queue discarded before any pull/push
    // runs), but its own pull fails, so it never reaches the one path
    // where F31's data-half bug actually bit: a genuinely fresh account B
    // (server 404). Before the fix, handleSignedIn's ordinary
    // "not-found -> push" rule pushed whatever this device's local
    // IndexedDB profile currently held (account A's, never cleared on
    // sign-out) as account B's revision 1. Fixed by resetting local
    // storage to a blank profile *before* the 404 is even reached (see
    // handleSignedIn's own comment) -- this test would fail if that reset
    // were skipped or ran after the push instead of before it.
    it("a different user arriving to a genuinely fresh account (404) pushes this device's own freshly-reset (blank) state, never account A's local data", async () => {
      localStorage.setItem(
        SYNC_META_STORAGE_KEY,
        JSON.stringify({ userId: 'user_a', baseRevision: 7 }),
      )
      localStorage.setItem(LAST_MUTATED_AT_STORAGE_KEY, '2000-01-01T00:00:00.000Z')
      const localProfile = { ...createDefaultProfile(), challengerName: 'ACCOUNT-A-LOCAL-DATA' }
      await saveProfile(localProfile)
      // Review finding: a real local attempt, not just a bare profile --
      // without one, "pushed attempts is []" is true whether or not the
      // reset actually ran (an empty attempts array was already the state).
      await appendAttempt(accountAAttempt())
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') return Promise.reject(notFoundError())
          if (methodOf(opts) === 'PUT') return Promise.resolve({ ok: true, revision: 1 })
          return Promise.reject(new Error('unexpected method'))
        },
      )

      await engine.handleSignedIn('user_b')

      const putCall = apiFetchMock.mock.calls.find(([, opts]) => methodOf(opts) === 'PUT')
      if (!putCall) throw new Error('expected handleSignedIn to push after the 404')
      const body = putCall[1]?.body as ProfilePutRequest
      const pushedProfile = (body.payload as ExportedData).profile
      // Account A's data must be gone -- pushed payload is a blank profile,
      // not a bypass of the reset.
      expect(pushedProfile.challengerName).toBe(createDefaultProfile().challengerName)
      expect(pushedProfile.challengerName).not.toBe('ACCOUNT-A-LOCAL-DATA')
      expect((body.payload as ExportedData).attempts).toEqual([]) // account A's seeded attempt must be gone, not carried into B's push
      expect(readSyncMeta()).toEqual({ userId: 'user_b', baseRevision: 1 })
      // Also verifies locally, not just via the pushed wire body.
      expect((await loadProfile()).challengerName).not.toBe('ACCOUNT-A-LOCAL-DATA')
      // Precise, not just "changed": resetLocalToBlank() clears this key
      // outright, and neither the reset nor the subsequent 404-triggered
      // push ever re-stamps it (only a real pull/merge or notifyMutation
      // does) -- it must read back exactly null, not merely "some other
      // value."
      expect(localStorage.getItem(LAST_MUTATED_AT_STORAGE_KEY)).toBeNull()
    })

    it("a different user arriving to an EXISTING account (200) adopts remote wholesale -- never a merge with the prior account's local data", async () => {
      localStorage.setItem(
        SYNC_META_STORAGE_KEY,
        JSON.stringify({ userId: 'user_a', baseRevision: 7 }),
      )
      const localProfile = { ...createDefaultProfile(), challengerName: 'ACCOUNT-A-LOCAL-DATA' }
      await saveProfile(localProfile)
      // Review finding: a real local attempt, not just a bare profile --
      // without one, "attempts are exactly remote's" is true whether or
      // not the reset actually ran (a local attempts array that was
      // already empty unions identically to remote's either way).
      await appendAttempt(accountAAttempt())

      const remoteForB: ExportedData = {
        ...longLived,
        exportedAt: '2000-01-01T00:00:00.000Z', // deliberately OLDER than the post-reset local's "now" fallback -- see the comment below
        profile: { ...longLived.profile, challengerName: 'ACCOUNT-B-REMOTE-DATA' },
      }
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 9,
              schemaVersion: remoteForB.schema_version,
              payload: remoteForB,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(
            new Error(
              'push must not be attempted -- remote already matches local after adopting it',
            ),
          )
        },
      )

      await engine.handleSignedIn('user_b')

      const saved = await loadProfile()
      // Wholesale adoption: B's real challengerName wins outright. This IS
      // the distinguishing assertion, not a coincidental match with what a
      // merge would also produce: resetLocalToBlank() clears the recorded
      // mutation clock, so a post-reset local's exportedAt falls back to
      // exportData()'s own "now" (see buildLocalExportedData's doc
      // comment) -- which is *later* than remote's deliberately-old
      // 2000-01-01 stamp. If a real merge ran here instead of a wholesale
      // adopt, its "latest wins" rule would let the newer (post-reset,
      // blank) LOCAL side win, producing the profile's *default*
      // challengerName (null), never remote's 'ACCOUNT-B-REMOTE-DATA'.
      expect(saved.challengerName).toBe('ACCOUNT-B-REMOTE-DATA')
      // Second distinguishing assertion: attempts are exactly remote's --
      // account A's real seeded attempt must be gone, not unioned in (a
      // merge unions by id and keeps both sides).
      const { listAttempts } = await import('../storage')
      const savedAttempts = await listAttempts()
      expect(savedAttempts.map((a) => a.id).sort()).toEqual(
        [...remoteForB.attempts].map((a) => a.id).sort(),
      )
      expect(savedAttempts.map((a) => a.id)).not.toContain(accountAAttempt().id)
      expect(readSyncMeta()).toEqual({ userId: 'user_b', baseRevision: 9 })
    })
  })

  describe('F31, second half — guest-to-account migration still merges (syncMeta === null is not a switch)', () => {
    it('a real merge runs -- local guest data is not discarded, and would be lost if the reset branch ran by mistake', async () => {
      // No pre-existing sync meta at all: this is the anonymous-to-account
      // migration case, not a switch -- MERGE, per F31's own distinction.
      expect(readSyncMeta()).toBeNull()
      localStorage.setItem(LAST_MUTATED_AT_STORAGE_KEY, new Date().toISOString()) // genuinely newer than remote below
      const localProfile = { ...createDefaultProfile(), challengerName: 'GUEST-LOCAL-NEWER' }
      await saveProfile(localProfile)

      const remote: ExportedData = {
        ...longLived,
        exportedAt: '2000-01-01T00:00:00.000Z',
        profile: { ...longLived.profile, challengerName: 'REMOTE-OLDER' },
      }
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 3,
              schemaVersion: remote.schema_version,
              payload: remote,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('push must not be attempted in this test'))
        },
      )

      await engine.handleSignedIn('user_new')

      // If the reset/adopt-wholesale branch ran here by mistake, local's
      // genuinely-newer challengerName would be silently discarded in
      // favor of remote's -- this is exactly the failure this test exists
      // to catch.
      expect((await loadProfile()).challengerName).toBe('GUEST-LOCAL-NEWER')
      expect(readSyncMeta()).toEqual({ userId: 'user_new', baseRevision: 3 })
    })
  })

  describe('F31, second half (review findings) — this device keeps its own anonId across a switch', () => {
    it("the 200 (existing account) path preserves this device's anonId, never remote's", async () => {
      localStorage.setItem(
        SYNC_META_STORAGE_KEY,
        JSON.stringify({ userId: 'user_a', baseRevision: 7 }),
      )
      const localProfile = { ...createDefaultProfile(), anonId: 'device-own-anon-id' }
      await saveProfile(localProfile)

      const remoteForB: ExportedData = {
        ...longLived,
        profile: { ...longLived.profile, anonId: 'account-b-other-device-anon-id' },
      }
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 9,
              schemaVersion: remoteForB.schema_version,
              payload: remoteForB,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('push must not be attempted in this test'))
        },
      )

      await engine.handleSignedIn('user_b')

      // Adopting remote's data wholesale must not mean adopting remote's
      // anonId too -- that would silently merge this device's PostHog
      // identity with whichever OTHER device last pushed account B's data.
      expect((await loadProfile()).anonId).toBe('device-own-anon-id')
    })

    it("the 404 (fresh account) path preserves this device's anonId, never mints a fresh one", async () => {
      localStorage.setItem(
        SYNC_META_STORAGE_KEY,
        JSON.stringify({ userId: 'user_a', baseRevision: 7 }),
      )
      const localProfile = { ...createDefaultProfile(), anonId: 'device-own-anon-id-2' }
      await saveProfile(localProfile)
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') return Promise.reject(notFoundError())
          if (methodOf(opts) === 'PUT') return Promise.resolve({ ok: true, revision: 1 })
          return Promise.reject(new Error('unexpected method'))
        },
      )

      await engine.handleSignedIn('user_b')

      // Phase 7 Item 6's "stable, generate once" contract: a device's
      // anonId must survive an account switch even when the switch lands
      // on a genuinely fresh account, not get silently regenerated by
      // createDefaultProfile()'s own fresh crypto.randomUUID().
      expect((await loadProfile()).anonId).toBe('device-own-anon-id-2')
      const putCall = apiFetchMock.mock.calls.find(([, opts]) => methodOf(opts) === 'PUT')
      if (!putCall) throw new Error('expected handleSignedIn to push after the 404')
      const body = putCall[1]?.body as ProfilePutRequest
      expect(body.anonId).toBe('device-own-anon-id-2')
    })
  })

  describe('F31 concurrency (review finding) — React StrictMode double-invoke does not race the switch', () => {
    it('a second concurrent handleSignedIn call is serialized behind the first -- its own GET never dispatches until the first fully completes', async () => {
      localStorage.setItem(
        SYNC_META_STORAGE_KEY,
        JSON.stringify({ userId: 'user_a', baseRevision: 7 }),
      )
      await saveProfile({ ...createDefaultProfile(), challengerName: 'ACCOUNT-A-LOCAL-DATA' })

      const remoteForB: ExportedData = {
        ...longLived,
        profile: { ...longLived.profile, challengerName: 'ACCOUNT-B-REMOTE-DATA' },
      }
      const remoteResponse = {
        revision: 9,
        schemaVersion: remoteForB.schema_version,
        payload: remoteForB,
        updatedAt: Date.now(),
      }
      // First GET deliberately hangs (manually resolved below) so there's a
      // real window in which call1 is in flight, waiting on its own GET,
      // to observe whether call2 has *also* reached its own GET dispatch
      // yet -- same manually-controlled-promise technique the I12 test
      // above uses, and for the same reason (fake-indexeddb's own real
      // async work can't be reliably sequenced by counting microtasks).
      let resolveFirstGet!: (value: unknown) => void
      const firstGetPromise = new Promise((resolve) => {
        resolveFirstGet = resolve
      })
      let getCallCount = 0
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            getCallCount += 1
            return getCallCount === 1 ? firstGetPromise : Promise.resolve(remoteResponse)
          }
          return Promise.reject(new Error('push must not be attempted in this test'))
        },
      )

      // Simulates React StrictMode's deliberate double-effect-invocation in
      // dev: SyncEngineHost's own handleSignedIn call fires twice for the
      // same sign-in. Deliberately not awaited individually.
      const call1 = engine.handleSignedIn('user_b')
      const call2 = engine.handleSignedIn('user_b')

      // Real delay, giving call1's own async chain (readSyncMeta ->
      // clearSyncMeta/clearQueue/clearLastMutatedAt -> resetLocalToBlank's
      // real IndexedDB work -> resolveToken -> apiFetch) plenty of real
      // time to reach its GET and hang there. Before the fix, call2's own
      // readSyncMeta()/resetLocalToBlank()/adoptRemoteWholesale() ran with
      // no lock at all until its own GET, so call2's GET would already
      // have fired within this window too; the fix serializes call2
      // entirely behind call1's lock, so it can't even start running its
      // own body -- let alone dispatch a GET -- until call1's GET resolves.
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(getCallCount).toBe(1)

      resolveFirstGet(remoteResponse)
      await Promise.all([call1, call2])

      // call2, running only after call1 finished, now sees meta already
      // matching 'user_b' -- not a switch -- and takes the ordinary
      // "same user returning" pull path (I11's own idempotence then makes
      // it a noop against the same revision, but it still issues its own
      // real GET first).
      expect(getCallCount).toBe(2)
      const saved = await loadProfile()
      expect(saved.challengerName).toBe('ACCOUNT-B-REMOTE-DATA')
      expect(readSyncMeta()).toEqual({ userId: 'user_b', baseRevision: 9 })
    })
  })

  describe('schema skew (remote ahead)', () => {
    it('exposes a read-only flag instead of merging or pushing', async () => {
      const aheadRemote: ExportedData = { ...longLived, schema_version: CURRENT_SCHEMA_VERSION + 1 }
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 3,
              schemaVersion: aheadRemote.schema_version,
              payload: aheadRemote,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('push must never be attempted on schema skew'))
        },
      )
      const before = await loadProfile()

      const outcome = await engine.pull()

      expect(outcome).toEqual({
        kind: 'schema-skew',
        remoteSchemaVersion: CURRENT_SCHEMA_VERSION + 1,
      })
      expect(engine.getSchemaSkew()).toEqual({ remoteSchemaVersion: CURRENT_SCHEMA_VERSION + 1 })
      expect(await loadProfile()).toEqual(before) // untouched
    })

    // T8b, Finding 2: schemaSkew was recorded by pull() but never gated
    // push() -- a device stuck on an old client version, once schema-skewed,
    // would keep 409ing on the same stale baseRevision forever (every
    // notifyMutation, every online event). These three tests are that gap,
    // closed.
    it('push() never attempts a PUT while schema-skewed -- zero PUTs, before or after the guarding pull', async () => {
      const aheadRemote: ExportedData = { ...longLived, schema_version: CURRENT_SCHEMA_VERSION + 1 }
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 3,
              schemaVersion: aheadRemote.schema_version,
              payload: aheadRemote,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('push must never attempt a PUT while schema-skewed'))
        },
      )

      await engine.pull() // sets schemaSkew
      await engine.push() // must no-op entirely

      const putCalls = apiFetchMock.mock.calls.filter(([, opts]) => methodOf(opts) === 'PUT').length
      expect(putCalls).toBe(0)
    })

    it('notifyMutation() never schedules a push while schema-skewed, even though it still records the mutation clock', async () => {
      const aheadRemote: ExportedData = { ...longLived, schema_version: CURRENT_SCHEMA_VERSION + 1 }
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 3,
              schemaVersion: aheadRemote.schema_version,
              payload: aheadRemote,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('no push must ever fire while schema-skewed'))
        },
      )
      const debounced = createSyncEngine({ getToken }, { debounceMs: 20 })
      await debounced.handleSignedIn('user_a') // reaches schema-skew via the initial pull
      expect(debounced.getSchemaSkew()).not.toBeNull()
      apiFetchMock.mockClear()

      // Review finding: asserting only "zero PUTs happened" doesn't
      // distinguish "notifyMutation() never armed a debounce timer at all"
      // from "it armed one, the timer fired, and push()'s OWN schema-skew
      // guard caught it there instead" -- deleting notifyMutation's guard
      // (engine.ts) would still pass a PUT-count-only assertion. Spying on
      // the real setTimeout (never mocked -- the spy still calls through)
      // and checking specifically for the engine's own debounceMs delay
      // proves the *debounce* timer itself was never scheduled -- jsdom's
      // own localStorage implementation schedules its cross-tab storage
      // *event* dispatch via an unrelated 0ms setTimeout on every write
      // (writeLastMutatedAt's unconditional stamp, just above, triggers
      // one), which a plain "not called at all" assertion would wrongly
      // trip on.
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      debounced.notifyMutation()
      const debounceTimerCalls = setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 20)
      expect(debounceTimerCalls).toHaveLength(0)

      await new Promise((resolve) => setTimeout(resolve, 60)) // longer than the 20ms debounce

      expect(apiFetchMock).not.toHaveBeenCalled()
      expect(localStorage.getItem(LAST_MUTATED_AT_STORAGE_KEY)).not.toBeNull()
      setTimeoutSpy.mockRestore()
    })

    it("a conflict-retry's own re-pull discovering schema-skew stops the loop -- no further PUTs, no requeue", async () => {
      await engine.handleSignedIn('user_a') // clean setup: 404 then a successful push
      apiFetchMock.mockReset()

      const aheadRemote: ExportedData = { ...longLived, schema_version: CURRENT_SCHEMA_VERSION + 1 }
      let putCalls = 0
      apiFetchMock.mockImplementation(
        (_path: string, opts?: ApiRequestOptions): Promise<unknown> => {
          if (methodOf(opts) === 'PUT') {
            putCalls += 1
            return Promise.reject(conflictError())
          }
          if (methodOf(opts) === 'GET') {
            return Promise.resolve({
              revision: 5,
              schemaVersion: aheadRemote.schema_version,
              payload: aheadRemote,
              updatedAt: Date.now(),
            })
          }
          return Promise.reject(new Error('unexpected method'))
        },
      )

      await engine.push()

      // Exactly one PUT (the initial conflict), then the retry-pull itself
      // discovers schema-skew and the loop stops -- never a 2nd/3rd PUT.
      expect(putCalls).toBe(1)
      expect(trackSyncPush).toHaveBeenCalledWith({ outcome: 'schema-skew' })
      expect(readQueueEntry()).toBeNull() // no point requeuing a push that can never succeed
      expect(engine.getSchemaSkew()).toEqual({ remoteSchemaVersion: CURRENT_SCHEMA_VERSION + 1 })
    })
  })

  describe('notifyMutation debounce + flush', () => {
    // Real timers throughout, with a short configured debounce -- vi's fake
    // timers interact badly with fake-indexeddb's own internal scheduling
    // (a hang, not a failure), and a short real delay tests the exact same
    // debounce-then-push behavior without that conflict.
    const DEBOUNCE_MS = 20

    it('does not push immediately -- notifyMutation() debounces', async () => {
      const debounced = createSyncEngine({ getToken }, { debounceMs: DEBOUNCE_MS })
      await debounced.handleSignedIn('user_a')
      apiFetchMock.mockClear()

      debounced.notifyMutation()
      expect(apiFetchMock).not.toHaveBeenCalled()

      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 30))
      expect(apiFetchMock).toHaveBeenCalled()
    })

    it('flush() pushes immediately, without waiting for the debounce timer', async () => {
      const debounced = createSyncEngine({ getToken }, { debounceMs: 60_000 }) // long enough that only flush() could have triggered it
      await debounced.handleSignedIn('user_a')
      apiFetchMock.mockClear()

      debounced.notifyMutation()
      await debounced.flush()

      expect(apiFetchMock).toHaveBeenCalled()
    })
  })

  describe('handleSignedOut', () => {
    it('a subsequent notifyMutation() does nothing once signed out', async () => {
      const debounced = createSyncEngine({ getToken }, { debounceMs: 20 })
      await debounced.handleSignedIn('user_a')
      debounced.handleSignedOut()
      apiFetchMock.mockClear()

      debounced.notifyMutation()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(apiFetchMock).not.toHaveBeenCalled()
    })
  })
})
