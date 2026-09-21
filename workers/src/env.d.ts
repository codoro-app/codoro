/**
 * The Worker's bound environment — one shape, both envs (`dev`/`production`
 * in wrangler.jsonc bind the same NAMES to different values; see F6). Kept
 * hand-in-hand with wrangler.jsonc: a binding added there and not here (or
 * vice versa) is a type error the moment it's used, not a runtime surprise.
 *
 * Secrets (CLERK_SECRET_KEY, CLERK_JWT_KEY, RESEND_API_KEY,
 * UNSUB_HMAC_SECRET) are declared here as they're added by the tasks that
 * need them (T3, T12) — none exist yet, since /api/health is the only route.
 */
// Named distinctly from the `Env` re-export below on purpose: merging this
// straight into `declare namespace Cloudflare { interface Env extends Env {} }`
// makes the inner `Env` resolve to `Cloudflare.Env` itself (namespace-scoped
// name resolution shadows the module-scope one), silently producing an
// empty merge with none of these fields — found by running `tsc` against
// this exact file. `wrangler types`'s own generator sidesteps the same trap
// with an equivalent `__BaseEnv_Env` indirection; this is that fix, named
// for what it is instead of auto-generated.
interface WorkerEnv {
  DB: D1Database
  RATE_LIMITER_PER_IP: RateLimit
  RATE_LIMITER_PER_USER: RateLimit
  /**
   * T4a: `POST /api/report`'s own, stricter per-IP bucket — the plan calls
   * for "strict per-IP rate limiting" on this route specifically, which
   * the shared RATE_LIMITER_PER_IP's 100/60 default isn't (see T4's own
   * amendment note anticipating exactly this: "that's the moment to add a
   * third, distinctly-named ratelimits entry, not to retune this shared
   * one underneath every other route").
   */
  RATE_LIMITER_REPORT_IP: RateLimit
  ENVIRONMENT: 'dev' | 'production'
  /**
   * T7b/F29: comma-separated allow-list of origins whose `azp` claim
   * clerkAuth() accepts (Clerk's `authorizedParties`), NOT a single origin —
   * renamed from `APP_ORIGIN` because dev genuinely needs more than one
   * entry. Production is served from exactly one real frontend origin
   * (`https://getcodoro.com`) so its list has one entry and behaves like the
   * old singular var. Dev has no real frontend origin of its own (no
   * `dev.getcodoro.com` exists, by design, per wrangler.jsonc's own
   * 2026-09-11 amendment) — the only way to authenticate a real browser
   * session against the deployed dev Worker is a Vite dev-server proxy
   * (vite.config.ts) that keeps the browser's own origin at
   * `http://localhost:5173` while forwarding `/api/*` to this Worker, plus
   * (for a two-real-devices pass) a second, LAN-IP origin passed at deploy
   * time (`wrangler deploy --env dev --var
   * APP_ORIGINS:"http://localhost:5173,http://<lan-ip>:5173"`) —
   * deliberately not committed to wrangler.jsonc, since a LAN IP is
   * machine-specific and would rot. auth.ts parses this once per request
   * into an array; an empty/whitespace-only value fails closed (401), it
   * never falls through to an unrestricted check.
   */
  APP_ORIGINS: string
  /** F1's one-curl diagnostic — see wrangler.jsonc's CLERK_INSTANCE comment. */
  CLERK_INSTANCE: 'development' | 'production'
  /**
   * Not set in wrangler.jsonc — CI passes it at deploy time
   * (`wrangler deploy --var VERSION:<git sha>`) so /api/health can report
   * exactly which commit is live. Undefined for local `wrangler dev`.
   */
  VERSION?: string
  /**
   * T3: the Clerk Development/Production instance's JWKS public key (PEM),
   * from the dashboard's API keys page — "Show JWT public key". This is
   * what makes verifyToken() networkless (auth.ts). Set via `wrangler
   * secret put CLERK_JWT_KEY --env <env>`, never in wrangler.jsonc.
   */
  CLERK_JWT_KEY: string
  /**
   * T3: Clerk's secret key. Declared alongside CLERK_JWT_KEY per
   * .dev.vars.example's documented T3 secret pair, though auth.ts's
   * networkless verifyToken() call only reads CLERK_JWT_KEY today — this
   * is here for parity with what Task 0 provisions, and for later tasks
   * (e.g. T13's Clerk Admin API calls for account deletion) that will need
   * it. Set via `wrangler secret put CLERK_SECRET_KEY --env <env>`.
   */
  CLERK_SECRET_KEY: string
  /**
   * v6 Phase 6.2a: `POST /api/stripe/webhook`'s own, distinctly-named
   * per-IP bucket -- same reasoning as T4a's RATE_LIMITER_REPORT_IP (this
   * file's own doc comment above), it's the second unauthenticated write in
   * the system (spec §6). Signature verification is cheap but not free
   * (spec §6 point 6).
   */
  RATE_LIMITER_STRIPE_WEBHOOK_IP: RateLimit
  /**
   * F49: which Stripe key mode this deployment is expected to run in.
   * stripeClient.ts asserts STRIPE_SECRET_KEY's `sk_test_`/`sk_live_`
   * prefix matches this at Worker startup (module scope, not per-request)
   * so a test key can never silently serve `production`, or vice versa.
   * Dev is always `'test'` -- v6 Phase 6.2a ships test-mode only, per the
   * spec's own "Read first" note; live keys are a 6.2c decision (spec §12).
   */
  STRIPE_MODE: 'test' | 'live'
  /**
   * §2: Checkout maps a client-supplied plan name ('monthly' | 'annual') to
   * one of these -- the client never names a price id directly (F39: a
   * client that could would subscribe itself to a $0 test price). Prices
   * are created in the Stripe dashboard, not in code (§2), so these are
   * config, not secrets -- safe as plain wrangler.jsonc vars. **Empty in
   * wrangler.jsonc's `dev` env as of this session**: no Stripe account/
   * product exists yet (checked -- workers/.dev.vars has no STRIPE_* keys
   * either). Thomas creates the "Codoro Coach" product with its two test-
   * mode prices in the Stripe dashboard, then fills these in (see this
   * phase's amendment doc for the full manual-setup checklist).
   */
  STRIPE_PRICE_MONTHLY: string
  STRIPE_PRICE_ANNUAL: string
  /**
   * Stripe's secret API key. Read by stripeClient.ts's one client-
   * construction point (same "one place, mockable" rule as
   * CLERK_SECRET_KEY/clerkAdmin.ts). Set via `wrangler secret put
   * STRIPE_SECRET_KEY --env <env>`, never in wrangler.jsonc, never
   * committed to `.dev.vars`.
   */
  STRIPE_SECRET_KEY: string
  /**
   * The webhook endpoint's signing secret (`whsec_...`), from the Stripe
   * dashboard's Webhooks page for this specific endpoint -- NOT the same
   * value as a `stripe listen` CLI session's secret (they differ, per
   * Stripe's own signature-verification troubleshooting doc: don't
   * cross-wire a Dashboard-managed endpoint's secret with the CLI's).
   * stripeWebhook.ts's only reader. Set via `wrangler secret put
   * STRIPE_WEBHOOK_SECRET --env <env>`.
   */
  STRIPE_WEBHOOK_SECRET: string
}

