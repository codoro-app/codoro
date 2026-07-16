import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import type { IDBPDatabase } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { ATTEMPTS_STORE, DB_NAME, getDb } from './db'
import type { Attempt } from './schema'
import { appendAttempt, listAttempts } from './attempts'

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

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    puzzleId: 'p1',
    puzzleRating: 1200,
    mode: 'practice',
    correct: true,
    time_ms: 4200,
    choice_index: 2,
    userRatingBefore: 1180,
    userRatingAfter: 1195,
    localDateString: '2026-07-15',
    createdAt: '2026-07-15T12:00:00.000Z',
    ...overrides,
  }
}

describe('appendAttempt', () => {
  it('round-trips an attempt exactly', async () => {
    const attempt = makeAttempt()
    await appendAttempt(attempt)
    expect(await listAttempts()).toEqual([attempt])
  })

  it('rejects and does not write an invalid attempt', async () => {
    const bad = { ...makeAttempt(), time_ms: 'oops' } as unknown as Attempt
    await expect(appendAttempt(bad)).rejects.toThrow()

    const stored = await withDb((db) => db.getAll(ATTEMPTS_STORE))
    expect(stored).toEqual([])
  })
})

describe('listAttempts', () => {
  it('returns attempts sorted by createdAt ascending regardless of insertion order', async () => {
    const early = makeAttempt({ id: 'a-early', createdAt: '2026-07-01T00:00:00.000Z' })
    const mid = makeAttempt({ id: 'a-mid', createdAt: '2026-07-10T00:00:00.000Z' })
    const late = makeAttempt({ id: 'a-late', createdAt: '2026-07-20T00:00:00.000Z' })

    await appendAttempt(late)
    await appendAttempt(early)
    await appendAttempt(mid)

    const result = await listAttempts()
    expect(result.map((a) => a.id)).toEqual(['a-early', 'a-mid', 'a-late'])
  })

  it('silently drops a manually-inserted invalid row while keeping valid ones', async () => {
    const before = makeAttempt({ id: 'a-before', createdAt: '2026-07-01T00:00:00.000Z' })
    const after = makeAttempt({ id: 'a-after', createdAt: '2026-07-20T00:00:00.000Z' })
    await appendAttempt(before)
    await appendAttempt(after)

    // Bypass appendAttempt's validation to simulate a corrupt row on disk.
    await withDb((db) => db.put(ATTEMPTS_STORE, { id: 'a-garbage', time_ms: 'oops' }))

    const result = await listAttempts()
    expect(result.map((a) => a.id)).toEqual(['a-before', 'a-after'])
  })
})
