import type { Context, MiddlewareHandler, Next } from 'hono'
import type { Env } from './env'
import type { RouteLimit } from './limits'

type LimitedContext = Context<{ Bindings: Env; Variables: { userId?: string } }>

/**
 * T4: burst damping via Cloudflare's `ratelimits` binding (RATE_LIMITER_PER_IP,
 * RATE_LIMITER_PER_USER -- wired in wrangler.jsonc since T1). This is real,
 * Durable-Object-backed fixed-window counting locally too, not a fake used
 * only in tests (verified directly against the installed
 * miniflare@5.20260815.0-alpha's RateLimiterObject implementation).
 *
 * `routeKey` namespaces the bucket per route (e.g. `"POST /api/report"`) so
 * two routes never share a counter by accident -- the numeric limit itself
 * is fixed per binding, in wrangler.jsonc's `simple` config (see limits.ts's
 * doc comment for why: the real binding's typed contract is `{ key }` only,
 * no per-call limit/period override).
 *
 * Per-IP is checked on every route this middleware mounts on -- there is
 * always an IP, signed-in or not. Per-user is checked only when
 * `limit.perUser` is true AND `clerkAuth()` (T3) ran first and set
 * `userId` -- routes with no auth in front of this middleware simply never
 * populate `userId`, so the per-user check is a no-op for them regardless
 * of what `limit.perUser` says; `limits.ts` sets it `false` for those
 * routes anyway so that's belt-and-suspenders, not the only guard.
 *
 * Both buckets failing independently is deliberate (I9-adjacent): a
 * malicious single IP juggling many accounts is still capped by the IP
 * bucket; a compromised single account fanned out over many IPs is still
 * capped by the user bucket.
 */
export function rateLimit(
  routeKey: string,
  limit: RouteLimit,
): MiddlewareHandler<{ Bindings: Env; Variables: { userId?: string } }> {
  return async (c: LimitedContext, next: Next) => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
    const ipOutcome = await c.env.RATE_LIMITER_PER_IP.limit({ key: `${routeKey}:ip:${ip}` })
    if (!ipOutcome.success) {
      return tooManyRequests(c)
    }

    if (limit.perUser) {
      const userId = c.get('userId')
      if (userId) {
        const userOutcome = await c.env.RATE_LIMITER_PER_USER.limit({
          key: `${routeKey}:user:${userId}`,
        })
        if (!userOutcome.success) {
          return tooManyRequests(c)
        }
      }
    }

    await next()
  }
}

// A fixed 60s Retry-After: both bindings' configured period is 60s
// (wrangler.jsonc), and the binding's own outcome carries no window/reset
// detail to report a tighter number from (RateLimitOutcome is `{ success }`
// only -- checked against @cloudflare/workers-types). A client that waits
// the full period always succeeds; a client that retries sooner may still
// succeed once the window rolls over, since this is an upper bound, not a
// promise of exactly-60s blocking.
function tooManyRequests(c: LimitedContext) {
  return c.json({ error: 'Too Many Requests' }, 429, { 'Retry-After': '60' })
}
