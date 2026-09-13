/**
 * T8a (v5 Phase 5.2): the client sync orchestration engine. Wires T6's pure
 * `merge()` and T7's `/api/profile` endpoints together into pull-on-boot,
 * debounced-push-after-mutation, and a persisted retry queue (`./queue.ts`).
 *
 * Full design decisions (why `localStorage` for sync metadata, why a
 * conflict re-pulls instead of reading the 409 body, why the retry cap is 3,
 * why 413 never queues, F31's account-switch handling) are written out in
 * docs/superpowers/plans/2026-09-12-v5-phase-5.2-sync-implementation-plan.md's
 * T8a amendment — this file's own comments summarize each decision at its
 * point of use, not the reasoning behind it.
 *
 * This module never constructs a `fetch()` itself and never re-derives
 * `src/auth/api.ts`'s `ApiError` taxonomy — every network call goes through
 * `apiFetch()`, and every failure branches on the `ApiError` it already
 * throws. It never implements merge rules — every merge decision goes
 * through `./merge.ts`'s `merge()`.
 *
 * Every public entry point (`pull`, `push`, and therefore `handleSignedIn`,
 * the debounced call `notifyMutation` schedules, `flush`, `handleOnline`)
 * runs inside one `async` mutex (`withLock`) so a pull and a push requested
 * in the same tick serialize instead of interleaving against a
 * half-written `UserProfile` (I12). The only exception is the internal,
 * unlocked `doPull`/`doPushOnce` pair, which `push()`'s own conflict-retry
 * loop calls directly while already holding the lock -- calling the public,
 * locked `pull()` there would deadlock against a non-reentrant mutex.
 */
import { ApiError, apiFetch } from '../auth/api'
import type {
  ProfileGetResponse,
  ProfilePutRequest,
  ProfilePutResponse,
} from '../../workers/shared/api-types'
import { CURRENT_SCHEMA_VERSION, appendAttempt, exportData, saveProfile } from '../storage'
import type { ExportedData } from '../storage'
import { trackSyncConflict, trackSyncPull, trackSyncPush } from '../telemetry'
import { clearQueue, isQueueEntryStale, readQueueEntry, recordQueueFailure } from './queue'
import { merge } from './merge'
import type { MergeOutcome } from './merge'

const DEFAULT_DEBOUNCE_MS = 5_000
/**
 * Decision 3 (T8a amendment): at most 3 total push attempts per `push()`
 * call -- i.e. at most 2 conflict-triggered merge-and-retry cycles, within
 * the plan's stated "2-3" range. On exhaustion, `push()` requeues via the
 * ordinary retry-queue path instead of looping further.
 */
const MAX_PUSH_ATTEMPTS = 3

export interface SyncEngineDeps {
  getToken: () => Promise<string | null>
}

export interface SyncEngineOptions {
  debounceMs?: number
}

export type PullOutcome =
  | { kind: 'merged' }
  | { kind: 'noop' }
  | { kind: 'not-found' }
  | { kind: 'schema-skew'; remoteSchemaVersion: number }
  | { kind: 'error' }

export interface SyncEngine {
  /** Sign-in lifecycle hook (F31): compares stored sync identity to `userId`, pulls, and (on a fresh account) pushes as the seed revision. */
  handleSignedIn: (userId: string) => Promise<void>
  /** Sign-out lifecycle hook: stops the debounce timer and clears in-memory (not persisted) state. Does NOT wipe sync metadata/queue -- the same user returning later should not look like a switch. */
  handleSignedOut: () => void
  /** Call from the `onProfileSaved` subscriber (see `src/storage/profile.ts`). Debounces a push ~5s. No-ops while signed out. */
  notifyMutation: () => void
  /** Cancels any pending debounce timer and pushes immediately. Call on `visibilitychange` -> hidden. */
  flush: () => Promise<void>
  /** Call on the `online` event: drains a persisted retry-queue entry, if one exists and isn't schema-stale (F28). */
  handleOnline: () => Promise<void>
  /** Direct pull, for callers (and tests) that want it without going through a lifecycle hook. */
  pull: () => Promise<PullOutcome>
  /** Direct push, same note as `pull`. */
  push: () => Promise<void>
  /** T6's `remote-ahead` branch, surfaced for a future "reload to update" banner (T8b/UI work) -- this task only makes the state observable. */
  getSchemaSkew: () => { remoteSchemaVersion: number } | null
}

// ---------------------------------------------------------------------------
// Sync metadata: where baseRevision lives across reloads (Decision 1).
// `localStorage`, not app data -- see this file's own top comment and the
// T8a amendment for the reasoning. Exported (read-only) for tests; the
// write/clear helpers stay module-private, reached only through the engine.
// ---------------------------------------------------------------------------

