import { describe, expect, it } from 'vitest'
import { assertStripeKeyMode } from '../src/stripeClient'

// F49: a test key must never serve production, and vice versa.
describe('assertStripeKeyMode (F49)', () => {
  it('accepts a test key when the expected mode is test', () => {
    expect(() => {
      assertStripeKeyMode('sk_test_abc123', 'test')
    }).not.toThrow()
  })

  it('accepts a live key when the expected mode is live', () => {
    expect(() => {
      assertStripeKeyMode('sk_live_abc123', 'live')
    }).not.toThrow()
  })

  it('rejects a live key when the expected mode is test', () => {
    expect(() => {
      assertStripeKeyMode('sk_live_abc123', 'test')
    }).toThrow(/live key/)
  })

  it('rejects a test key when the expected mode is live', () => {
    expect(() => {
      assertStripeKeyMode('sk_test_abc123', 'live')
    }).toThrow(/test key/)
  })

  it('rejects a key matching neither prefix', () => {
    expect(() => {
      assertStripeKeyMode('not-a-stripe-key', 'test')
    }).toThrow(/does not look like a Stripe secret key/)
  })
})
