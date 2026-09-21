import { Hono } from 'hono'
import { clerkAuth } from './auth'
import { deleteClerkUser } from './clerkAdmin'
import { deleteUser, getEntitlement, getOrCreateUser, insertReport, linkAnonIdIfUnset } from './db'
import { routeLimit } from './limits'
import {
  buildProfileConflictResponse,
  buildProfileGetResponse,
  parseProfilePutBody,
} from './profile'
import { profileStore } from './profileStore'
import { VALID_PUZZLE_IDS } from './puzzleIds.generated'
import { rateLimit } from './rateLimit'
import { addContactToSegment, createResendClient } from './resendClient'
import { ReportBodySchema } from './report'
import { assertStripeKeyMode, createStripeClient } from './stripeClient'
import {
  CheckoutSessionBodySchema,
  createBillingPortalSession,
  createCheckoutSession,
} from './stripeCheckout'
import { SubscribeBodySchema } from './subscribe'
import { processStripeWebhook } from './stripeWebhook'
import type { AuthVariables } from './auth'
import type { Env } from './env'
import type {
  ApiErrorResponse,
  BillingPortalResponse,
  CheckoutSessionResponse,
  EntitlementResponse,
  HealthResponse,
  ProfilePutResponse,
  ReportResponse,
  SubscribeResponse,
} from '../shared/api-types'

const app = new Hono<{ Bindings: Env; Variables: Partial<AuthVariables> }>()

// F30: SHA-256(CLERK_JWT_KEY) truncated to 8 hex chars -- see
// HealthResponse.clerkJwtKeyFingerprint's doc comment (api-types.ts) for
// why hashing a public JWKS key is safe to expose. crypto.subtle is the
// Web Crypto API, available in workerd without any dependency.
async function keyFingerprint(pem: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pem))
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// The only route in T1 (build plan Phase 5.0 item 1). Unauthenticated by
// nature — a health check that required a token couldn't tell you the
// token verification path itself is broken. `clerkInstance` is F1's
// one-curl diagnostic: it makes a `pk_test_` client pointed at a Worker
// wired for `production` (or vice versa) visible from this one field,
// instead of reading as a mysterious 401 an hour later.
app.get('/api/health', async (c) => {
  const body: HealthResponse = {
    ok: true,
    version: c.env.VERSION ?? 'dev',
    clerkInstance: c.env.CLERK_INSTANCE,
    clerkJwtKeyFingerprint: await keyFingerprint(c.env.CLERK_JWT_KEY),
  }
  return c.json(body)
})

