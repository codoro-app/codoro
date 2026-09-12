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
   * Which per-IP `ratelimits` binding this route counts against --
   * `RATE_LIMITER_PER_IP` (the shared 100/60 default) unless a route needs
   * something stricter, in which case it gets its own distinctly-named
   * binding (T4a's `RATE_LIMITER_REPORT_IP`, added because
   * `wrangler.jsonc`'s binding-level policy can't vary by call, only by
   * which binding is used -- see this file's own doc comment above).
   */
  perIpBinding: 'RATE_LIMITER_PER_IP' | 'RATE_LIMITER_REPORT_IP'
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
 * Keyed by `"<METHOD> <path>"`. T4a adds this table's first real entry
 * (`POST /api/report`); T4 itself proved the mechanism against a
 * throwaway test app (test/rateLimit.test.ts) with an empty table, the
 * same pattern T2's db.ts and T3's auth.ts used before their first real
 * caller existed.
 */
export const ROUTE_LIMITS: Record<string, RouteLimit> = {
  'POST /api/report': { perIpBinding: 'RATE_LIMITER_REPORT_IP', perUser: false },
  // T5: authenticated, so both buckets apply — the shared per-IP default is
  // fine here (unlike /api/report, this isn't an anonymous abuse surface;
  // rate limiting it at all is just the "every route rate-limited" rule).
  'DELETE /api/account': { perIpBinding: 'RATE_LIMITER_PER_IP', perUser: true },
  // T7: same reasoning as DELETE /api/account -- authenticated, not an
  // anonymous abuse surface, shared per-IP default is fine. PUT is the
  // route T8's debounced push hits repeatedly during normal play, so the
  // per-user bucket (not just per-IP) matters here specifically: a buggy
  // client retry-looping would otherwise only be caught by the shared IP
  // bucket, which every other signed-in device behind the same IP/NAT
  // would also pay for.
  'PUT /api/profile': { perIpBinding: 'RATE_LIMITER_PER_IP', perUser: true },
  'GET /api/profile': { perIpBinding: 'RATE_LIMITER_PER_IP', perUser: true },
}

/**
 * `ROUTE_LIMITS[key]` types as `RouteLimit | undefined` under
 * `tsconfig.json`'s `noUncheckedIndexedAccess` -- correctly, since a typo'd
 * key really would be `undefined` at runtime. Route registration
 * (`src/index.ts`) calls this instead of indexing directly: a missing
 * entry throws immediately at Worker startup (module evaluation), not on
 * the first real request, so a route wired to `rateLimit()` without a
 * matching `ROUTE_LIMITS` entry fails loudly and immediately rather than
 * 500ing on whoever happens to hit it first.
 */
export function routeLimit(key: string): RouteLimit {
  const limit = ROUTE_LIMITS[key]
  if (!limit) {
    throw new Error(
      `No rate limit configured for route "${key}" -- add it to ROUTE_LIMITS in limits.ts.`,
    )
  }
  return limit
}
