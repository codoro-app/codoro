import { describe, expect, it } from 'vitest'
import { resolvePriceId } from '../src/stripeCheckout'

// F39: the client names a plan, never a price id -- resolvePriceId is the
// one place that mapping happens.
describe('resolvePriceId (F39)', () => {
  const prices = { monthly: 'price_monthly_real', annual: 'price_annual_real' }

  it('maps "monthly" to the configured monthly price id', () => {
    expect(resolvePriceId('monthly', prices)).toBe('price_monthly_real')
  })

  it('maps "annual" to the configured annual price id', () => {
    expect(resolvePriceId('annual', prices)).toBe('price_annual_real')
  })

  it('throws loudly rather than silently proceeding when a price id is unconfigured', () => {
    expect(() => resolvePriceId('monthly', { monthly: '', annual: 'price_annual_real' })).toThrow(
      /No Stripe price id configured/,
    )
  })
})
