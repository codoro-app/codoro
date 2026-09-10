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
  APP_ORIGIN: string
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
