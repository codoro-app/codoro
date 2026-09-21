import { getEntitlementByCustomerId, upsertEntitlement } from './db'
import type { Tier } from './db'
import type Stripe from 'stripe'

/**
 * Piece 2 (v6 Phase 6.2a): §5's entire entitlement-derivation table,
 * verbatim status by status. **This is the only place tier is ever
 * computed** (Piece 2's DoD) -- every webhook handler (stripeWebhook.ts)
 * and both authenticated endpoints that need a tier call
 * `syncEntitlementFromSubscription` below, never re-derive it themselves.
 */
export function deriveTier(status: Stripe.Subscription.Status): Tier {
  switch (status) {
    // F43: `past_due` keeps access -- Stripe is still retrying (dunning).
    // Revoking here punishes a customer whose card expired and who will
    // pay tomorrow.
    case 'trialing':
    case 'active':
    case 'past_due':
      return 'coach'
    case 'unpaid':
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'free'
    default:
      // Stripe.Subscription.Status's installed type includes `OtherString`
      // for forward compatibility with statuses this SDK version doesn't
      // know about yet (checked directly against the installed types) --
      // an unrecognized status defaults to the safe choice, never silently
      // grants coach access.
      return 'free'
  }
}

export interface SyncEntitlementResult {
  clerkUserId: string
  tier: Tier
}

/**
 * Piece 2's authoritative-read helper (spec §1): given a subscription id,
 * fetch it fresh from Stripe, derive tier from THAT object's status, write
 * the entitlements row. Every webhook handler calls this; none of them
 * derive state from an event's own JSON body -- the subscription id is the only
 * thing ever extracted from an event (§1's "events are triggers, not
 * truth").
 *
 * Identity resolution: `subscription.metadata.clerk_user_id` (F40) is the
 * primary signal -- set on `subscription_data.metadata` at Checkout
 * creation time (stripeCheckout.ts), so it's present on every lifecycle
 * event from creation onward, unlike `client_reference_id`, which exists
 * only on the Checkout Session object and is unavailable on every later
 * event. Falls back to a lookup by `stripe_customer_id` (§3) only for the
 * rare case metadata is somehow missing on the retrieved object; throws if
 * neither resolves anyone -- per F42, the caller (stripeWebhook.ts) treats
 * this as a loud, non-retriable failure (logged, not silently swallowed)
 * rather than guessing at an identity.
 */
export async function syncEntitlementFromSubscription(
  db: D1Database,
  stripe: Stripe,
  subscriptionId: string,
): Promise<SyncEntitlementResult> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id

  let clerkUserId = sub.metadata.clerk_user_id
  if (!clerkUserId) {
    const existing = await getEntitlementByCustomerId(db, customerId)
    if (!existing) {
      throw new Error(
        `Cannot resolve a Clerk user for subscription ${subscriptionId}: no metadata.clerk_user_id on the retrieved subscription, and no existing entitlements row for customer ${customerId}`,
      )
    }
    clerkUserId = existing.clerk_user_id
  }

  const tier = deriveTier(sub.status)
  // Piece 0 finding: `current_period_end` is NOT a field on the
  // Subscription root object -- checked directly against the installed
  // stripe@22.6.2 SDK's types (Subscriptions.d.ts has no such property) and
  // against Stripe's current API docs (the Subscription object's own
  // attribute list has no current_period_end/current_period_start entries
  // at all). It moved to each subscription item instead
  // (SubscriptionItems.d.ts: `current_period_end: number`). Codoro's
  // subscriptions are always single-item (one product, one price, §2), so
  // `items.data[0]` is always the one item that matters; a multi-item
  // subscription is out of scope for this phase entirely.
  const currentPeriodEnd = sub.items.data[0]?.current_period_end ?? null

  await upsertEntitlement(db, {
    clerkUserId,
    tier,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripeStatus: sub.status,
    currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    now: Date.now(),
  })

  return { clerkUserId, tier }
}
