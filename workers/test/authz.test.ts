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
import { insertUser, upsertEntitlement } from '../src/db'
import type { Env } from '../src/env'
import { applyAllMigrations } from './support/migrations'
import { createFakeStripe } from './support/fakeStripe'
import { generateTestKeypair, signTestToken } from './support/jwt'
import type { TestKeypair } from './support/jwt'
import type { EntitlementResponse, ProfileGetResponse } from '../shared/api-types'

const deleteClerkUserMock = vi.fn<
  (secretKey: string, userId: string) => Promise<{ deleted: boolean }>
>(() => Promise.resolve({ deleted: true }))
vi.mock('../src/clerkAdmin', () => ({
  deleteClerkUser: (secretKey: string, userId: string) => deleteClerkUserMock(secretKey, userId),
}))

// v6 Phase 6.2a: the crossUserCheck for POST /api/checkout-session and
// POST /api/billing-portal below exercises a VALID token, which reaches
// past clerkAuth() into the real handler -- unlike the "no token"/"bad
// token" cases, which 401 before ever touching Stripe. Mocked the same way
// stripeRoutes.test.ts is, so this file never makes a real network call
// either (F5).
const fakeStripe = createFakeStripe()
vi.mock('../src/stripeClient', () => ({
  createStripeClient: () => fakeStripe,
  assertStripeKeyMode: () => undefined,
}))

const { default: app } = await import('../src/index')

const TEST_ORIGIN = 'https://getcodoro.test'
// GET /api/health and POST /api/report are the two routes this Worker
// deliberately leaves unauthenticated (health check must work even if
// token verification itself is broken; report is the one anonymous write
// in the system, by design -- see index.ts's own comments on each).
// v6 Phase 6.2a adds a third: POST /api/stripe/webhook (spec §6) -- Stripe
// itself calls it, so there is no token to check, and it gets its own
// explicit test below since this table-driven matrix structurally can't
// cover an endpoint with no auth (Piece 6's own note). A fourth: POST
// /api/subscribe -- a guest reads this opt-in before ever signing in
// (ChallengeComparison.tsx), same "no token to check" reasoning; covered by
// its own test file, subscribeRoutes.test.ts.
const KNOWN_UNAUTHENTICATED_ROUTES = new Set([
  'GET /api/health',
  'POST /api/report',
  'POST /api/stripe/webhook',
  'POST /api/subscribe',
])

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
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
    STRIPE_MODE: 'test',
    STRIPE_PRICE_MONTHLY: 'price_monthly_test',
    STRIPE_PRICE_ANNUAL: 'price_annual_test',
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
        const ownerBody: ProfileGetResponse = await ownerGet.json()
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
    // v6 Phase 6.2a additions (Piece 6's authz bullet).
    {
      method: 'GET',
      path: '/api/entitlement',
      crossUserCheck: async ({ owner, caller, tokenFor: tf, ip }) => {
        await insertUser(env.DB, { clerk_user_id: owner, created_at: Date.now() })
        await insertUser(env.DB, { clerk_user_id: caller, created_at: Date.now() })
        await upsertEntitlement(env.DB, {
          clerkUserId: owner,
          tier: 'coach',
          stripeCustomerId: 'cus_authz_owner',
          stripeSubscriptionId: 'sub_authz_owner',
          stripeStatus: 'active',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          now: Date.now(),
        })
        const res = await request('GET', '/api/entitlement', await tf(caller), ip)
        expect(res.status).toBe(200)
        const body: EntitlementResponse = await res.json()
        // caller's own (never-subscribed) default, never owner's 'coach'.
        expect(body.tier).toBe('free')
      },
    },
    {
      method: 'POST',
      path: '/api/checkout-session',
      crossUserCheck: async ({ owner, caller, tokenFor: tf, ip }) => {
        await insertUser(env.DB, { clerk_user_id: owner, created_at: Date.now() })
        await insertUser(env.DB, { clerk_user_id: caller, created_at: Date.now() })
        fakeStripe.checkout.sessions.create.mockResolvedValue({
          url: 'https://checkout.stripe.com/authz-test',
        })
        const res = await request('POST', '/api/checkout-session', await tf(caller), ip, {
          plan: 'monthly',
        })
        expect(res.status).toBe(200)
        // The session created is the CALLER's, never the owner's identity.
        expect(fakeStripe.checkout.sessions.create).toHaveBeenLastCalledWith(
          expect.objectContaining({ client_reference_id: caller }),
        )
      },
    },
    {
      method: 'POST',
      path: '/api/billing-portal',
      crossUserCheck: async ({ owner, caller, tokenFor: tf, ip }) => {
        await insertUser(env.DB, { clerk_user_id: owner, created_at: Date.now() })
        await insertUser(env.DB, { clerk_user_id: caller, created_at: Date.now() })
        await upsertEntitlement(env.DB, {
          clerkUserId: owner,
          tier: 'coach',
          stripeCustomerId: 'cus_authz_owner_portal',
          stripeSubscriptionId: 'sub_authz_owner_portal',
          stripeStatus: 'active',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          now: Date.now(),
        })
        // caller has no customer id of their own -- must 404, never reach
        // or return owner's portal session.
        const res = await request('POST', '/api/billing-portal', await tf(caller), ip)
        expect(res.status).toBe(404)
        expect(fakeStripe.billingPortal.sessions.create).not.toHaveBeenCalled()
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
    fakeStripe.checkout.sessions.create.mockReset()
    fakeStripe.billingPortal.sessions.create.mockReset()
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

  // Piece 6's own note: "the webhook gets its own explicit line there
  // since an authz suite structurally cannot cover an endpoint with no
  // auth" -- POST /api/stripe/webhook is in KNOWN_UNAUTHENTICATED_ROUTES
  // above (so the registry check doesn't demand a {no token, bad token,
  // cross-user} entry for it), and this is that explicit line: it accepts
  // requests carrying no Authorization header at all, on purpose, because
  // Stripe itself is the caller and can't carry a Clerk session token.
  // What actually stands in for "auth" on this route is signature
  // verification (stripeRoutes.test.ts's dedicated suite covers that).
  it('POST /api/stripe/webhook is unauthenticated by design -- no Authorization header is required to reach signature verification', async () => {
    const res = await app.request(
      '/api/stripe/webhook',
      {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '203.0.114.200' },
        body: '{}',
      },
      testEnvGlobal(),
    )
    // Rejected for a missing Stripe-Signature header (§6), NOT for a
    // missing Authorization header -- there is no clerkAuth() in front of
    // this route at all, unlike every other route in this file.
    expect(res.status).toBe(400)
  })
})
