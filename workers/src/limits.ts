/**
 * T4: rate-limit policy, expressed as config rather than as magic numbers
 * scattered through route handlers (plan: "route → {perIp, perUser} table").
 *
 * F7 finding: the plan's "route → {perIp, perUser} table" reads as if each
 * route could carry its own numeric limit/period, passed at call time. The
 * real, documented `ratelimits` binding contract does not support that --
 * `@cloudflare/workers-types`' `RateLimitOptions` is `{ key: string }` only
 * (checked directly against the installed package's index.d.ts). The
 * numeric `limit`/`period` are fixed per *binding*, set once in
 * wrangler.jsonc's `simple: {limit, period}` block, not overridable per
 * call. (The local miniflare emulator's `RateLimiterObject` happens to also
 * accept `limit`/`period` in the request body and will honor them -- useful
 * for this file's own tests overriding the binding via vitest.config.ts,
 * see below -- but that is a local-testing convenience, not something the
 * real remote binding does. Code here never relies on it.)
 *
 * So what actually varies per route is which bucket(s) a request counts
 * against, not the bucket's size: every route gets its own `key` prefix
 * (this table's key, e.g. `"POST /api/report"`), so two routes never share
 * a counter by accident, and this table says whether a per-user check
 * applies on top of the always-on per-IP check. If a future route needs a
 * genuinely different numeric policy than the shared default, that is the
 * moment to declare an additional `ratelimits` binding in wrangler.jsonc
 * (a growth path this file does not need to build ahead of a real need).
 *
 * This binding does *burst damping* only (10s/60s fixed windows, counted
 * per Cloudflare location -- plan, T4). It is deliberately not the source
 * of truth for any exact quota: e.g. "one score row per user per mode per
 * day" is `scores`'s own PRIMARY KEY (migration 0001), proven to hold
 * independent of this file entirely by test/quotaIndependence.test.ts.
 */
export interface RouteLimit {
  /**
   * Per-user bucket, checked in addition to the always-on per-IP bucket --
   * only meaningful on routes where `clerkAuth()` (T3) runs before
   * `rateLimit()` so `c.get('userId')` is populated. Unauthenticated-by-
   * design routes (T4a's `POST /api/report`) set this `false`: there is no
   * user to key on, and inventing an "anonymous" bucket would just alias
   * every guest into one shared counter (I9-adjacent -- don't fake an
   * identity that was never authenticated).
   */
  perUser: boolean
}

/**
 * Keyed by `"<METHOD> <path>"`. Empty today is correct, not a placeholder
 * to "fill in later": T4's own DoD is the rate-limiting mechanism and its
 * tests, proven the same way T2's db.ts and T3's auth.ts were proven --
 * against a throwaway test app (test/rateLimit.test.ts) -- since no real
 * route mounts it yet. T4a (`POST /api/report`) adds this table's first
 * real entry.
 */
export const ROUTE_LIMITS: Record<string, RouteLimit> = {}
