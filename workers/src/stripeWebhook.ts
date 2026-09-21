import Stripe from 'stripe'
import { tryRecordStripeEvent } from './db'
import { syncEntitlementFromSubscription } from './stripe'

/**
 * §6 point 5: handle exactly these types, ignore the rest. `charge.
 * succeeded`, `invoice.paid`, `payment_intent.succeeded` are deliberately
 * absent -- for subscriptions they're noise that invites event-body-derived
 * state (§1).
 */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number]

function isHandledEventType(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type)
}

/**
 * The only thing ever read off an event's own JSON body (§1): which
 * subscription this event is about. Never a status, a customer's tier, or
 * any other piece of state -- those come exclusively from
 * `syncEntitlementFromSubscription`'s fresh Stripe read.
 */
function extractSubscriptionId(event: Stripe.Event): string | null {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    if (typeof session.subscription === 'string') return session.subscription
    return session.subscription?.id ?? null
  }
  // customer.subscription.{created,updated,deleted} -- the event's own
  // object IS the subscription.
  const sub = event.data.object as Stripe.Subscription
  return sub.id
}

/**
 * §6's dispatch, called only after idempotency has already been recorded
 * (see `processStripeWebhook` below). Returns `false` for an unhandled
 * type or a handled type with no extractable subscription id (defensive --
 * shouldn't happen for a real event of these four types, but a
 * hand-crafted test event could omit it); the caller still responds 200
 * either way (§6 point 4).
 */
export async function handleStripeEvent(
  db: D1Database,
  stripe: Stripe,
  event: Stripe.Event,
): Promise<boolean> {
  if (!isHandledEventType(event.type)) {
    return false
  }
  const subscriptionId = extractSubscriptionId(event)
  if (!subscriptionId) {
    return false
  }
  await syncEntitlementFromSubscription(db, stripe, subscriptionId)
  return true
}

export type ProcessWebhookOutcome =
  | { status: 400; reason: 'missing signature' | 'invalid signature' }
  | { status: 200; reason: 'already processed' | 'processed' | 'processing failed' }

/**
 * §6, points 1-4: the whole webhook request lifecycle, in order --
 *
 * 1. Verify the signature against the RAW body (`rawBody` must be the
 *    untouched request text, read before any `.json()` call -- the caller,
 *    `POST /api/stripe/webhook` in index.ts, is responsible for that
 *    ordering; this function only ever sees a string, never re-parses or
 *    re-serializes it before verifying).
 * 2. A bad/missing signature is rejected before any D1 access or Stripe
 *    call -- `constructEventAsync` throwing is the only thing that can
 *    happen before the idempotency insert.
 * 3. Idempotency insert BEFORE the work (F42) -- `tryRecordStripeEvent`
 *    returning `false` short-circuits straight to 200, no dispatch.
 * 4. Any other outcome (handled, unhandled, or a processing error) is a
 *    200 -- a non-2xx tells Stripe to retry forever (point 4), and F42
 *    explicitly accepts a post-idempotency-insert crash as non-retriable
 *    (logged loudly here, not surfaced as a Stripe-retriable failure).
 *
 * The **async** constructor (`constructEventAsync`, not `constructEvent`)
 * is required on Workers -- the sync one uses Node's `crypto` module, which
 * doesn't exist on the edge runtime (F45, verified in Piece 0 against the
 * installed SDK's own error message: "Use `await constructEventAsync(...)`
 * instead of `constructEvent(...)`"). `Stripe.createSubtleCryptoProvider()`
 * is passed explicitly for the same "don't depend on which export
 * condition resolved" reason stripeClient.ts documents for the HTTP
 * client.
 */
export async function processStripeWebhook(
  db: D1Database,
  stripe: Stripe,
  webhookSecret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<ProcessWebhookOutcome> {
  if (!signatureHeader) {
    return { status: 400, reason: 'missing signature' }
  }

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signatureHeader,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch {
    return { status: 400, reason: 'invalid signature' }
  }

  const isNewEvent = await tryRecordStripeEvent(db, event.id, event.type, Date.now())
  if (!isNewEvent) {
    return { status: 200, reason: 'already processed' }
  }

  try {
    await handleStripeEvent(db, stripe, event)
    return { status: 200, reason: 'processed' }
  } catch (error) {
    // F42: the idempotency row is already committed at this point, so a
    // retry from Stripe would just hit the short-circuit above and never
    // actually redo this work -- accepted deliberately ("a human
    // re-syncing one subscription is a better failure mode than
    // double-applying"). Logged loudly so that human notices.
    console.error('stripe webhook: event processing failed after idempotency insert', {
      eventId: event.id,
      eventType: event.type,
      error,
    })
    return { status: 200, reason: 'processing failed' }
  }
}