// T4a: the only anonymous write in the system (unauthenticated by design
// -- guest-first is law and most reporters will not have accounts), so
// it's also the sharpest abuse surface. No free-text field reaches
// storage, in any form: `reason` is a closed enum (Zod + the table's own
// CHECK), `puzzleId` is checked against the real content index
// (VALID_PUZZLE_IDS, generated from src/content/puzzles/**/*.json --
// see puzzleIds.generated.ts's own comment for why this isn't a literal
// import of src/content's module), `appVersion` is stored but never
// interpreted. `rateLimit()` runs before any parsing -- an abusive
// request is rejected on IP alone before this handler spends any work on
// it. routeLimit() throws at startup, not per-request, if 'POST
// /api/report' were ever missing from limits.ts's ROUTE_LIMITS.
app.post(
  '/api/report',
  rateLimit('POST /api/report', routeLimit('POST /api/report')),
  async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json<ApiErrorResponse>({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = ReportBodySchema.safeParse(raw)
    if (!parsed.success) {
      return c.json<ApiErrorResponse>({ error: 'Invalid report body' }, 400)
    }

    if (!VALID_PUZZLE_IDS.has(parsed.data.puzzleId)) {
      return c.json<ApiErrorResponse>({ error: 'Unknown puzzle id' }, 400)
    }

    await insertReport(c.env.DB, {
      puzzleId: parsed.data.puzzleId,
      reason: parsed.data.reason,
      appVersion: parsed.data.appVersion,
      now: Date.now(),
    })

    return c.json<ReportResponse>({ ok: true }, 201)
  },
)

// T5: the one place this Worker's client-auth phase touches `workers/` —
// everything else in T5 is client-side (see the implementation plan's own
// note). Deletes the D1 `users` row (cascades to profiles/scores/
// scores_best/email_prefs via ON DELETE CASCADE, migration 0001) and the
// Clerk user via the Admin API (clerkAdmin.ts). **Idempotent**, per the API
// contract: a second call for an already-deleted user still returns 204 —
// `deleteUser()`'s DELETE matches zero rows silently, and
// `deleteClerkUser()` treats Clerk's 404 as already-done, not an error.
// Confirming the deletion actually happened (re-querying D1 + the Clerk
// Admin API afterward) is the client's own DoD step and T13's full sweep,
// not this handler's job — this handler's contract is just "the delete
// call itself doesn't lie about succeeding."
app.delete(
  '/api/account',
  clerkAuth(),
  rateLimit('DELETE /api/account', routeLimit('DELETE /api/account')),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      // Unreachable in practice — clerkAuth() above already 401s before
      // this handler runs — but c.get('userId') types as `string |
      // undefined` (Variables is Partial<AuthVariables> at the app level,
      // see this file's own Hono<> declaration), so this satisfies the
      // compiler without an unsafe assertion.
      return c.json<ApiErrorResponse>({ error: 'Unauthorized' }, 401)
    }
    // v6 Phase 6.2a, Piece 5 (F38): cancel at Stripe BEFORE deleting D1
    // rows -- `ON DELETE CASCADE` removes the entitlements row and tells
    // Stripe nothing, so without this a deleted user keeps being billed
    // for a product whose data is gone. Deliberately not wrapped in a
    // try/catch that swallows a cancellation failure: this is the money
    // path, so a Stripe error here fails the whole request (500, nothing
    // in D1 touched yet) rather than silently proceeding to delete a user
    // who's still an active paying subscriber. Idempotent for a repeat
    // call the same way the rest of this handler always has been: once
    // the first call's deleteUser() cascades the entitlements row away,
    // getEntitlement() returns null and this block is skipped entirely.
    const entitlement = await getEntitlement(c.env.DB, userId)
    if (entitlement?.stripe_subscription_id) {
      assertStripeKeyMode(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_MODE)
      const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY)
      await stripe.subscriptions.cancel(entitlement.stripe_subscription_id)
    }
    await deleteUser(c.env.DB, userId)
    await deleteClerkUser(c.env.CLERK_SECRET_KEY, userId)
    return c.body(null, 204)
  },
)

// T7: `PUT /api/profile` -- optimistic-concurrency sync push. Row creation
// for `users` is NOT "already handled by T3" the way the plan assumed
// (db.ts's getOrCreateUser doc comment covers the finding) -- this route is
// what actually calls it, first, before the FK-constrained profiles write.
// The size cap (S4) is checked against the decompressed JSON's byte length
// (parseProfilePutBody, profile.ts), before profileStore.putIfMatch's own
// internal gzip (S1) -- two different layers, per the 2026-08-31 amendment.
// anonId link-once is attempted only after a successful write, never on a
// rejected/conflicting one -- a client whose push was rejected will retry
// the whole submission, so recording anonId against a write that didn't
// happen would be premature. `requireOwnership()` (auth.ts) has no second
// id to check here -- unlike a route that reads a resource id from the
// request, this always reads and writes exactly the authenticated caller's
// own row (`c.get('userId')`), same as DELETE /api/account above.
//
// Neither this handler nor GET below spells the wire field's real name --
// `parseProfilePutBody`/`buildProfileGetResponse`/
// `buildProfileConflictResponse` (profile.ts) are the only place it's
// written, alongside profileStore.ts's D1 column; both are exempted from
// workers/test/static/profileStorePayloadGuard.test.ts's grep guard for the
// same reason, this file deliberately is not.
app.put(
  '/api/profile',
  clerkAuth(),
  rateLimit('PUT /api/profile', routeLimit('PUT /api/profile')),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json<ApiErrorResponse>({ error: 'Unauthorized' }, 401)
    }

    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json<ApiErrorResponse>({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = parseProfilePutBody(raw)
    if (!parsed.ok) {
      if (parsed.reason === 'too-large') {
        return c.json<ApiErrorResponse>({ error: 'Profile data too large' }, 413)
      }
      return c.json<ApiErrorResponse>({ error: 'Invalid profile body' }, 400)
    }

    await getOrCreateUser(c.env.DB, userId)

    const { baseRevision, schemaVersion, json } = parsed
    const result = await profileStore.putIfMatch(
      c.env.DB,
      userId,
      json,
      { schemaVersion, updatedAt: Date.now() },
      baseRevision,
    )

    if (!result.ok) {
      const current = await profileStore.get(c.env.DB, userId)
      // Unreachable in practice -- a conflict means a row already existed
      // at write time, so profileStore.get() finding nothing immediately
      // after would mean it was deleted in between (e.g. account
      // deletion racing a push). Typed defensively rather than asserted,
      // same style as the DELETE /api/account handler's unreachable
      // `!userId` branch above.
      if (!current) {
        return c.json<ApiErrorResponse>({ error: 'Conflict' }, 409)
      }
      return c.json(buildProfileConflictResponse(current), 409)
    }

    if (parsed.anonId) {
      await linkAnonIdIfUnset(c.env.DB, userId, parsed.anonId)
    }

    const status = baseRevision === 0 ? 201 : 200
    return c.json<ProfilePutResponse>({ ok: true, revision: result.newRevision }, status)
  },
)

