import Stripe from 'stripe'
import { vi } from 'vitest'

/**
 * A Stripe client stand-in for tests (F5: worker tests never touch the
 * cloud). `webhooks` is the REAL `Stripe.webhooks` -- signature
 * verification is pure cryptography against a shared secret, no network
 * call, so there's no reason to fake it, and the Piece 6 signature tests
 * need it to genuinely verify/reject. Everything that IS a real network
 * call in production (`subscriptions.retrieve`/`cancel`,
 * `checkout.sessions.create`, `billingPortal.sessions.create`) is a
 * `vi.fn()` the test controls directly.
 */
export function createFakeStripe() {
  return {
    webhooks: Stripe.webhooks,
    subscriptions: {
      retrieve: vi.fn(),
      cancel: vi.fn(),
    },
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
  }
}

export type FakeStripe = ReturnType<typeof createFakeStripe>

/**
 * Signs a JSON payload the same way a real Stripe webhook delivery would,
 * using the SDK's own test-header generator (`generateTestHeaderStringAsync`
 * -- the async variant, same Workers-crypto reasoning as
 * `constructEventAsync`). Returns the exact `Stripe-Signature` header value.
 */
export async function signWebhookPayload(payload: string, secret: string): Promise<string> {
  return Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  })
}

interface BuildEventOptions {
  id: string
  type: string
  object: Record<string, unknown>
}

/** A minimal, structurally-real Stripe Event envelope -- only the fields this Worker's code actually reads. */
export function buildStripeEventPayload(opts: BuildEventOptions): string {
  return JSON.stringify({
    id: opts.id,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    type: opts.type,
    data: { object: opts.object },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  })
}
