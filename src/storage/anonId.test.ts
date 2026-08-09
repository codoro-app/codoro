import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateAnonId } from './anonId'

// `delete crypto.randomUUID` alone doesn't reliably make
// `typeof crypto.randomUUID` read `'undefined'` in every environment this
// suite runs in (a first attempt at this file passed while silently
// exercising the *real* randomUUID() the whole time — its output also
// matches a v4-shaped regex, so the assertion couldn't tell the two code
// paths apart). `vi.stubGlobal`/`vi.unstubAllGlobals` swaps the whole
// global out reliably instead.
function withoutRandomUUID<T>(fn: () => T): T {
  vi.stubGlobal('crypto', {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  })
  try {
    expect(typeof crypto.randomUUID).toBe('undefined')
    return fn()
  } finally {
    vi.unstubAllGlobals()
  }
}

describe('generateAnonId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when available', () => {
    const spy = vi.spyOn(crypto, 'randomUUID')
    const id = generateAnonId()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(id).toBe(spy.mock.results[0]?.value)
  })

  it('falls back to crypto.getRandomValues (a well-formed v4 UUID) when randomUUID is unavailable — the exact case a non-secure-context origin hits', () => {
    const id = withoutRandomUUID(() => generateAnonId())
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('the fallback generates a different id on each call', () => {
    withoutRandomUUID(() => {
      expect(generateAnonId()).not.toBe(generateAnonId())
    })
  })
})