export const SYNC_META_STORAGE_KEY = 'codoro:sync-meta'

/**
 * Review finding B2, fixed here: `merge()`'s "latest wins" rules compare
 * `local.exportedAt` vs `remote.exportedAt` (see merge.ts's own doc
 * comment) -- but `exportData()`'s `exportedAt` is stamped with
 * `new Date().toISOString()` at the moment it's *called*, not at the
 * moment content last actually changed. Building `local` fresh via
 * `exportData()` on every pull/push (as this engine must, per Decision 2 --
 * the queue never carries a stale payload snapshot) means `local.exportedAt`
 * is always "now," which is always `>=` a remote's necessarily-earlier
 * push timestamp. Every latest-wins field (preferences, challengerName,
 * requeueState, storagePersisted, missionProgress, dailyCompletion's
 * same-date tiebreak) would silently never let remote win, in either
 * direction, ever.
 *
 * Fix: track this device's own last-real-mutation timestamp separately,
 * persisted so it survives a reload, and substitute it for `exportData()`'s
 * own stamp when building the object handed to `merge()`. `notifyMutation()`
 * records "now" here every time it's called (a real local write just
 * happened); a successful merge also re-stamps it to whichever side's
 * `exportedAt` actually won, so later comparisons stay anchored to a real
 * event instead of drifting back to "whenever sync last ran."
 *
 * **Residual gap, named rather than silently assumed fixed:** this fully
 * closes the bug only once something calls `notifyMutation()` at the real
 * mutation boundary -- which is `onProfileSaved`'s subscriber, explicit
 * app-level wiring this session does not build (see this file's own top
 * comment and the T8a amendment's "not built this session" note). Until
 * that wiring exists, this device's *very first* pull/push (before any
 * merge has ever recorded a real timestamp) still falls back to "now" --
 * `engine.test.ts`'s "last-mutation clock" tests exercise the mechanism
 * directly (calling `notifyMutation()` the same way the eventual wiring
 * will) to prove it works once wired, not to claim the gap is closed today.
 */
export const LAST_MUTATED_AT_STORAGE_KEY = 'codoro:sync-last-mutated-at'

