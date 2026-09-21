import { env } from 'cloudflare:workers'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertUser, upsertEntitlement } from '../src/db'
import type { Env } from '../src/env'
import { applyAllMigrations } from './support/migrations'
import { buildStripeEventPayload, createFakeStripe, signWebhookPayload } from './support/fakeStripe'
import { generateTestKeypair, signTestToken } from './support/jwt'
import type { TestKeypair } from './support/jwt'
import type {
  BillingPortalResponse,
  CheckoutSessionResponse,
  EntitlementResponse,
} from '../shared/api-types'
import type Stripe from 'stripe'

// Same "declare the fake/mock before the mocked module is ever imported"
// ordering account.test.ts/authz.test.ts use for clerkAdmin.ts -- vi.mock's
// factory is hoisted as a REGISTRATION but its body only runs the first
// time something actually imports '../src/stripeClient', which happens
// below via the dynamic `await import('../src/index')`, by which point
// `fakeStripe` already holds a real value.
const fakeStripe = createFakeStripe()
vi.mock('../src/stripeClient', () => ({
  createStripeClient: () => fakeStripe,
  assertStripeKeyMode: () => {
    // F49 is covered by its own dedicated unit-level test in
    // stripeClient.test.ts; route tests don't need real key-mode
    // enforcement getting in the way of a fake `sk_test_fake` key.
  },
}))

const deleteClerkUserMock = vi.fn<
  (secretKey: string, userId: string) => Promise<{ deleted: boolean }>
>(() => Promise.resolve({ deleted: true }))
vi.mock('../src/clerkAdmin', () => ({
  deleteClerkUser: (secretKey: string, userId: string) => deleteClerkUserMock(secretKey, userId),
}))

const { default: app } = await import('../src/index')

const TEST_ORIGIN = 'https://getcodoro.test'
const WEBHOOK_SECRET = 'whsec_test_secret'

