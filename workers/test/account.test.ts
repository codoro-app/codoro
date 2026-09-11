import { env } from 'cloudflare:workers'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertUser } from '../src/db'
import type { Env } from '../src/env'
import { applyAllMigrations } from './support/migrations'
import { generateTestKeypair, signTestToken } from './support/jwt'
import type { TestKeypair } from './support/jwt'

// T5's own network boundary (see clerkAdmin.ts's doc comment): mocked so
// this test suite never makes a real call to Clerk's Admin API (F5, same
// rule T3's networkless verifyToken() gets for free but this route's Clerk
// Admin call does not -- it's a genuine HTTPS call in production).
const deleteClerkUserMock = vi.fn<
  (secretKey: string, userId: string) => Promise<{ deleted: boolean }>
>(() => Promise.resolve({ deleted: true }))
vi.mock('../src/clerkAdmin', () => ({
  deleteClerkUser: (secretKey: string, userId: string) => deleteClerkUserMock(secretKey, userId),
}))

// Imported *after* vi.mock -- vi.mock is hoisted above imports by Vitest's
// transform, so this ordering only matters for readability, not correctness.
const { default: app } = await import('../src/index')

const TEST_ORIGIN = 'https://getcodoro.test'

describe('DELETE /api/account (T5)', () => {
  let keypair: TestKeypair

  const testEnv = (): Env => ({
    ...env,
    CLERK_JWT_KEY: keypair.publicKeyPem,
    CLERK_SECRET_KEY: 'test-secret-not-real',
    APP_ORIGIN: TEST_ORIGIN,
  })

  beforeAll(async () => {
    await applyAllMigrations()
    keypair = await generateTestKeypair()
  })

  beforeEach(() => {
    deleteClerkUserMock.mockClear()
  })

  function del(token?: string, ip = '198.51.100.20') {
    return app.request(
      '/api/account',
      {
        method: 'DELETE',
        headers: {
          'CF-Connecting-IP': ip,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      testEnv(),
    )
  }

  it('rejects a request with no token', async () => {
    const res = await del(undefined, '198.51.100.21')
    expect(res.status).toBe(401)
    expect(deleteClerkUserMock).not.toHaveBeenCalled()
  })

  it('rejects a token signed by a different key', async () => {
    const otherKeypair = await generateTestKeypair()
    const token = await signTestToken({ privateKey: otherKeypair.privateKey, sub: 'user_forged' })
    const res = await del(token, '198.51.100.22')
    expect(res.status).toBe(401)
    expect(deleteClerkUserMock).not.toHaveBeenCalled()

    const row = await env.DB.prepare('SELECT * FROM users WHERE clerk_user_id = ?')
      .bind('user_forged')
      .first()
    expect(row).toBeNull()
  })

  it('deletes the D1 user row and calls the Clerk Admin API, then returns 204', async () => {
    const userId = 'user_delete_1'
    await insertUser(env.DB, { clerk_user_id: userId, created_at: Date.now() })

    const token = await signTestToken({
      privateKey: keypair.privateKey,
      sub: userId,
      azp: TEST_ORIGIN,
    })
    const res = await del(token, '198.51.100.23')

    expect(res.status).toBe(204)
    expect(deleteClerkUserMock).toHaveBeenCalledWith('test-secret-not-real', userId)

    // Confirmed server-side, not inferred from the response status (T5's
    // own DoD line: "deletion confirmed server-side, queried, not
    // inferred from a 204") -- re-query D1 directly.
    const row = await env.DB.prepare('SELECT * FROM users WHERE clerk_user_id = ?')
      .bind(userId)
      .first()
    expect(row).toBeNull()
  })

  it('is idempotent: a second delete for an already-deleted account still returns 204', async () => {
    const userId = 'user_delete_2'
    await insertUser(env.DB, { clerk_user_id: userId, created_at: Date.now() })
    const token = await signTestToken({
      privateKey: keypair.privateKey,
      sub: userId,
      azp: TEST_ORIGIN,
    })

    const first = await del(token, '198.51.100.24')
    expect(first.status).toBe(204)

    // Same token is still cryptographically valid (short-lived but not yet
    // expired) -- the account it names is just already gone server-side.
    const second = await del(token, '198.51.100.25')
    expect(second.status).toBe(204)
    expect(deleteClerkUserMock).toHaveBeenCalledTimes(2)
  })

  it("only deletes the caller's own row, never another user's", async () => {
    const victim = 'user_victim'
    const caller = 'user_caller'
    await insertUser(env.DB, { clerk_user_id: victim, created_at: Date.now() })
    await insertUser(env.DB, { clerk_user_id: caller, created_at: Date.now() })

    const token = await signTestToken({
      privateKey: keypair.privateKey,
      sub: caller,
      azp: TEST_ORIGIN,
    })
    const res = await del(token, '198.51.100.26')
    expect(res.status).toBe(204)

    const victimRow = await env.DB.prepare('SELECT * FROM users WHERE clerk_user_id = ?')
      .bind(victim)
      .first()
    expect(victimRow).not.toBeNull()
  })
})