/**
 * The Worker's bound environment — one shape, both envs (`dev`/`production`
 * in wrangler.jsonc bind the same NAMES to different values; see F6). Kept
 * hand-in-hand with wrangler.jsonc: a binding added there and not here (or
 * vice versa) is a type error the moment it's used, not a runtime surprise.
 *
 * Secrets (CLERK_SECRET_KEY, CLERK_JWT_KEY, RESEND_API_KEY,
 * UNSUB_HMAC_SECRET) are declared here as they're added by the tasks that
 * need them (T3, T12) — none exist yet, since /api/health is the only route.
 */
export type Env = WorkerEnv

// Merges this Env shape into `cloudflare:workers`'s ambient `env` export
// (and the vitest-pool-workers test runtime's `env`, from `cloudflare:workers`
// too — see test/health.test.ts) — the same `declare namespace Cloudflare`
// augmentation `wrangler types` would generate, hand-maintained instead of
// generated: a generated worker-configuration.d.ts pins ENVIRONMENT/vars to
// literal values from whichever `--env` it was last run against (checked at
// install, F7), which is wrong for a file meant to type both dev and
// production. Kept manually in sync with wrangler.jsonc's binding NAMES —
// the same discipline F6's env-drift test already requires.
declare global {
  namespace Cloudflare {
    // An empty body is the declaration-merging idiom itself (this
    // interface's only job is to add WorkerEnv's members to Cloudflare.Env
    // via `extends`); the rule below reads it as a pointless alias, but a
    // non-empty body here would just be duplicating WorkerEnv's fields by
    // hand.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends WorkerEnv {}
  }
}
