import { describe, expect, it } from 'vitest'
import { labelForPath, ROUTE_META } from './routes'

// Mirrors vite.config.ts's workbox.navigateFallbackDenylist[0] exactly —
// not imported from there, since vite.config.ts lives in its own isolated
// tsconfig.node.json project and doesn't export anything for src/ to
// import. Kept in sync by hand; this test is what would catch drift.
const SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN = /^\/(?!$|practice$|daily$|rush$|browse$|legal$)/

describe('labelForPath', () => {
  it('labels the known routes', () => {
    expect(labelForPath('/')).toBe('Home')
    expect(labelForPath('/browse')).toBe('Browse')
    expect(labelForPath('/practice')).toBe('Practice')
    expect(labelForPath('/legal')).toBe('Legal')
  })

  it('falls back to "Codoro" for an unknown path', () => {
    expect(labelForPath('/nonsense')).toBe('Codoro')
  })
})

describe('SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN', () => {
  it('does not deny the fallback for any known route', () => {
    for (const path of Object.keys(ROUTE_META)) {
      expect(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.test(path)).toBe(false)
    }
  })

  it('denies the fallback for an unknown top-level path', () => {
    expect(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.test('/nonsense')).toBe(true)
  })

  it('denies the fallback for a sub-path under a known route', () => {
    expect(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.test('/practice/foo')).toBe(true)
  })
})