function fakeSub(overrides: Partial<Record<string, unknown>> = {}): Stripe.Subscription {
  return {
    id: 'sub_default',
    customer: 'cus_default',
    status: 'active',
    cancel_at_period_end: false,
    metadata: {},
    items: { data: [{ current_period_end: 1700000000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription
}

describe('v6 Phase 6.2a Stripe routes', () => {
  let keypair: TestKeypair

  const testEnv = (): Env => ({
    ...env,
    CLERK_JWT_KEY: keypair.publicKeyPem,
    CLERK_SECRET_KEY: 'test-secret-not-real',
    APP_ORIGINS: TEST_ORIGIN,
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_MODE: 'test',
    STRIPE_PRICE_MONTHLY: 'price_monthly_test',
    STRIPE_PRICE_ANNUAL: 'price_annual_test',
  })

  beforeAll(async () => {
    await applyAllMigrations()
    keypair = await generateTestKeypair()
  })

  beforeEach(() => {
    deleteClerkUserMock.mockClear()
    fakeStripe.subscriptions.retrieve.mockReset()
    fakeStripe.subscriptions.cancel.mockReset()
    fakeStripe.checkout.sessions.create.mockReset()
    fakeStripe.billingPortal.sessions.create.mockReset()
  })

  async function tokenFor(sub: string): Promise<string> {
    return signTestToken({ privateKey: keypair.privateKey, sub, azp: TEST_ORIGIN })
  }

  function postWebhook(body: string, signature: string | undefined, ip: string) {
    return app.request(
      '/api/stripe/webhook',
      {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': ip,
          ...(signature ? { 'stripe-signature': signature } : {}),
        },
        body,
      },
      testEnv(),
    )
  }

  // §6, Piece 3.
  describe('POST /api/stripe/webhook', () => {
    it('rejects a missing signature header before any D1/Stripe work', async () => {
      const payload = buildStripeEventPayload({
        id: 'evt_missing_sig',
        type: 'checkout.session.completed',
        object: { subscription: 'sub_x' },
      })
      const res = await postWebhook(payload, undefined, '198.51.100.31')
      expect(res.status).toBe(400)
      expect(fakeStripe.subscriptions.retrieve).not.toHaveBeenCalled()
    })

    it('rejects an invalid signature', async () => {
      const payload = buildStripeEventPayload({
        id: 'evt_bad_sig',
        type: 'checkout.session.completed',
        object: { subscription: 'sub_x' },
      })
      const res = await postWebhook(payload, 't=1,v1=not-a-real-signature', '198.51.100.32')
      expect(res.status).toBe(400)
      expect(fakeStripe.subscriptions.retrieve).not.toHaveBeenCalled()
    })

    it('rejects a body tampered with after signing', async () => {
      const payload = buildStripeEventPayload({
        id: 'evt_tampered',
        type: 'checkout.session.completed',
        object: { subscription: 'sub_x' },
      })
      const signature = await signWebhookPayload(payload, WEBHOOK_SECRET)
      const tampered = payload.replace('"evt_tampered"', '"evt_tampered_with"')
      const res = await postWebhook(tampered, signature, '198.51.100.33')
      expect(res.status).toBe(400)
      expect(fakeStripe.subscriptions.retrieve).not.toHaveBeenCalled()
    })

    it('accepts a validly-signed, handled event and processes it (200)', async () => {
      await insertUser(env.DB, { clerk_user_id: 'user_webhook_1', created_at: Date.now() })
      fakeStripe.subscriptions.retrieve.mockResolvedValue(
        fakeSub({
          id: 'sub_webhook_1',
          customer: 'cus_webhook_1',
          metadata: { clerk_user_id: 'user_webhook_1' },
        }),
      )
      const payload = buildStripeEventPayload({
        id: 'evt_good_1',
        type: 'customer.subscription.created',
        object: { id: 'sub_webhook_1' },
      })
      const signature = await signWebhookPayload(payload, WEBHOOK_SECRET)
      const res = await postWebhook(payload, signature, '198.51.100.34')
      expect(res.status).toBe(200)
      expect(fakeStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_webhook_1')
    })

    it('idempotency: the same event.id delivered twice -- one state change, both 200 (F42)', async () => {
      await insertUser(env.DB, { clerk_user_id: 'user_webhook_2', created_at: Date.now() })
      fakeStripe.subscriptions.retrieve.mockResolvedValue(
        fakeSub({
          id: 'sub_webhook_2',
          customer: 'cus_webhook_2',
          metadata: { clerk_user_id: 'user_webhook_2' },
        }),
      )
      const payload = buildStripeEventPayload({
        id: 'evt_replay_1',
        type: 'customer.subscription.created',
        object: { id: 'sub_webhook_2' },
      })
      const signature = await signWebhookPayload(payload, WEBHOOK_SECRET)

      const first = await postWebhook(payload, signature, '198.51.100.35')
      expect(first.status).toBe(200)
      const second = await postWebhook(payload, signature, '198.51.100.36')
      expect(second.status).toBe(200)

      expect(fakeStripe.subscriptions.retrieve).toHaveBeenCalledTimes(1)
    })

    it('ordering: customer.subscription.updated delivered BEFORE checkout.session.completed still lands on the correct final state (§1)', async () => {
      await insertUser(env.DB, { clerk_user_id: 'user_webhook_3', created_at: Date.now() })
      // Both events trigger the SAME authoritative read regardless of
      // arrival order -- the D1 row ends up reflecting whatever
      // subscriptions.retrieve() currently returns, never a stale payload
      // read off either event.
      fakeStripe.subscriptions.retrieve.mockResolvedValue(
        fakeSub({
          id: 'sub_webhook_3',
          customer: 'cus_webhook_3',
          metadata: { clerk_user_id: 'user_webhook_3' },
          status: 'active',
        }),
      )

      const updatedPayload = buildStripeEventPayload({
        id: 'evt_updated_first',
        type: 'customer.subscription.updated',
        object: { id: 'sub_webhook_3' },
      })
      const updatedRes = await postWebhook(
        updatedPayload,
        await signWebhookPayload(updatedPayload, WEBHOOK_SECRET),
        '198.51.100.37',
      )
      expect(updatedRes.status).toBe(200)

      const completedPayload = buildStripeEventPayload({
        id: 'evt_completed_second',
        type: 'checkout.session.completed',
        object: { subscription: 'sub_webhook_3' },
      })
      const completedRes = await postWebhook(
        completedPayload,
        await signWebhookPayload(completedPayload, WEBHOOK_SECRET),
        '198.51.100.38',
      )
      expect(completedRes.status).toBe(200)

      const row = await env.DB.prepare('SELECT * FROM entitlements WHERE clerk_user_id = ?')
        .bind('user_webhook_3')
        .first()
      expect(row).toMatchObject({ tier: 'coach', stripe_status: 'active' })
    })

    it('an unhandled event type returns 200 with no entitlements write', async () => {
      const payload = buildStripeEventPayload({
        id: 'evt_unhandled_1',
        type: 'invoice.paid',
        object: { id: 'in_1' },
      })
      const signature = await signWebhookPayload(payload, WEBHOOK_SECRET)
      const res = await postWebhook(payload, signature, '198.51.100.39')
      expect(res.status).toBe(200)
      expect(fakeStripe.subscriptions.retrieve).not.toHaveBeenCalled()
    })

    it('is rate limited per IP, independent of the shared default bucket', async () => {
      const ip = '198.51.100.40'
      // vitest.config.ts's RATE_LIMITER_STRIPE_WEBHOOK_IP test override:
      // limit 4, period 10 -- distinct from report's 2 and the shared
      // default's 3.
      for (let i = 0; i < 4; i++) {
        const payload = buildStripeEventPayload({
          id: `evt_rl_${String(i)}`,
          type: 'invoice.paid',
          object: {},
        })
        const res = await postWebhook(
          payload,
          await signWebhookPayload(payload, WEBHOOK_SECRET),
          ip,
        )
        expect(res.status).toBe(200)
      }
      const payload = buildStripeEventPayload({
        id: 'evt_rl_over',
        type: 'invoice.paid',
        object: {},
      })
      const res = await postWebhook(payload, await signWebhookPayload(payload, WEBHOOK_SECRET), ip)
      expect(res.status).toBe(429)
    })
  })

  // §7, Piece 4.
  describe('GET /api/entitlement', () => {
    it('returns free/null/false for a user with no entitlements row yet', async () => {
      const res = await app.request(
        '/api/entitlement',
        {
          headers: {
            Authorization: `Bearer ${await tokenFor('user_ent_1')}`,
            'CF-Connecting-IP': '198.51.100.50',
          },
        },
        testEnv(),
      )
      expect(res.status).toBe(200)
      const body: EntitlementResponse = await res.json()
      expect(body).toEqual({ tier: 'free', currentPeriodEnd: null, cancelAtPeriodEnd: false })
    })

    it('returns the stored tier/period/cancel flag for an existing row', async () => {
      await insertUser(env.DB, { clerk_user_id: 'user_ent_2', created_at: Date.now() })
      await upsertEntitlement(env.DB, {
        clerkUserId: 'user_ent_2',
        tier: 'coach',
        stripeCustomerId: 'cus_ent_2',
        stripeSubscriptionId: 'sub_ent_2',
        stripeStatus: 'active',
        currentPeriodEnd: 1234567890,
        cancelAtPeriodEnd: true,
        now: Date.now(),
      })
      const res = await app.request(
        '/api/entitlement',
        {
          headers: {
            Authorization: `Bearer ${await tokenFor('user_ent_2')}`,
            'CF-Connecting-IP': '198.51.100.51',
          },
        },
        testEnv(),
      )
      const body: EntitlementResponse = await res.json()
      expect(body).toEqual({ tier: 'coach', currentPeriodEnd: 1234567890, cancelAtPeriodEnd: true })
    })
  })

  describe('POST /api/checkout-session', () => {
    it('rejects a body naming a price id instead of a plan -- no such field in the schema (F39)', async () => {
      const res = await app.request(
        '/api/checkout-session',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await tokenFor('user_checkout_1')}`,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '198.51.100.60',
          },
          body: JSON.stringify({ priceId: 'price_free_test_mode_only' }),
        },
        testEnv(),
      )
      expect(res.status).toBe(400)
      expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled()
    })

    it('creates a checkout session with the mapped price id and both identity fields (F39/F40)', async () => {
      fakeStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/test-session',
      })
      const res = await app.request(
        '/api/checkout-session',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await tokenFor('user_checkout_2')}`,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '198.51.100.61',
          },
          body: JSON.stringify({ plan: 'annual' }),
        },
        testEnv(),
      )
      expect(res.status).toBe(200)
      const body: CheckoutSessionResponse = await res.json()
      expect(body.url).toBe('https://checkout.stripe.com/test-session')
      expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: 'price_annual_test', quantity: 1 }],
          client_reference_id: 'user_checkout_2',
          subscription_data: { metadata: { clerk_user_id: 'user_checkout_2' } },
        }),
      )
    })

    it('reuses an existing stripe_customer_id rather than letting Stripe create a new one (F41)', async () => {
      await insertUser(env.DB, { clerk_user_id: 'user_checkout_3', created_at: Date.now() })
      await upsertEntitlement(env.DB, {
        clerkUserId: 'user_checkout_3',
        tier: 'free',
        stripeCustomerId: 'cus_existing',
        stripeSubscriptionId: 'sub_old',
        stripeStatus: 'canceled',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        now: Date.now(),
      })
      fakeStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/resub',
      })
      await app.request(
        '/api/checkout-session',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await tokenFor('user_checkout_3')}`,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '198.51.100.62',
          },
          body: JSON.stringify({ plan: 'monthly' }),
        },
        testEnv(),
      )
      expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_existing' }),
      )
    })
  })

  describe('POST /api/billing-portal (F48)', () => {
    it('404s when the caller has no stripe_customer_id', async () => {
      const res = await app.request(
        '/api/billing-portal',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await tokenFor('user_portal_1')}`,
            'CF-Connecting-IP': '198.51.100.70',
          },
        },
        testEnv(),
      )
      expect(res.status).toBe(404)
      expect(fakeStripe.billingPortal.sessions.create).not.toHaveBeenCalled()
    })

    it('returns the portal url for a user with a customer id', async () => {
      await insertUser(env.DB, { clerk_user_id: 'user_portal_2', created_at: Date.now() })
      await upsertEntitlement(env.DB, {
        clerkUserId: 'user_portal_2',
        tier: 'coach',
        stripeCustomerId: 'cus_portal',
        stripeSubscriptionId: 'sub_portal',
        stripeStatus: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        now: Date.now(),
      })
      fakeStripe.billingPortal.sessions.create.mockResolvedValue({
        url: 'https://billing.stripe.com/test-portal',
      })
      const res = await app.request(
        '/api/billing-portal',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await tokenFor('user_portal_2')}`,
            'CF-Connecting-IP': '198.51.100.71',
          },
        },
        testEnv(),
      )
      expect(res.status).toBe(200)
      const body: BillingPortalResponse = await res.json()
      expect(body.url).toBe('https://billing.stripe.com/test-portal')
      expect(fakeStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_portal',
        return_url: `${TEST_ORIGIN}/`,
      })
    })
  })

  // Piece 5, F38.
  describe('DELETE /api/account cancels the Stripe subscription first', () => {
    it('cancels an active subscription at Stripe before deleting D1 rows', async () => {
      const userId = 'user_delete_stripe_1'
      await insertUser(env.DB, { clerk_user_id: userId, created_at: Date.now() })
      await upsertEntitlement(env.DB, {
        clerkUserId: userId,
        tier: 'coach',
        stripeCustomerId: 'cus_del',
        stripeSubscriptionId: 'sub_del',
        stripeStatus: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        now: Date.now(),
      })
      fakeStripe.subscriptions.cancel.mockResolvedValue(
        fakeSub({ id: 'sub_del', status: 'canceled' }),
      )
      const res = await app.request(
        '/api/account',
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${await tokenFor(userId)}`,
            'CF-Connecting-IP': '198.51.100.80',
          },
        },
        testEnv(),
      )
      expect(res.status).toBe(204)
      expect(fakeStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_del')

      // Real evidence, not inferred from the 204 -- confirmed server-side
      // that both the entitlements row (cascade) and the Stripe
      // subscription cancel call actually happened.
      const row = await env.DB.prepare('SELECT * FROM entitlements WHERE clerk_user_id = ?')
        .bind(userId)
        .first()
      expect(row).toBeNull()
    })

    it('does not call Stripe at all for a user with no subscription on file', async () => {
      const userId = 'user_delete_stripe_2'
      await insertUser(env.DB, { clerk_user_id: userId, created_at: Date.now() })
      const res = await app.request(
        '/api/account',
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${await tokenFor(userId)}`,
            'CF-Connecting-IP': '198.51.100.81',
          },
        },
        testEnv(),
      )
      expect(res.status).toBe(204)
      expect(fakeStripe.subscriptions.cancel).not.toHaveBeenCalled()
    })

    it('a second delete for an already-deleted subscriber is idempotent -- no second Stripe cancel call', async () => {
      const userId = 'user_delete_stripe_3'
      await insertUser(env.DB, { clerk_user_id: userId, created_at: Date.now() })
      await upsertEntitlement(env.DB, {
        clerkUserId: userId,
        tier: 'coach',
        stripeCustomerId: 'cus_del_3',
        stripeSubscriptionId: 'sub_del_3',
        stripeStatus: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        now: Date.now(),
      })
      fakeStripe.subscriptions.cancel.mockResolvedValue(
        fakeSub({ id: 'sub_del_3', status: 'canceled' }),
      )
      const token = await tokenFor(userId)

      const first = await app.request(
        '/api/account',
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '198.51.100.82' },
        },
        testEnv(),
      )
      expect(first.status).toBe(204)
      expect(fakeStripe.subscriptions.cancel).toHaveBeenCalledTimes(1)

      const second = await app.request(
        '/api/account',
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '198.51.100.83' },
        },
        testEnv(),
      )
      expect(second.status).toBe(204)
      // The entitlements row was already cascade-deleted by the first
      // call, so the second call's getEntitlement() finds nothing and
      // never calls Stripe again.
      expect(fakeStripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    })
  })
})
