import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import type { HealthResponse } from '../shared/api-types'

describe('GET /api/health', () => {
  it('returns ok, a version string, and the paired Clerk instance', async () => {
    const res = await app.request('/api/health', {}, env)
    expect(res.status).toBe(200)
    const body: HealthResponse = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('string')
    // The dev env's wrangler.jsonc binds CLERK_INSTANCE to 'development' —
    // this is F1's diagnostic proving itself, not just a shape check.
    expect(body.clerkInstance).toBe('development')
  })

  it('reports the fallback version when VERSION is unset (local dev shape)', async () => {
    const res = await app.request('/api/health', {}, env)
    const body: HealthResponse = await res.json()
    expect(body.version).toBe('dev')
  })

  // F30: the deployed codoro-api-dev Worker's CLERK_JWT_KEY secret was
  // found to be stale (didn't match workers/.dev.vars) only by a real
  // end-to-end token failing -- wrangler secret list proves a name exists,
  // never a value. This is the detector: a fingerprint of whatever
  // CLERK_JWT_KEY this environment actually has, independently
  // recomputed here (not hardcoded, since the real .dev.vars value is
  // machine-specific and CI has none per F5/F7) so the test holds
  // regardless of what the binding's real value is.
  it("reports a fingerprint that matches an independent hash of this environment's CLERK_JWT_KEY", async () => {
    const res = await app.request('/api/health', {}, env)
    const body: HealthResponse = await res.json()
    expect(body.clerkJwtKeyFingerprint).toMatch(/^[0-9a-f]{8}$/)

    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(env.CLERK_JWT_KEY),
    )
    const expected = Array.from(new Uint8Array(digest).slice(0, 4))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    expect(body.clerkJwtKeyFingerprint).toBe(expected)
  })

  it('changes when CLERK_JWT_KEY changes (the property the detector actually relies on)', async () => {
    const res1 = await app.request('/api/health', {}, env)
    const body1: HealthResponse = await res1.json()

    const res2 = await app.request('/api/health', {}, { ...env, CLERK_JWT_KEY: 'a-different-key' })
    const body2: HealthResponse = await res2.json()

    expect(body2.clerkJwtKeyFingerprint).not.toBe(body1.clerkJwtKeyFingerprint)
  })
})

// F5/F7: the whole reason this project chose D1 over Postgres is that
// @cloudflare/vitest-pool-workers gives the worker suite a REAL local D1
// binding — no cloud account, no network call, no credentials. This test
// exists specifically to prove that property holds, not to test any
// application logic (there's no schema yet; migration 0001 is T2).
describe('DB binding (local D1, no cloud credentials)', () => {
  it('executes a real query against a real local D1 database', async () => {
    const result = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>()
    expect(result?.one).toBe(1)
  })
})
