import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { insertUser } from '../src/db'
import { profileStore } from '../src/profileStore'
import { applyAllMigrations } from './support/migrations'

// D1 storage in this suite is shared across `it()` blocks within a file
// (verified empirically -- not per-test-isolated), so migrations are
// applied once in beforeAll and every test uses its own uniquely-named
// user, the same convention migrations.test.ts and scoresBest.test.ts
// already use.
describe('profileStore', () => {
  beforeAll(async () => {
    await applyAllMigrations()
  })

  it('round-trips arbitrary JSON through gzip compression, unchanged', async () => {
    await insertUser(env.DB, { clerk_user_id: 'ps_user_1', created_at: Date.now() })
    const json = { attempts: [{ id: 'a1', ok: true }], rating: 1234, nested: { deep: [1, 2, 3] } }
    await profileStore.put(env.DB, 'ps_user_1', json, {
      schemaVersion: 9,
      revision: 1,
      updatedAt: Date.now(),
    })

    const result = await profileStore.get(env.DB, 'ps_user_1')
    expect(result?.json).toEqual(json)
    expect(result?.schemaVersion).toBe(9)
    expect(result?.revision).toBe(1)
  })

  it('stores the payload compressed -- payload_bytes is smaller than the raw JSON for a compressible payload', async () => {
    await insertUser(env.DB, { clerk_user_id: 'ps_user_2', created_at: Date.now() })
    const json = { text: 'a'.repeat(10_000) }
    await profileStore.put(env.DB, 'ps_user_2', json, {
      schemaVersion: 9,
      revision: 1,
      updatedAt: Date.now(),
    })

    const raw = await env.DB.prepare('SELECT payload_bytes FROM profiles WHERE clerk_user_id = ?')
      .bind('ps_user_2')
      .first<{ payload_bytes: number }>()
    expect(raw?.payload_bytes).toBeLessThan(JSON.stringify(json).length)
  })

  it('returns null for a user with no profile row', async () => {
    await insertUser(env.DB, { clerk_user_id: 'ps_user_3', created_at: Date.now() })
    expect(await profileStore.get(env.DB, 'ps_user_3')).toBeNull()
  })

  it('put is an upsert -- a second put for the same user replaces the first', async () => {
    await insertUser(env.DB, { clerk_user_id: 'ps_user_4', created_at: Date.now() })
    await profileStore.put(
      env.DB,
      'ps_user_4',
      { v: 1 },
      { schemaVersion: 1, revision: 1, updatedAt: 1 },
    )
    await profileStore.put(
      env.DB,
      'ps_user_4',
      { v: 2 },
      { schemaVersion: 1, revision: 2, updatedAt: 2 },
    )

    const result = await profileStore.get(env.DB, 'ps_user_4')
    expect(result?.json).toEqual({ v: 2 })
    expect(result?.revision).toBe(2)
  })

  it('delete removes the row -- get then returns null', async () => {
    await insertUser(env.DB, { clerk_user_id: 'ps_user_5', created_at: Date.now() })
    await profileStore.put(
      env.DB,
      'ps_user_5',
      { v: 1 },
      { schemaVersion: 1, revision: 1, updatedAt: 1 },
    )
    await profileStore.delete(env.DB, 'ps_user_5')
    expect(await profileStore.get(env.DB, 'ps_user_5')).toBeNull()
  })

  it('is also removed via the users cascade (S2 does not bypass the FK)', async () => {
    await insertUser(env.DB, { clerk_user_id: 'ps_user_6', created_at: Date.now() })
    await profileStore.put(
      env.DB,
      'ps_user_6',
      { v: 1 },
      { schemaVersion: 1, revision: 1, updatedAt: 1 },
    )
    await env.DB.prepare('DELETE FROM users WHERE clerk_user_id = ?').bind('ps_user_6').run()
    expect(await profileStore.get(env.DB, 'ps_user_6')).toBeNull()
  })
})
