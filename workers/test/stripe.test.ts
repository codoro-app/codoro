import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { getEntitlement, upsertEntitlement } from '../src/db'
import { deriveTier, syncEntitlementFromSubscription } from '../src/stripe'
import { applyAllMigrations } from './support/migrations'
import { createFakeStripe } from './support/fakeStripe'
import type { EntitlementRow } from '../src/db'
import type Stripe from 'stripe'

// Every row of §5's status table, verbatim -- Piece 6's requirement that
// EVERY status maps to its documented tier, not just the ones exercised
// incidentally elsewhere.
const STATUS_TABLE: [Stripe.Subscription.Status, 'free' | 'coach'][] = [
  ['trialing', 'coach'],
  ['active', 'coach'],
  ['past_due', 'coach'], // F43
  ['unpaid', 'free'],
  ['canceled', 'free'],
  ['incomplete', 'free'],
  ['incomplete_expired', 'free'],
  ['paused', 'free'],
]

describe('deriveTier (Piece 2, §5)', () => {
  it.each(STATUS_TABLE)('status %s -> tier %s', (status, expectedTier) => {
    expect(deriveTier(status)).toBe(expectedTier)
  })

  it('defaults an unrecognized status to free, never coach', () => {
    // Stripe.Subscription.Status includes OtherString for forward-compat --
    // a status this SDK version doesn't know about must never silently
    // grant access.
    expect(deriveTier('some_future_status')).toBe('free')
  })
})

function fakeSubscription(overrides: Partial<Record<string, unknown>> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    metadata: { clerk_user_id: 'user_stripe_1' },
    items: { data: [{ current_period_end: 1700000000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription
}

describe('syncEntitlementFromSubscription (Piece 2, §1)', () => {
  beforeAll(async () => {
    await applyAllMigrations()
  })

  it('retrieves the subscription fresh, derives tier from THAT object, and writes the entitlements row', async () => {
    await env.DB.prepare('INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?)')
      .bind('user_stripe_1', Date.now())
      .run()
    const stripe = createFakeStripe()
    stripe.subscriptions.retrieve.mockResolvedValue(fakeSubscription())

    const result = await syncEntitlementFromSubscription(
      env.DB,
      stripe as unknown as Stripe,
      'sub_1',
    )
    expect(result).toEqual({ clerkUserId: 'user_stripe_1', tier: 'coach' })
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1')

    const row = await getEntitlement(env.DB, 'user_stripe_1')
    expect(row).toMatchObject({
      tier: 'coach',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      stripe_status: 'active',
      current_period_end: 1700000000,
      cancel_at_period_end: 0,
    })
  })

  it('reads current_period_end from items.data[0], not the subscription root (Piece 0 finding)', async () => {
    await env.DB.prepare('INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?)')
      .bind('user_stripe_2', Date.now())
      .run()
    const stripe = createFakeStripe()
    stripe.subscriptions.retrieve.mockResolvedValue(
      fakeSubscription({
        id: 'sub_2',
        customer: 'cus_2',
        metadata: { clerk_user_id: 'user_stripe_2' },
        // No current_period_end at the root -- only on the item, matching
        // the installed SDK's actual Subscription type (no such root field).
        items: { data: [{ current_period_end: 1800000000 }] },
      }),
    )
    await syncEntitlementFromSubscription(env.DB, stripe as unknown as Stripe, 'sub_2')
    const row = await getEntitlement(env.DB, 'user_stripe_2')
    expect(row?.current_period_end).toBe(1800000000)
  })

  it('falls back to a stripe_customer_id lookup when metadata.clerk_user_id is missing (§3)', async () => {
    await env.DB.prepare('INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?)')
      .bind('user_stripe_3', Date.now())
      .run()
    // Seed an existing row for this customer, as if an earlier event
    // already resolved identity for them.
    await upsertEntitlement(env.DB, {
      clerkUserId: 'user_stripe_3',
      tier: 'free',
      stripeCustomerId: 'cus_3',
      stripeSubscriptionId: 'sub_old',
      stripeStatus: 'incomplete',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      now: Date.now(),
    })

    const stripe = createFakeStripe()
    stripe.subscriptions.retrieve.mockResolvedValue(
      fakeSubscription({ id: 'sub_3', customer: 'cus_3', metadata: {} }),
    )
    const result = await syncEntitlementFromSubscription(
      env.DB,
      stripe as unknown as Stripe,
      'sub_3',
    )
    expect(result.clerkUserId).toBe('user_stripe_3')
  })

  it('throws when neither metadata nor an existing customer-id row can resolve an identity', async () => {
    const stripe = createFakeStripe()
    stripe.subscriptions.retrieve.mockResolvedValue(
      fakeSubscription({ id: 'sub_orphan', customer: 'cus_orphan', metadata: {} }),
    )
    await expect(
      syncEntitlementFromSubscription(env.DB, stripe as unknown as Stripe, 'sub_orphan'),
    ).rejects.toThrow(/Cannot resolve a Clerk user/)
  })

  it('cancel_at_period_end: true is stored but does not change tier (F44)', async () => {
    await env.DB.prepare('INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?)')
      .bind('user_stripe_4', Date.now())
      .run()
    const stripe = createFakeStripe()
    stripe.subscriptions.retrieve.mockResolvedValue(
      fakeSubscription({
        id: 'sub_4',
        customer: 'cus_4',
        metadata: { clerk_user_id: 'user_stripe_4' },
        status: 'active',
        cancel_at_period_end: true,
      }),
    )
    const result = await syncEntitlementFromSubscription(
      env.DB,
      stripe as unknown as Stripe,
      'sub_4',
    )
    expect(result.tier).toBe('coach')
    const row = await getEntitlement(env.DB, 'user_stripe_4')
    expect(row).toMatchObject({
      tier: 'coach',
      cancel_at_period_end: 1,
    } satisfies Partial<EntitlementRow>)
  })
})