// T7: `GET /api/profile` -- sync pull. Same ownership note as PUT above:
// always the authenticated caller's own row, nothing else to check.
app.get(
  '/api/profile',
  clerkAuth(),
  rateLimit('GET /api/profile', routeLimit('GET /api/profile')),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json<ApiErrorResponse>({ error: 'Unauthorized' }, 401)
    }

    const record = await profileStore.get(c.env.DB, userId)
    if (!record) {
      return c.json<ApiErrorResponse>({ error: 'Not found' }, 404)
    }

    return c.json(buildProfileGetResponse(record))
  },
)

// v6 Phase 6.2a, Piece 3: `POST /api/stripe/webhook` — the second
// unauthenticated write in the system, after POST /api/report (§6). Every
// point of §6 in order:
//   1. Raw body read as text, BEFORE any parse — `c.req.text()` is the
//      first thing touched in this handler, full stop. A `.json()` call
//      anywhere before signature verification would permanently break it
//      (F45) because the body stream can't be re-read afterward.
//   2/3. `processStripeWebhook` (stripeWebhook.ts) verifies the signature
//      with the async constructor (F45) before any D1 access, then
//      inserts the idempotency row BEFORE doing any work (F42).
//   4. Every outcome from `processStripeWebhook` other than a bad
//      signature is 200 — an unhandled type, an already-processed event,
//      and a post-idempotency processing failure all return `{ status:
//      200 }` from that function; this handler just forwards whatever
//      status it returns.
//   5. Exactly the four handled types — enforced inside
//      stripeWebhook.ts's HANDLED_EVENT_TYPES, not here.
//   6. rateLimit() below runs before this handler at all, same "reject
//      before work" ordering POST /api/report already established.
//   7. No PII stored — this route never reads or writes anything but
//      Stripe ids (via stripe.ts's upsertEntitlement).
app.post(
  '/api/stripe/webhook',
  rateLimit('POST /api/stripe/webhook', routeLimit('POST /api/stripe/webhook')),
  async (c) => {
    const rawBody = await c.req.text()
    const signature = c.req.header('stripe-signature')
    assertStripeKeyMode(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_MODE)
    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY)
    const outcome = await processStripeWebhook(
      c.env.DB,
      stripe,
      c.env.STRIPE_WEBHOOK_SECRET,
      rawBody,
      signature,
    )
    return c.body(null, outcome.status)
  },
)

// v6 Phase 6.2a, Piece 4: `GET /api/entitlement` (§7). Always 200, even for
// a user with no `entitlements` row yet — "not entitled to coach" is this
// route's normal steady state for a free user, not an absent resource
// (unlike GET /api/profile's 404-on-missing).
app.get(
  '/api/entitlement',
  clerkAuth(),
  rateLimit('GET /api/entitlement', routeLimit('GET /api/entitlement')),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json<ApiErrorResponse>({ error: 'Unauthorized' }, 401)
    }
    const row = await getEntitlement(c.env.DB, userId)
    const body: EntitlementResponse = row
      ? {
          tier: row.tier,
          currentPeriodEnd: row.current_period_end,
          cancelAtPeriodEnd: row.cancel_at_period_end === 1,
        }
      : { tier: 'free', currentPeriodEnd: null, cancelAtPeriodEnd: false }
    return c.json(body)
  },
)

