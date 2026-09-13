import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'
import { clerkAuth, requireOwnership } from '../src/auth'
import type { AuthVariables } from '../src/auth'
import type { Env } from '../src/env'
import { generateTestKeypair, signTestToken } from './support/jwt'
import type { TestKeypair } from './support/jwt'

const TEST_ORIGIN = 'https://getcodoro.test'
// T7b/F29: a second allow-listed origin, distinct from TEST_ORIGIN, so the
// "matches the second entry of a multi-entry list" test can't pass by
// accident against a single-entry list.
const SECOND_ORIGIN = 'https://second.getcodoro.test'

// A throwaway app, local to this test file — no real route in src/index.ts
// mounts clerkAuth() yet (the first real authenticated endpoint is T7),
// so this exercises the middleware and the I5 authorization helper in
// isolation, the same way health.test.ts exercises the real app.
const testApp = new Hono<{ Bindings: Env; Variables: AuthVariables }>()
testApp.get('/protected', clerkAuth(), (c) => c.json({ userId: c.get('userId') }))
testApp.get('/owned/:ownerId', clerkAuth(), (c) => {
  const denied = requireOwnership(c, c.req.param('ownerId'))
  if (denied) return denied
  return c.json({ ok: true })
})

describe('clerkAuth', () => {
  let keypair: TestKeypair
  let otherKeypair: TestKeypair

  // env passed as app.request()'s third arg overrides the real Worker
  // bindings (same pattern health.test.ts already uses) -- CLERK_JWT_KEY
  // here is the test keypair's own public key, not a real Clerk secret.
  const testEnv = (overrides: Partial<Env> = {}): Env => ({
    ...env,
    CLERK_JWT_KEY: keypair.publicKeyPem,
    APP_ORIGINS: TEST_ORIGIN,
    ...overrides,
  })

  beforeAll(async () => {
    keypair = await generateTestKeypair()
    otherKeypair = await generateTestKeypair()
  })

  it('rejects a request with no Authorization header', async () => {
    const res = await testApp.request('/protected', {}, testEnv())
    expect(res.status).toBe(401)
  })

  it('rejects a malformed Authorization header (not "Bearer <token>")', async () => {
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: 'Basic dXNlcjpwYXNz' } },
      testEnv(),
    )
    expect(res.status).toBe(401)
  })

  it('rejects an empty bearer token', async () => {
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: 'Bearer ' } },
      testEnv(),
    )
    expect(res.status).toBe(401)
  })

  it('rejects a syntactically malformed bearer token (not a real JWT at all)', async () => {
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: 'Bearer not-a-real-jwt' } },
      testEnv(),
    )
    expect(res.status).toBe(401)
  })

  it('accepts a valid token and attaches the sub claim as userId', async () => {
    const token = await signTestToken({
      privateKey: keypair.privateKey,
      sub: 'user_abc',
      azp: TEST_ORIGIN,
    })
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv(),
    )
    expect(res.status).toBe(200)
    const body = await res.json<{ userId: string }>()
    expect(body.userId).toBe('user_abc')
  })

  it('rejects a token signed by a different key (forged signature)', async () => {
    const token = await signTestToken({ privateKey: otherKeypair.privateKey, azp: TEST_ORIGIN })
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv(),
    )
    expect(res.status).toBe(401)
  })

  it('rejects an expired token', async () => {
    // iat = now - 120s, exp = iat + 60s = now - 60s -- already expired.
    const token = await signTestToken({
      privateKey: keypair.privateKey,
      azp: TEST_ORIGIN,
      issuedAtSecondsAgo: 120,
      expiresInSeconds: 60,
    })
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv(),
    )
    expect(res.status).toBe(401)
  })

  it('rejects a token whose azp is not in authorizedParties (wrong authorized party)', async () => {
    const token = await signTestToken({
      privateKey: keypair.privateKey,
      azp: 'https://evil.example',
    })
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv(),
    )
    expect(res.status).toBe(401)
  })

  // T7b/F29 — the five APP_ORIGINS allow-list tests.

  it('accepts a token whose azp matches the second entry of a two-entry APP_ORIGINS list', async () => {
    const token = await signTestToken({ privateKey: keypair.privateKey, azp: SECOND_ORIGIN })
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv({ APP_ORIGINS: `${TEST_ORIGIN},${SECOND_ORIGIN}` }),
    )
    expect(res.status).toBe(200)
  })

  it('rejects a token with no azp claim at all (F29 regression)', async () => {
    // signTestToken omits the azp claim entirely when azp is undefined —
    // this is exactly the shape of a real backend-minted Clerk token
    // (sessions.createSession/getToken), which is how F29 was found:
    // Piece 0 confirmed such a token's signature verifies fine, and fails
    // only this assertion.
    const token = await signTestToken({ privateKey: keypair.privateKey })
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv(),
    )
    expect(res.status).toBe(401)
  })

  it('rejects a token whose azp matches no entry in a multi-entry APP_ORIGINS list', async () => {
    const token = await signTestToken({
      privateKey: keypair.privateKey,
      azp: 'https://evil.example',
    })
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv({ APP_ORIGINS: `${TEST_ORIGIN},${SECOND_ORIGIN}` }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects rather than allows when APP_ORIGINS is empty or whitespace-only (fail closed)', async () => {
    const token = await signTestToken({ privateKey: keypair.privateKey, azp: TEST_ORIGIN })
    for (const emptyValue of ['', '   ', ' , , ']) {
      const res = await testApp.request(
        '/protected',
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv({ APP_ORIGINS: emptyValue }),
      )
      expect(res.status).toBe(401)
    }
  })

  // Piece 0 (T8a carry-over #1): a real Worker with the var entirely unset
  // (rather than set to an empty string) hands clerkAuth() `undefined`, not
  // `''` -- `.split(',')` on that throws a TypeError, which Hono turns into
  // an unhandled 500, not the 401 this middleware's whole contract promises.
  // Simulated here by deleting the key rather than setting it to '', which
  // TypeScript's `Env['APP_ORIGINS']: string` would otherwise make
  // impossible to express -- this is exactly the "var ever unset" shape a
  // missing wrangler.jsonc binding or a misconfigured secret would produce.
  it('rejects with 401, not a 500, when APP_ORIGINS is entirely absent from env (not just empty)', async () => {
    const token = await signTestToken({ privateKey: keypair.privateKey, azp: TEST_ORIGIN })
    const brokenEnv = testEnv() as Partial<Env>
    delete brokenEnv.APP_ORIGINS
    const res = await testApp.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      brokenEnv,
    )
    expect(res.status).toBe(401)
  })
})

// I5's fixture: the pattern T7/T9/T10 reuse once they have a real resource
// to check ownership of. requireOwnership() is deliberately separate from
// clerkAuth() -- authentication says who they are, this says whether
// they're allowed to touch a specific row.
describe('requireOwnership (I5)', () => {
  let keypair: TestKeypair
  const testEnv = (): Env => ({
    ...env,
    CLERK_JWT_KEY: keypair.publicKeyPem,
    APP_ORIGINS: TEST_ORIGIN,
  })

  beforeAll(async () => {
    keypair = await generateTestKeypair()
  })

  it('allows a request whose authenticated user matches the resource owner', async () => {
    const token = await signTestToken({
      privateKey: keypair.privateKey,
      sub: 'user_owner',
      azp: TEST_ORIGIN,
    })
    const res = await testApp.request(
      '/owned/user_owner',
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv(),
    )
    expect(res.status).toBe(200)
  })

  it('rejects with 403 when a valid token belongs to someone other than the resource owner', async () => {
    const token = await signTestToken({
      privateKey: keypair.privateKey,
      sub: 'user_a',
      azp: TEST_ORIGIN,
    })
    const res = await testApp.request(
      '/owned/user_b',
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv(),
    )
    expect(res.status).toBe(403)
  })
})
