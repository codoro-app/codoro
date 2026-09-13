/**
 * T8a: the sync engine's retry queue. Persists across a reload (F28) so a
 * failed push isn't silently lost the moment a tab closes.
 *
 * `localStorage`, not IndexedDB — same tier `src/auth/useSignupPrompt.ts`
 * already uses for its own disposable, non-schema-versioned local state
 * (see this repo's Phase 5.2 plan, T8a amendment, "Decision 2"). This queue
 * carries **no profile data at all** — only a marker that a push is owed
 * (`{ userId, schemaVersion, queuedAt, attempts }`). A push, whenever it
 * actually runs, always rebuilds its payload fresh from IndexedDB via
 * `exportData()` (see `engine.ts`) — never a stale snapshot captured at the
 * moment of the original failure. That's what makes this module's own
 * `schemaVersion` field (F28) a meaningful check rather than a vacuous one:
 * it isn't "does this stale payload match," it's "is the *intent* to push
 * still valid" — a client update between the failure and the drain means
 * the ordinary pull-then-merge cycle should re-establish sync at the new
 * version instead of blindly replaying old intent.
 *
 * One entry, not an array: only one user is ever signed in on a device at a
 * time, and a push always supersedes whatever the previous failed push
 * would have sent (fresh state, not the old snapshot) — so there is never
 * a reason to keep more than one "a push is owed" marker at once.
 *
 * **T8b decision — no `nextRetryAt`, no exponential backoff.** T8a built an
 * exponential-backoff `nextRetryAt` field (10s base, doubling, capped at
 * 5 minutes) that nothing ever reads: `engine.ts`'s `handleOnline` drains
 * unconditionally the moment connectivity returns, by design, and no
 * periodic timer exists to consult a scheduled retry time while the app
 * stays online. Reviewed at T8b time per the plan's own explicit prompt
 * ("wire a periodic drain, or delete both fields") — **deleted**, not
 * wired: a periodic poll (`setInterval` re-checking `nextRetryAt`) is a new
 * standing timer with its own battery/lifecycle cost (pause on
 * `visibilitychange`, resume on foreground, one more thing guest-first's
 * "signed-out behavior unchanged" has to prove doesn't fire signed-out) for
 * a narrow case this app doesn't need to solve today: a push failing while
 * genuinely *online* (a transient 5xx) is rare, and already self-heals on
 * the next real mutation's debounced push, the next `online` event, or the
 * next app boot's pull — none of which need `nextRetryAt` to work. Building
 * unused scheduling machinery "for later" is exactly the kind of
 * built-ahead-of-its-consumer code T8a's own S3 finding named as a smell;
 * this decision resolves that finding by removing the smell instead of
 * finally growing a consumer for it. `attempts` is kept — it's genuinely
 * read (by this module's own "same user, increment" vs. "different user,
 * reset" branch below, and asserted directly in tests as a same-entry
 * sanity check) even without a backoff calculation riding on top of it.
 */

export interface QueueEntry {
  userId: string
  schemaVersion: number
  queuedAt: number
  attempts: number
}

export const QUEUE_STORAGE_KEY = 'codoro:sync-queue'

function isQueueEntry(value: unknown): value is QueueEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as QueueEntry).userId === 'string' &&
    typeof (value as QueueEntry).schemaVersion === 'number' &&
    typeof (value as QueueEntry).queuedAt === 'number' &&
    typeof (value as QueueEntry).attempts === 'number'
  )
}

/** Never throws: a missing key, corrupt JSON, or wrong-shaped value all read as "nothing queued." */
export function readQueueEntry(): QueueEntry | null {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isQueueEntry(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeQueueEntry(entry: QueueEntry): void {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // Safari private browsing (and similar) can throw on localStorage
    // access -- worst case a failed push simply isn't retried until the
    // next natural mutation/online event, the same silent-degrade posture
    // I2 requires everywhere else in this module.
  }
}

/** Removes the queued entry, if any. A no-op (never throws) when nothing was queued. */
export function clearQueue(): void {
  try {
    localStorage.removeItem(QUEUE_STORAGE_KEY)
  } catch {
    // See writeQueueEntry's comment above.
  }
}

/**
 * Records one failed push attempt and returns the updated entry.
 *
 * A failure for a *different* user than whatever was already queued starts
 * a fresh entry (attempts=1) rather than incrementing the existing
 * counter — this shouldn't normally happen (engine.ts's `handleSignedIn`
 * already clears the queue on an account switch, F31), but a failure
 * that somehow arrives for a different user must never have its `attempts`
 * count silently inherit an unrelated account's failure history.
 */
export function recordQueueFailure(userId: string, schemaVersion: number, now: number): QueueEntry {
  const existing = readQueueEntry()
  const attempts = existing?.userId === userId ? existing.attempts + 1 : 1
  const entry: QueueEntry = { userId, schemaVersion, queuedAt: now, attempts }
  writeQueueEntry(entry)
  return entry
}

/** F28: has the app's own schema moved on since this entry was queued? */
export function isQueueEntryStale(entry: QueueEntry, currentSchemaVersion: number): boolean {
  return entry.schemaVersion !== currentSchemaVersion
}
