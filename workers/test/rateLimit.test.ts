import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { rateLimit } from '../src/rateLimit'
import type { Env } from '../src/env'

// A throwaway app, local to this test file -- no real route in src/index.ts
// mounts rateLimit() yet (the first real consumer is T4a's POST
// /api/report), same pattern test/auth.test.ts uses for clerkAuth().
//
// The bucket sizes exercised here come from vitest.config.ts's `ratelimits`
// override (limit: 3, period: 10) -- deliberately small so a burst test
// runs in milliseconds, not from wrangler.jsonc's real 100/60 (see
// vitest.config.ts's comment on that override, and limits.ts's comment on
// why the numeric limit lives on the binding, not per call).
const testApp = new Hono<{ Bindings: Env; Variables: { userId?: string } }>()
testApp.get(
  '/ip-only',
  rateLimit('GET /ip-only', { perIpBinding: 'RATE_LIMITER_PER_IP', perUser: false }),
  (c) => c.json({ ok: true }),
)
testApp.get(
  '/ip-and-user',
  async (c, next) => {
    // Stand-in for clerkAuth() (T3): sets userId from a test-only header
    // instead of verifying a real token -- this file's job is proving
    // rateLimit()'s bucket logic, not re-proving T3's auth middleware.
    const userId = c.req.header('X-Test-User-Id')
    if (userId) c.set('userId', userId)
    await next()
  },
  rateLimit('GET /ip-and-user', { perIpBinding: 'RATE_LIMITER_PER_IP', perUser: true }),
  (c) => c.json({ ok: true }),
)

function requestFrom(path: string, ip: string, userId?: string) {
  const headers: Record<string, string> = { 'CF-Connecting-IP': ip }
  if (userId) headers['X-Test-User-Id'] = userId
  // env passed as the third arg supplies c.env (same pattern test/auth.test.ts
  // uses) -- without it, rateLimit() sees an undefined c.env and throws
  // before ever reaching the limiter binding.
  return testApp.request(path, { headers }, env)
}

describe('rateLimit (T4)', () => {
  // Each `it` uses its own IP/user so tests never share a bucket -- the
  // limiter's state is real Durable Object storage, not reset per test
  // (the same "shared across a test file" property T2's profileStore.test.ts
  // found for D1; there's no reason to assume ratelimits differs, and every
  // key here is unique specifically to not depend on it either way).

  it('allows requests up to the configured limit', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await requestFrom('/ip-only', '203.0.113.10')
      expect(res.status).toBe(200)
    }
  })

  it('returns 429 with Retry-After once the per-IP limit is exceeded', async () => {
    const ip = '203.0.113.20'
    for (let i = 0; i < 3; i++) {
      const res = await requestFrom('/ip-only', ip)
      expect(res.status).toBe(200)
    }
    const res = await requestFrom('/ip-only', ip)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    const body = await res.json<{ error: string }>()
    expect(body.error).toBe('Too Many Requests')
  })

  it('per-IP buckets are independent -- a different IP is not affected by another IP exhausting its limit', async () => {
    const exhaustedIp = '203.0.113.30'
    for (let i = 0; i < 3; i++) {
      await requestFrom('/ip-only', exhaustedIp)
    }
    expect((await requestFrom('/ip-only', exhaustedIp)).status).toBe(429)

    const freshIp = '203.0.113.31'
    expect((await requestFrom('/ip-only', freshIp)).status).toBe(200)
  })

  it("blocks a user's own requests once their per-user bucket is exhausted, even from a fresh IP each time", async () => {
    const userId = 'user_c'
    for (let i = 0; i < 3; i++) {
      // A fresh IP per request so the per-IP bucket never trips -- isolates
      // this assertion to the per-user bucket specifically.
      const res = await requestFrom('/ip-and-user', `203.0.113.5${String(i)}`, userId)
      expect(res.status).toBe(200)
    }
    const res = await requestFrom('/ip-and-user', '203.0.113.59', userId)
    expect(res.status).toBe(429)
  })

  it('a different user on a fresh IP is unaffected by another user exhausting their per-user bucket', async () => {
    const exhaustedUser = 'user_d'
    for (let i = 0; i < 3; i++) {
      await requestFrom('/ip-and-user', `203.0.113.6${String(i)}`, exhaustedUser)
    }
    expect((await requestFrom('/ip-and-user', '203.0.113.69', exhaustedUser)).status).toBe(429)

    const otherUser = 'user_e'
    expect((await requestFrom('/ip-and-user', '203.0.113.70', otherUser)).status).toBe(200)
  })

  it('an unauthenticated request on a perUser: true route is only ever checked against the per-IP bucket', async () => {
    const ip = '203.0.113.80'
    for (let i = 0; i < 3; i++) {
      const res = await requestFrom('/ip-and-user', ip) // no userId
      expect(res.status).toBe(200)
    }
    const res = await requestFrom('/ip-and-user', ip)
    expect(res.status).toBe(429)
  })
})
