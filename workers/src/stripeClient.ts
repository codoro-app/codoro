import Stripe from 'stripe'

/**
 * v6 Phase 6.2a: the one place this Worker constructs a Stripe client --
 * kept in its own module for the same "one network boundary, mockable"
 * reason clerkAdmin.ts is: every test that exercises Stripe-touching code
 * `vi.mock`s this file instead of hitting Stripe's servers (F5: worker
 * tests never touch the cloud).
 *
 * `httpClient: Stripe.createFetchHttpClient()` is explicit, not relied-on-
 * by-default: stripe@22.6.2's package.json declares a `workerd` export
 * condition (checked directly against the installed package) that resolves
 * `import Stripe from 'stripe'` to a Workers-specific build whose default
 * platform functions already use `fetch`/`SubtleCrypto` -- but that
 * resolution depends on which bundler condition set is active (wrangler's
 * deploy bundler vs. vitest-pool-workers' own esbuild pass vs. a plain
 * `tsc`/node tool run), and getting it wrong here is a payment-path outage,
 * not a cosmetic bug. Passing it explicitly makes the choice independent of
 * which export condition resolution happened to pick.
 *
 * No `apiVersion` pinned in the config -- the installed SDK's own default
 * (`Stripe.ApiVersion`, "2026-08-26.dahlia" as of this session) is sent
 * automatically, and pinning here would just duplicate a value that's
 * already fixed by whichever `stripe` version `workers/package.json`
 * resolves to.
 */
export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() })
}

/**
 * F49: a test key must never serve `production`, and vice versa -- checked
 * once per client construction (not cached at module scope, same reasoning
 * as clerkAdmin.ts's `createClerkClient`: the secret comes from
 * `c.env.STRIPE_SECRET_KEY`, request-time-only). Fails loudly (throws, no
 * silent fallback) on any mismatch, including a malformed key that matches
 * neither prefix -- there is no "unknown, proceed anyway" branch for a
 * payment credential.
 */
export function assertStripeKeyMode(secretKey: string, expectedMode: 'test' | 'live'): void {
  const isTestKey = secretKey.startsWith('sk_test_')
  const isLiveKey = secretKey.startsWith('sk_live_')
  if (!isTestKey && !isLiveKey) {
    throw new Error(
      'STRIPE_SECRET_KEY does not look like a Stripe secret key (expected an sk_test_ or sk_live_ prefix)',
    )
  }
  if (expectedMode === 'test' && !isTestKey) {
    throw new Error(
      'STRIPE_MODE is "test" but STRIPE_SECRET_KEY is a live key -- refusing to proceed (F49)',
    )
  }
  if (expectedMode === 'live' && !isLiveKey) {
    throw new Error(
      'STRIPE_MODE is "live" but STRIPE_SECRET_KEY is a test key -- refusing to proceed (F49)',
    )
  }
}
