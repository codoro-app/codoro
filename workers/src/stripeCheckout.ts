import { z } from 'zod'
import { getEntitlement } from './db'
import type { CheckoutSessionRequest } from '../shared/api-types'
import type Stripe from 'stripe'

/**
 * `POST /api/checkout-session`'s request body schema -- same
 * `satisfies z.ZodType<...>` convention as report.ts's ReportBodySchema,
 * tying this to the wire contract type in shared/api-types.ts.
 */
export const CheckoutSessionBodySchema = z.object({
  plan: z.enum(['monthly', 'annual']),
}) satisfies z.ZodType<CheckoutSessionRequest>

export type PlanName = 'monthly' | 'annual'

export interface PriceIdsByPlan {
  monthly: string
  annual: string
}

/**
 * F39: the client names a plan ('monthly' | 'annual'), never a price id --
 * this is the one place that mapping happens. A client that could name an
 * arbitrary price id could subscribe itself to a $0 price created for
 * testing; `prices` comes from `c.env.STRIPE_PRICE_MONTHLY`/
 * `STRIPE_PRICE_ANNUAL` (wrangler.jsonc vars, never hardcoded, never in
 * client code -- §2), so there's no path from request body to price id at
 * all.
 */
export function resolvePriceId(plan: PlanName, prices: PriceIdsByPlan): string {
  const priceId = prices[plan]
  if (!priceId) {
    throw new Error(
      `No Stripe price id configured for the "${plan}" plan -- has wrangler.jsonc's STRIPE_PRICE_${plan.toUpperCase()} been set?`,
    )
  }
  return priceId
}

export interface CreateCheckoutSessionInput {
  clerkUserId: string
  plan: PlanName
  prices: PriceIdsByPlan
  successUrl: string
  cancelUrl: string
}

/**
 * `POST /api/checkout-session`'s logic (§7). Sets **both** identity fields
 * per F40: `client_reference_id` (Session-only, unavailable on every later
 * lifecycle event) and `subscription_data.metadata.clerk_user_id` (carries
 * forward to every renewal, cancellation, etc. -- what
 * `syncEntitlementFromSubscription`, stripe.ts, actually reads). Reuses an
 * existing Stripe customer when this Clerk user already has one (F41) --
 * read from our own `entitlements` row, not a Stripe-side customer search
 * -- so a subscribe/cancel/resubscribe cycle never splits into two customer
 * records and two billing histories.
 */
export async function createCheckoutSession(
  db: D1Database,
  stripe: Stripe,
  input: CreateCheckoutSessionInput,
): Promise<string> {
  const priceId = resolvePriceId(input.plan, input.prices)
  const existing = await getEntitlement(db, input.clerkUserId)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: input.clerkUserId,
    subscription_data: {
      metadata: { clerk_user_id: input.clerkUserId },
    },
    ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : {}),
    // §2: Stripe Tax on, automatic calculation -- Checkout collects
    // whatever billing address it needs for this itself.
    automatic_tax: { enabled: true },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  })

  if (!session.url) {
    // Not expected in practice (Checkout Sessions created with a
    // success_url always get a url back) -- typed as `string | null` by
    // the SDK, so this is a defensive throw rather than an unsafe
    // assertion, same style as auth.ts's unreachable branches.
    throw new Error('Stripe returned a Checkout Session with no url')
  }
  return session.url
}

/**
 * `POST /api/billing-portal`'s logic (§7, F48): one API call, no
 * cancel/plan-change/payment-method UI built here -- the Portal is already
 * compliant and handles every edge case.
 */
export async function createBillingPortalSession(
  stripe: Stripe,
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
  return session.url
}
