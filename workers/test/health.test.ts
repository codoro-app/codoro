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
