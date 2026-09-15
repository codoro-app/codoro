// workers/test/authz.test.ts
//
// T13: one consolidated, registry-checked authz matrix, so a new
// clerkAuth()-gated route added to src/index.ts without a corresponding
// entry here fails loudly instead of silently shipping unchecked. This is
// additive to (not a replacement for) account.test.ts/profile.test.ts's
// own per-route coverage -- those stay as the detailed behavioral tests;
// this file's job is the registry guarantee plus the {no token, bad
// token, valid-token-vs-another-user} matrix in one place.
import { env } from 'cloudflare:workers'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertUser } from '../src/db'
import type { Env } from '../src/env'
import { applyAllMigrations } from './support/migrations'
import { generateTestKeypair, signTestToken } from './support/jwt'
import type { TestKeypair } from './support/jwt'

const deleteClerkUserMock = vi.fn<
  (secretKey: string, userId: string) => Promise<{ deleted: boolean }>
>(() => Promise.resolve({ deleted: true }))
vi.mock('../src/clerkAdmin', () => ({
  deleteClerkUser: (secretKey: string, userId: string) => deleteClerkUserMock(secretKey, userId),
}))

const { default: app } = await import('../src/index')

const TEST_ORIGIN = 'https://getcodoro.test'
// GET /api/health and POST /api/report are the two routes this Worker
// deliberately leaves unauthenticated (health check must work even if
// token verification itself is broken; report is the one anonymous write
// in the system, by design -- see index.ts's own comments on each).
const KNOWN_UNAUTHENTICATED_ROUTES = new Set(['GET /api/health', 'POST /api/report'])

/**
 * Every route this table exercises for the three-case matrix below. Add a
 * new entry here whenever a new clerkAuth()-gated route is added to
 * src/index.ts -- the registry check in the first `it()` below fails if
 * you forget.
 */
interface AuthedRouteCase {
  method: string
  path: string
  /** Exercise this route as `owner` first (seed), then as `caller` (a different, valid, authenticated user) against the SAME resource path, and assert caller's call never observes or mutates owner's data. */
  crossUserCheck: (opts: {
    owner: string
    caller: string
    tokenFor: (sub: string) => Promise<string>
    ip: string
  }) => Promise<void>
}

// Set once in beforeAll, read by the module-scope `request()` helper below
// -- kept as a mutable module-scope binding (rather than threading testEnv
// through every call site) because every case in this file shares the same
// keypair/env for its whole run.
let testEnvGlobal: () => Env

function request(
  method: string,
  path: string,
  token: string | undefined,
  ip: string,
  body?: unknown,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        'CF-Connecting-IP': ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    testEnvGlobal(),
  )
}

describe('authz matrix: every authenticated route (T13)', () => {
  let keypair: TestKeypair

  const testEnv = (): Env => ({
    ...env,
    CLERK_JWT_KEY: keypair.publicKeyPem,
    CLERK_SECRET_KEY: 'test-secret-not-real',
    APP_ORIGINS: TEST_ORIGIN,
  })

  async function tokenFor(sub: string): Promise<string> {
    return signTestToken({ privateKey: keypair.privateKey, sub, azp: TEST_ORIGIN })
  }

  const AUTHED_ROUTES: AuthedRouteCase[] = [
    {
      method: 'DELETE',
      path: '/api/account',
      crossUserCheck: async ({ owner, caller, tokenFor: tf, ip }) => {
        await insertUser(env.DB, { clerk_user_id: owner, created_at: Date.now() })
        await insertUser(env.DB, { clerk_user_id: caller, created_at: Date.now() })
        const res = await request('DELETE', '/api/account', await tf(caller), ip)
        expect(res.status).toBe(204)
        const ownerRow = await env.DB.prepare('SELECT * FROM users WHERE clerk_user_id = ?')
          .bind(owner)
          .first()
        expect(ownerRow).not.toBeNull()
      },
    },
    {
      method: 'PUT',
      path: '/api/profile',
      crossUserCheck: async ({ owner, caller, tokenFor: tf, ip }) => {
        await request('PUT', '/api/profile', await tf(owner), ip, {
          schemaVersion: 1,
          payload: { owner: 'owner-data' },
          baseRevision: 0,
        })
        const res = await request('PUT', '/api/profile', await tf(caller), ip, {
          schemaVersion: 1,
          payload: { owner: 'caller-data' },
          baseRevision: 0,
        })
        expect(res.status).toBe(201)
        const ownerGet = await request('GET', '/api/profile', await tf(owner), ip)
        const ownerBody = await ownerGet.json()
        expect(ownerBody.payload).toEqual({ owner: 'owner-data' })
      },
    },
    {
      method: 'GET',
      path: '/api/profile',
      crossUserCheck: async ({ owner, caller, tokenFor: tf, ip }) => {
        await request('PUT', '/api/profile', await tf(owner), ip, {
          schemaVersion: 1,
          payload: { owner: 'owner-data' },
          baseRevision: 0,
        })
        const res = await request('GET', '/api/profile', await tf(caller), ip)
        expect(res.status).toBe(404)
      },
    },
  ]

  beforeAll(async () => {
    await applyAllMigrations()
    keypair = await generateTestKeypair()
    testEnvGlobal = testEnv
  })

  beforeEach(() => {
    deleteClerkUserMock.mockClear()
    testEnvGlobal = testEnv
  })

  it('the table above covers every clerkAuth()-gated route the app actually exposes', () => {
    const registered = new Set(
      app.routes
        .map((r) => `${r.method} ${r.path}`)
        .filter(
          (key) =>
            key.startsWith('GET /api/') ||
            key.startsWith('PUT /api/') ||
            key.startsWith('DELETE /api/') ||
            key.startsWith('POST /api/'),
        )
        .filter((key) => !KNOWN_UNAUTHENTICATED_ROUTES.has(key)),
    )
    const covered = new Set(AUTHED_ROUTES.map((r) => `${r.method} ${r.path}`))
    for (const key of registered) {
      expect(covered.has(key)).toBe(true)
    }
    // And the reverse -- nothing in the table should be stale either.
    expect(covered.size).toBe(registered.size)
  })

  for (const route of AUTHED_ROUTES) {
    describe(`${route.method} ${route.path}`, () => {
      let ipCounter = 0
      function nextIp(): string {
        ipCounter += 1
        return `203.0.114.${String(ipCounter)}`
      }

      it('rejects a request with no token', async () => {
        const res = await request(route.method, route.path, undefined, nextIp())
        expect(res.status).toBe(401)
      })

      it('rejects a token signed by a different key', async () => {
        const forged = await generateTestKeypair()
        const badToken = await signTestToken({
          privateKey: forged.privateKey,
          sub: 'user_forged',
          azp: TEST_ORIGIN,
        })
        const res = await request(route.method, route.path, badToken, nextIp())
        expect(res.status).toBe(401)
      })

      it("a valid token never reaches or mutates another user's resource", async () => {
        const suffix = `${route.method.toLowerCase()}_${route.path.replace(/\W+/g, '_')}`
        await route.crossUserCheck({
          owner: `authz_owner_${suffix}`,
          caller: `authz_caller_${suffix}`,
          tokenFor,
          ip: nextIp(),
        })
      })
    })
  }
})