function readLastMutatedAt(): string | null {
  try {
    return localStorage.getItem(LAST_MUTATED_AT_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeLastMutatedAt(iso: string): void {
  try {
    localStorage.setItem(LAST_MUTATED_AT_STORAGE_KEY, iso)
  } catch {
    // Degrade silently, same posture as every other localStorage write in
    // this module -- worst case this pull/push falls back to "now," same
    // as before this fix existed.
  }
}

export interface SyncMeta {
  /** `null` before any account has ever synced from this engine instance's own perspective (not yet observed via handleSignedIn). */
  userId: string | null
  baseRevision: number
}

function isSyncMeta(value: unknown): value is SyncMeta {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<SyncMeta>
  const userIdOk = candidate.userId === null || typeof candidate.userId === 'string'
  return userIdOk && typeof candidate.baseRevision === 'number'
}

/** Never throws: a missing key, corrupt JSON, or wrong shape all read as "no metadata yet." */
export function readSyncMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(SYNC_META_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSyncMeta(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeSyncMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(meta))
  } catch {
    // Same degrade-silently posture as queue.ts -- worst case the next
    // pull/push re-derives the right baseRevision from a 409/fresh 404.
  }
}

function clearSyncMeta(): void {
  try {
    localStorage.removeItem(SYNC_META_STORAGE_KEY)
  } catch {
    // See writeSyncMeta's comment above.
  }
}

/**
 * A GET's `payload` is `unknown` on the wire (S2 -- the server never
 * interprets it) but is, in practice, exactly whatever `ExportedData` this
 * device (or another device on the same account) last pushed. A light
 * structural check catches a wildly malformed value before it ever reaches
 * `merge()`; anything that slips past this and still can't validate as a
 * `UserProfile` fails loudly inside `saveProfile()` later, which this
 * module's own try/catch already treats as an ordinary pull failure (I2).
 */
function coerceExportedData(payload: unknown): ExportedData | null {
  if (typeof payload !== 'object' || payload === null) return null
  const candidate = payload as Record<string, unknown>
  if (
    typeof candidate.schema_version !== 'number' ||
    typeof candidate.exportedAt !== 'string' ||
    typeof candidate.profile !== 'object' ||
    candidate.profile === null ||
    !Array.isArray(candidate.attempts)
  ) {
    return null
  }
  return candidate as unknown as ExportedData
}

type PushAttemptResult =
  | { kind: 'ok'; revision: number }
  | { kind: 'conflict' }
  | { kind: 'too-large' }
  | { kind: 'error' }

export function createSyncEngine(
  deps: SyncEngineDeps,
  options: SyncEngineOptions = {},
): SyncEngine {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS

  let currentUserId: string | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let schemaSkew: { remoteSchemaVersion: number } | null = null

  // I12: a single async mutex every public pull/push chains onto. `lock`
  // always resolves (never rejects) so a failed operation never poisons
  // the chain for whatever runs next.
  let lock: Promise<unknown> = Promise.resolve()
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = lock.then(fn, fn)
    lock = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function resolveToken(): Promise<string | null> {
    try {
      return await deps.getToken()
    } catch {
      return null
    }
  }

  /**
   * Builds the local `ExportedData` merge()/PUT candidates are built from,
   * with `exportedAt` corrected to this device's real last-mutation clock
   * (B2's fix -- see `LAST_MUTATED_AT_STORAGE_KEY`'s own doc comment).
   * Falls back to `exportData()`'s own "now" stamp only when no mutation
   * has ever been recorded yet (a genuinely fresh device/session).
   */
  async function buildLocalExportedData(): Promise<ExportedData> {
    const raw = JSON.parse(await exportData()) as ExportedData
    const lastMutatedAt = readLastMutatedAt()
    return lastMutatedAt ? { ...raw, exportedAt: lastMutatedAt } : raw
  }

  /** Unlocked -- callers already hold the lock (the public `pull()`) or are themselves inside one (`push()`'s conflict-retry). */
  async function doPull(userId: string | null): Promise<PullOutcome> {
    const token = await resolveToken()
    if (!token) {
      trackSyncPull({ outcome: 'no-token' })
      return { kind: 'error' }
    }

    let response: ProfileGetResponse
    try {
      response = await apiFetch<ProfileGetResponse>('/api/profile', { method: 'GET', token })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        trackSyncPull({ outcome: 'not-found' })
        return { kind: 'not-found' }
      }
      trackSyncPull({ outcome: 'error' })
      return { kind: 'error' }
    }

    // I11: applying the same pulled revision twice is a no-op. Checked
    // before any merge/save work runs, not just left to merge()'s own
    // mathematical idempotence to make redundant work harmless.
    const existingMeta = readSyncMeta()
    if (existingMeta?.userId === userId && existingMeta.baseRevision === response.revision) {
      trackSyncPull({ outcome: 'noop' })
      return { kind: 'noop' }
    }

    const remote = coerceExportedData(response.payload)
    if (!remote) {
      trackSyncPull({ outcome: 'error' })
      return { kind: 'error' }
    }

    let local: ExportedData
    try {
      local = await buildLocalExportedData()
    } catch {
      trackSyncPull({ outcome: 'error' })
      return { kind: 'error' }
    }

    // Review finding B1: merge.ts's own doc comment says a genuinely
    // malformed migration result "throws... T8 catches it like any other
    // pull failure per I2" -- this try/catch is that promise kept. Without
    // it, a non-migratable behind-schema blob rejects doPull(), and the
    // conflict-retry path (which calls doPull while already inside push()'s
    // lock) turns that into an unhandled rejection on `void push()`.
    let outcome: MergeOutcome
    try {
      outcome = merge(local, remote)
    } catch {
      trackSyncPull({ outcome: 'error' })
      return { kind: 'error' }
    }
    if (outcome.kind === 'remote-ahead') {
      schemaSkew = { remoteSchemaVersion: outcome.remoteSchemaVersion }
      trackSyncPull({ outcome: 'schema-skew' })
      return { kind: 'schema-skew', remoteSchemaVersion: outcome.remoteSchemaVersion }
    }
    schemaSkew = null

    try {
      // `merge()`'s attempts result is already the full union (never drops
      // a row) -- upserting each by id lands it locally without a new
      // storage primitive. saveProfile() runs last, so I12's own DoD
      // language ("saveProfile is called with a fully-merged, never a
      // partial, state") holds literally, not just in spirit.
      for (const attempt of outcome.data.attempts) {
        await appendAttempt(attempt)
      }
      await saveProfile(outcome.data.profile)
    } catch {
      trackSyncPull({ outcome: 'error' })
      return { kind: 'error' }
    }

    writeSyncMeta({ userId, baseRevision: response.revision })
    // B2's fix, other half: anchor this device's mutation clock to
    // whichever side's timestamp actually won the merge, so the *next*
    // comparison starts from a real event instead of drifting back to
    // "whenever this pull happened."
    writeLastMutatedAt(outcome.data.exportedAt)
    trackSyncPull({ outcome: 'merged' })
    return { kind: 'merged' }
  }

  /** Unlocked -- one PUT attempt, no retry logic of its own. `push()` owns the retry/conflict loop. */
  async function doPushOnce(userId: string | null): Promise<PushAttemptResult> {
    const token = await resolveToken()
    if (!token) return { kind: 'error' }

    let local: ExportedData
    try {
      local = await buildLocalExportedData()
    } catch {
      return { kind: 'error' }
    }

    const meta = readSyncMeta()
    const baseRevision = meta?.userId === userId ? meta.baseRevision : 0

    const body: ProfilePutRequest = {
      schemaVersion: local.schema_version,
      payload: local,
      baseRevision,
      anonId: local.profile.anonId,
    }

    try {
      const response = await apiFetch<ProfilePutResponse>('/api/profile', {
        method: 'PUT',
        token,
        body,
      })
      return { kind: 'ok', revision: response.revision }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return { kind: 'conflict' }
      if (err instanceof ApiError && err.status === 413) return { kind: 'too-large' }
      return { kind: 'error' }
    }
  }

  function enqueueRetry(userId: string | null): void {
    if (userId === null) return // nothing real to attribute a retry to
    recordQueueFailure(userId, CURRENT_SCHEMA_VERSION, Date.now())
  }

  async function pull(): Promise<PullOutcome> {
    return withLock(() => doPull(currentUserId))
  }

  async function push(): Promise<void> {
    return withLock(async () => {
      const userId = currentUserId
      for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
        const result = await doPushOnce(userId)

        if (result.kind === 'ok') {
          writeSyncMeta({ userId, baseRevision: result.revision })
          clearQueue()
          trackSyncPush({ outcome: attempt > 1 ? 'conflict-resolved' : 'success' })
          return
        }

        if (result.kind === 'too-large') {
          // Decision 4: terminal, never retried, never queued -- and (review
          // finding S4) also clears any *pre-existing* queued retry from an
          // earlier, unrelated network failure. Without this, a device that
          // reconnects (handleOnline drains unconditionally) would repeat
          // the same guaranteed-413 round trip forever: too-large never
          // shrinks on its own, so leaving a stale entry in place would spin
          // uselessly on every future `online` event.
          clearQueue()
          trackSyncPush({ outcome: 'too-large' })
          return
        }

        if (result.kind === 'conflict') {
          trackSyncConflict()
          if (attempt === MAX_PUSH_ATTEMPTS) break // the cap: no more retries
          await doPull(userId) // Decision 3: re-pull + merge instead of reading the 409 body
          continue
        }

        // network/timeout/5xx/no-token -- degrade silently (I2).
        enqueueRetry(userId)
        trackSyncPush({ outcome: 'network-error' })
        return
      }

      enqueueRetry(userId)
      trackSyncPush({ outcome: 'conflict-exhausted' })
    })
  }

  async function handleSignedIn(userId: string): Promise<void> {
    // F31: a stored identity that doesn't match the incoming one means this
    // device's sync state belongs to a different account -- discard it and
    // pull before any push is allowed to run for the new identity.
    const existingMeta = readSyncMeta()
    if (existingMeta !== null && existingMeta.userId !== userId) {
      clearSyncMeta()
      clearQueue()
    }

    currentUserId = userId
    schemaSkew = null

    const outcome = await pull()
    if (outcome.kind === 'not-found') {
      // First-sign-in migration: local profile + server 404 -> push as
      // revision 1, anonId linked on that same push (doPushOnce always
      // sends it).
      await push()
    }
  }

  function handleSignedOut(): void {
    currentUserId = null
    schemaSkew = null
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function notifyMutation(): void {
    // B2's fix: record this device's mutation clock unconditionally, even
    // while signed out -- a guest who plays for a while and signs in later
    // needs their local changes to compare correctly against whatever the
    // server holds, not "whenever they happened to sign in."
    writeLastMutatedAt(new Date().toISOString())
    if (currentUserId === null) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void push()
    }, debounceMs)
  }

  async function flush(): Promise<void> {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (currentUserId === null) return
    await push()
  }

  async function handleOnline(): Promise<void> {
    if (currentUserId === null) return
    const entry = readQueueEntry()
    if (entry?.userId !== currentUserId) return
    if (isQueueEntryStale(entry, CURRENT_SCHEMA_VERSION)) {
      // F28: the app itself moved schema versions since this entry was
      // queued -- drop the stale intent rather than replay it; the ordinary
      // pull-then-merge cycle re-establishes sync at the new version.
      clearQueue()
      trackSyncPush({ outcome: 'stale-schema-dropped' })
      return
    }
    await push()
  }

  function getSchemaSkew(): { remoteSchemaVersion: number } | null {
    return schemaSkew
  }

  return {
    handleSignedIn,
    handleSignedOut,
    notifyMutation,
    flush,
    handleOnline,
    pull,
    push,
    getSchemaSkew,
  }
}
