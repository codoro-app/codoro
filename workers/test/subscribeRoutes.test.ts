import { env } from 'cloudflare:workers'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiErrorResponse, SubscribeResponse } from '../shared/api-types'

// Same "declare the mock before the mocked module is ever imported" ordering
// stripeRoutes.test.ts uses for '../src/stripeClient' -- the factory is
// hoisted as a registration, but only runs the first time something
// actually imports '../src/resendClient', which happens below via the
// dynamic `await import('../src/index')`.
const addContactToSegmentMock = vi.fn<
  (client: unknown, segmentId: string, email: string) => Promise<void>
>(() => Promise.resolve())
vi.mock('../src/resendClient', () => ({
  createResendClient: () => ({}),
  addContactToSegment: (client: unknown, segmentId: string, email: string) =>
    addContactToSegmentMock(client, segmentId, email),
}))

const { default: app } = await import('../src/index')

describe('POST /api/subscribe', () => {
  const testEnv = () => ({
    ...env,
    RESEND_API_KEY: 'test-key-not-real',
    RESEND_SEGMENT_ID: 'seg_test',
  })

  beforeAll(async () => {
    const { applyAllMigrations } = await import('./support/migrations')
    await applyAllMigrations()
  })

  beforeEach(() => {
    addContactToSegmentMock.mockClear()
    addContactToSegmentMock.mockResolvedValue(undefined)
  })

  function post(body: unknown, ip: string) {
    return app.request(
      '/api/subscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify(body),
      },
      testEnv(),
    )
  }

  it('accepts a valid, signed-out email and adds it to the configured segment', async () => {
    const res = await post({ email: 'player@example.com' }, '198.51.100.10')
    expect(res.status).toBe(201)
    const body: SubscribeResponse = await res.json()
    expect(body.ok).toBe(true)
    expect(addContactToSegmentMock).toHaveBeenCalledWith(
      expect.anything(),
      'seg_test',
      'player@example.com',
    )
  })

  it('rejects a body that is not valid JSON', async () => {
    const res = await app.request(
      '/api/subscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.11' },
        body: 'not json',
      },
      testEnv(),
    )
    expect(res.status).toBe(400)
    expect(addContactToSegmentMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed email', async () => {
    const res = await post({ email: 'not-an-email' }, '198.51.100.12')
    expect(res.status).toBe(400)
    const body: ApiErrorResponse = await res.json()
    expect(body.error).toBeTruthy()
    expect(addContactToSegmentMock).not.toHaveBeenCalled()
  })

  it('rejects a filled honeypot field without ever calling Resend', async () => {
    const res = await post({ email: 'player2@example.com', hp: 'i-am-a-bot' }, '198.51.100.13')
    expect(res.status).toBe(400)
    expect(addContactToSegmentMock).not.toHaveBeenCalled()
  })

  it('returns the same generic success shape whether Resend reports the email as new or already-subscribed', async () => {
    // addContactToSegment (resendClient.ts) is idempotent by design -- from
    // this route's perspective there's only ever one outcome to report.
    const res = await post({ email: 'already-subscribed@example.com' }, '198.51.100.14')
    expect(res.status).toBe(201)
    const body: SubscribeResponse = await res.json()
    expect(body.ok).toBe(true)
  })

  it('never leaks Resend failure detail to the client', async () => {
    addContactToSegmentMock.mockRejectedValueOnce(
      new Error('Resend contacts.create failed: bad key'),
    )
    const res = await post({ email: 'player3@example.com' }, '198.51.100.15')
    expect(res.status).toBe(502)
    const body: ApiErrorResponse = await res.json()
    expect(body.error).not.toMatch(/bad key/)
  })

  it('is rate limited per IP, independent of the shared default bucket', async () => {
    const ip = '198.51.100.16'
    // vitest.config.ts's RATE_LIMITER_SUBSCRIBE_IP test override is limit: 5,
    // period: 10 -- distinct from every other route's own test bucket.
    for (let i = 0; i < 5; i++) {
      const res = await post({ email: `bulk${String(i)}@example.com` }, ip)
      expect(res.status).toBe(201)
    }
    const res = await post({ email: 'overflow@example.com' }, ip)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
  })
})
