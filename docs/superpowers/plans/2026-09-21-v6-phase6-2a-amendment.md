# v6 Phase 6.2a amendment — Stripe backend, as actually built

**Written 2026-09-21**, closing out
`docs/prompts/claude_code_prompt_v6_phase6_2a_stripe_backend.md` against
`docs/superpowers/plans/2026-09-20-v6-phase6-2-payments-spec.md`. Read that
spec first; this amendment only records what deviated, what's still
outstanding, and what 6.2b needs to wire to.

## Piece 0's two verifications, written down

**1. Async webhook verification, confirmed against the installed SDK
(`stripe@22.6.2`), not assumed:**

- `stripe.webhooks.constructEventAsync(payload, header, secret, tolerance?,
cryptoProvider?)` exists and returns `Promise<Event>` — checked directly
  against `node_modules/stripe/cjs/Webhooks.d.ts`.
- `stripe`'s `package.json` declares a `workerd` export condition
  (`esm/stripe.esm.worker.js`) whose `WebPlatformFunctions` already default
  to a fetch-based HTTP client and `SubtleCryptoProvider` — but
  `stripeClient.ts` and `stripeWebhook.ts` pass `Stripe.createFetchHttpClient()`
  and `Stripe.createSubtleCryptoProvider()` **explicitly** anyway, rather
  than relying on whichever export condition a given bundler (wrangler's
  deploy bundler vs. vitest-pool-workers' own esbuild pass) happens to
  resolve. Both are documented inline at their call sites.
- No deviation from the spec here — F45 as written is exactly what's
  implemented.

**2. Subscription status enum, confirmed against Stripe's current API docs
and the installed SDK's types — matches §5 exactly:** `incomplete`,
`incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`,
`unpaid`, `paused`. No deviation.

**A third finding, not anticipated by either verification the spec asked
for, found while implementing Piece 2 — flagged per Piece 0's own "say so
rather than adapt silently" instruction:**

`current_period_end`/`current_period_start` are **not fields on the
Subscription root object** in the installed SDK or in Stripe's current API
docs — checked directly against `node_modules/stripe/cjs/resources/
Subscriptions.d.ts` (no such property in the `Subscription` interface) and
against `docs.stripe.com/api/subscriptions/object` (the object's own
attribute list has no `current_period_end`/`current_period_start` entries).
They now live on each **subscription item** instead
(`SubscriptionItems.d.ts`: `current_period_end: number`). This is a real
Stripe API surface change from whatever version §4's DDL comment
("`current_period_end` — unix seconds, from the authoritative read")
implicitly assumed.

**Adaptation, not a stop:** `stripe.ts`'s `syncEntitlementFromSubscription`
reads `subscription.items.data[0].current_period_end`. Codoro only ever
creates single-item subscriptions (one product, one price — §2), so
`items.data[0]` is always the one item that matters; this is documented
inline in `stripe.ts` and covered by
`test/stripe.test.ts`'s "reads current_period_end from items.data[0], not
the subscription root" test. A genuinely multi-item subscription is out of
scope for this phase and would need this read revisited.

## What was built

- Migration `0003_entitlements.sql` — exactly §4's DDL — plus the isolated
  seed/apply/assert tests the existing migrations convention requires
  (`test/migrations.test.ts`).
- `workers/src/stripeClient.ts` — the one place a Stripe client is
  constructed (`createStripeClient`), plus `assertStripeKeyMode` (F49).
- `workers/src/stripe.ts` — `deriveTier` (§5, the only place tier is ever
  computed) and `syncEntitlementFromSubscription` (§1's authoritative-read
  helper, with the identity-resolution fallback from §3).
- `workers/src/stripeWebhook.ts` — `POST /api/stripe/webhook`'s logic: raw
  body → async signature verify → idempotency insert before work → dispatch
  to exactly the four handled types → 2xx for everything else (§6).
- `workers/src/stripeCheckout.ts` — `resolvePriceId` (F39),
  `createCheckoutSession` (F40, F41), `createBillingPortalSession` (F48).
- `workers/src/index.ts` — the four new routes wired through the existing
  `clerkAuth()`/`rateLimit()` chain, plus `DELETE /api/account` extended to
  cancel at Stripe before deleting D1 rows (Piece 5, F38).
- `workers/src/db.ts` — `upsertEntitlement`, `getEntitlement`,
  `getEntitlementByCustomerId`, `tryRecordStripeEvent`.
- `workers/src/limits.ts` / `wrangler.jsonc` — a fourth `ratelimits`
  binding (`RATE_LIMITER_STRIPE_WEBHOOK_IP`, 30/60) and `ROUTE_LIMITS`
  entries for all four new routes.
- `workers/shared/api-types.ts` — `EntitlementResponse`,
  `CheckoutSessionRequest`/`Response`, `BillingPortalResponse`.
- Test matrix (`test/stripe.test.ts`, webhook logic covered inside
  `test/stripeRoutes.test.ts`, `test/stripeCheckout.test.ts`,
  `test/stripeClient.test.ts`, plus `test/authz.test.ts` additions): every
  §5 status row, signature valid/invalid/missing/tampered, idempotency
  replay, the out-of-order `subscription.updated`-before-
  `checkout.session.completed` case, `cancel_at_period_end` unchanged
  (F44), `past_due` keeps coach (F43), unhandled type → 200/no-write,
  per-IP rate limiting, and the authz matrix (including the webhook's own
  explicit "unauthenticated by design" line, since the table-driven matrix
  structurally can't cover a route with no token).

`pnpm validate` is green in `workers/` (typecheck, lint, 139 tests across
17 files).

## What is NOT done, and why — this needs Thomas, not another session

Every item below is blocked on the same root cause: **no Stripe account
exists for Codoro yet.** `workers/.dev.vars` has no `STRIPE_SECRET_KEY`/
`STRIPE_WEBHOOK_SECRET` (checked directly, both empty), and
`wrangler.jsonc`'s `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_ANNUAL` vars are
empty placeholders for the same reason. This is exactly the kind of
external, account-holder-only prerequisite worth surfacing rather than
guessing around.

**Before the remaining DoD items can be closed, Thomas needs to:**

1. Create a Stripe account (test mode is enough for this phase).
2. In the dashboard, create one product ("Codoro Coach") with two **test
   mode** prices (monthly, annual) — per §2, prices are dashboard-created,
   never code-created.
3. Copy the two test price ids into `wrangler.jsonc`'s `dev` env
   (`STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_ANNUAL`).
4. Grab a test-mode secret key (`sk_test_...`) and put it in
   `workers/.dev.vars` as `STRIPE_SECRET_KEY` (local dev) and via
   `wrangler secret put STRIPE_SECRET_KEY --env dev` (deployed dev Worker).
5. Register a webhook endpoint in the dashboard pointing at the deployed
   dev Worker's `https://<dev-worker>.workers.dev/api/stripe/webhook`,
   copy its signing secret into `STRIPE_WEBHOOK_SECRET` the same way (both
   `.dev.vars` and `wrangler secret put`).

**Once that exists, these DoD items are mechanical, not further coding:**

- [ ] `pnpm --filter workers run migrations:apply:dev` against the real
      dev D1 (the isolated vitest tests already prove the DDL is correct —
      this is the "apply it for real" half of that DoD line).
- [ ] `wrangler deploy --env dev` to get `POST /api/stripe/webhook` live.
- [ ] `stripe trigger checkout.session.completed` /
      `customer.subscription.created` / `.updated` / `.deleted` against
      the deployed dev Worker, output pasted into this doc or a follow-up
      note — the DoD's literal "output pasted" requirement.
- [ ] Webhook CPU-ms (F47, Piece 7): **there is no in-Worker code change
      for this** — Cloudflare doesn't expose CPU time to fetch-handler
      code (`performance.now()`/`Date.now()` measure wall time, not CPU,
      and are intentionally frozen between I/O). The measurement is
      operational: run `wrangler tail --env dev --format pretty` while
      firing a `stripe trigger` event and read the `CPU Time` field off
      the resulting log line (or the same number from the Cloudflare
      dashboard's Workers Observability panel for that invocation). Record
      whatever that number is against the 10ms free-tier ceiling.
- [ ] Account deletion cancels at Stripe, evidenced against the _real_
      Stripe API (the current evidence is `test/stripeRoutes.test.ts`'s
      mocked-client proof that the code path is exercised correctly — real
      is still needed for the DoD's "real API output" bar).

**Not blocked on the Stripe account, but also not done — genuinely out of
scope per the prompt's own "Out of scope" list, noted here only so 6.2b
doesn't assume it's already handled:**

- `/legal`'s description of what's stored doesn't yet name Stripe as a
  processor (§6 point 7 mentions this; it's a live-cutover item per §12,
  not this session's DoD, but 6.2b/6.2c should not forget it).
- No paywall UI, `/coach` route, or Settings billing section — all 6.2b.

## What 6.2b must wire to

- `GET /api/entitlement` → `EntitlementResponse { tier, currentPeriodEnd,
cancelAtPeriodEnd }` (`shared/api-types.ts`). Always 200; a free/never-
  subscribed user gets `{ tier: 'free', currentPeriodEnd: null,
cancelAtPeriodEnd: false }`, not a 404.
- `POST /api/checkout-session` takes `{ plan: 'monthly' | 'annual' }`,
  returns `{ url }` to redirect to. `success_url`/`cancel_url` are built
  server-side from `APP_ORIGINS[0]` as `${origin}/?checkout=success` /
  `${origin}/?checkout=cancelled` — **not** `/coach`-specific yet, since
  that route doesn't exist in this session. 6.2b should either accept this
  query-param contract on whatever route it lands the user on after
  Checkout, or this endpoint's URL-building needs a small follow-up once
  `/coach` exists (a one-line change in `stripeCheckout.ts`'s caller in
  `index.ts`, not a redesign).
- `POST /api/billing-portal` takes no body, returns `{ url }`; 404s
  (`{ error: 'No billing account' }`) for a user with no
  `stripe_customer_id` yet — 6.2b's Settings billing section should treat
  that 404 as "show a subscribe CTA instead of a manage-billing link," not
  as an error state.
- `isEntitledToCoach()` (`src/coach/entitlement.ts`, currently hardcoded
  `false`) is the injection seam 6.1 built for exactly this: swap its body
  for a cached `GET /api/entitlement` read with the 7-day fail-open/closed
  window §8 describes. Nothing else in the coach layer changes.
- The client-side entitlement cache itself (§8) is not built in this
  session — it's UI-adjacent state management, out of scope for "backend
  only, no UI beyond a dev-only test button."

## §13 open decisions — still Thomas's, unchanged by this session

1. **Price**: $7/month, $49/year (recommendation stands).
2. **Refund policy**: 14 days, no questions (recommendation stands).
3. **Business entity**: still flagged, still not blocking 6.2a/6.2b, still
   blocks §12's live cutover, still has calendar time in it.