// v6 Phase 6.2a, Piece 4: `POST /api/checkout-session` (§7). `successUrl`/
// `cancelUrl` are built server-side from `APP_ORIGINS` (the same allow-list
// auth.ts trusts for `azp`), never taken from the request body — letting a
// client name its own post-checkout redirect would be an open-redirect
// surface on the one flow in this app that ends with a live payment form.
app.post(
  '/api/checkout-session',
  clerkAuth(),
  rateLimit('POST /api/checkout-session', routeLimit('POST /api/checkout-session')),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json<ApiErrorResponse>({ error: 'Unauthorized' }, 401)
    }

    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json<ApiErrorResponse>({ error: 'Invalid JSON body' }, 400)
    }
    const parsed = CheckoutSessionBodySchema.safeParse(raw)
    if (!parsed.success) {
      return c.json<ApiErrorResponse>({ error: 'Invalid checkout session body' }, 400)
    }

    const appOrigin = c.env.APP_ORIGINS.split(',')[0]?.trim()
    if (!appOrigin) {
      return c.json<ApiErrorResponse>({ error: 'Server misconfigured' }, 500)
    }

    // T7's lazy-insert, same reasoning as PUT /api/profile: a checkout can
    // be this user's very first authenticated write, and
    // subscription_data.metadata.clerk_user_id (F40) must reference a real
    // `users` row for entitlements' FK to accept the webhook's later write.
    await getOrCreateUser(c.env.DB, userId)

    assertStripeKeyMode(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_MODE)
    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY)
    const url = await createCheckoutSession(c.env.DB, stripe, {
      clerkUserId: userId,
      plan: parsed.data.plan,
      prices: { monthly: c.env.STRIPE_PRICE_MONTHLY, annual: c.env.STRIPE_PRICE_ANNUAL },
      successUrl: `${appOrigin}/?checkout=success`,
      cancelUrl: `${appOrigin}/?checkout=cancelled`,
    })
    return c.json<CheckoutSessionResponse>({ url })
  },
)

// v6 Phase 6.2a, Piece 4: `POST /api/billing-portal` (§7, F48) — one API
// call, no cancel/plan-change/payment-method UI built in this Worker.
app.post(
  '/api/billing-portal',
  clerkAuth(),
  rateLimit('POST /api/billing-portal', routeLimit('POST /api/billing-portal')),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json<ApiErrorResponse>({ error: 'Unauthorized' }, 401)
    }
    const entitlement = await getEntitlement(c.env.DB, userId)
    if (!entitlement?.stripe_customer_id) {
      return c.json<ApiErrorResponse>({ error: 'No billing account' }, 404)
    }
    const appOrigin = c.env.APP_ORIGINS.split(',')[0]?.trim()
    if (!appOrigin) {
      return c.json<ApiErrorResponse>({ error: 'Server misconfigured' }, 500)
    }

    assertStripeKeyMode(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_MODE)
    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY)
    const url = await createBillingPortalSession(
      stripe,
      entitlement.stripe_customer_id,
      `${appOrigin}/`,
    )
    return c.json<BillingPortalResponse>({ url })
  },
)

// The third unauthenticated write in the system, after POST /api/report and
// POST /api/stripe/webhook -- same "own distinctly-named rate-limit bucket"
// treatment (limits.ts). A guest reads this opt-in before ever signing in
// (ChallengeComparison.tsx), so clerkAuth() never runs in front of it. The
// honeypot check runs before the Resend call, same "reject before work"
// ordering POST /api/report established: a filled `hp` field never reaches
// Resend or costs a network call.
app.post(
  '/api/subscribe',
  rateLimit('POST /api/subscribe', routeLimit('POST /api/subscribe')),
  async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json<ApiErrorResponse>({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = SubscribeBodySchema.safeParse(raw)
    if (!parsed.success) {
      return c.json<ApiErrorResponse>({ error: 'Invalid subscribe body' }, 400)
    }
    if (parsed.data.hp) {
      return c.json<ApiErrorResponse>({ error: 'Invalid subscribe body' }, 400)
    }

    try {
      const resend = createResendClient(c.env.RESEND_API_KEY)
      await addContactToSegment(resend, c.env.RESEND_SEGMENT_ID, parsed.data.email)
    } catch {
      // Never leak Resend's own error detail (bad API key, unknown segment
      // id, network failure) to the client -- same "generic 400/500, no
      // verbose error detail" posture POST /api/report's own doc comment
      // establishes for this class of unauthenticated write.
      return c.json<ApiErrorResponse>({ error: 'Could not subscribe' }, 502)
    }

    return c.json<SubscribeResponse>({ ok: true }, 201)
  },
)

export default app
