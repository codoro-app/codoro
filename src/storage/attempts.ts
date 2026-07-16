/**
 * Attempts store: append-only log of puzzle attempts.
 *
 * appendAttempt throws loudly on invalid input (programmer error, must never be
 * silently persisted) — mirrors saveProfile's contract in profile.ts.
 */
import { ATTEMPTS_STORE, getDb } from './db'
import { AttemptSchema } from './schema'
import type { Attempt } from './schema'

export async function appendAttempt(attempt: Attempt): Promise<void> {
  const validated = AttemptSchema.parse(attempt)
  const db = await getDb()
  try {
    await db.put(ATTEMPTS_STORE, validated)
  } finally {
    // Open-use-close: getDb never caches, so each operation owns and releases
    // its own connection. Leaving connections open would block deleteDB (the
    // test-reset seam) and needlessly hold a handle in production.
    db.close()
  }
}

export async function listAttempts(): Promise<Attempt[]> {
  const db = await getDb()
  try {
    const raw: unknown[] = await db.getAll(ATTEMPTS_STORE)

    // A single corrupt attempt row shouldn't take down the whole attempts
    // list — catastrophic corruption is handled at the profile level (see
    // profile.ts's backup-and-reset recovery). Here we just drop bad rows.
    const attempts = raw
      .map((row) => AttemptSchema.safeParse(row))
      .filter((result) => result.success)
      .map((result) => result.data)

    attempts.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    return attempts
  } finally {
    db.close()
  }
}
