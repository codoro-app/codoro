import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { labelForPath, ROUTE_META } from './routes'

// Mirrors vite.config.ts's workbox.navigateFallbackDenylist[0] exactly —
// not imported from there, since vite.config.ts lives in its own isolated
// tsconfig.node.json project and doesn't export anything for src/ to
// import. Kept in sync by hand; this test is what would catch drift.
const SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN =
  /^\/(?!(?:practice|daily|rush|browse|legal|trace)?(?:\?|$))/

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

  // workbox-routing's NavigationRoute._match tests this pattern against
  // url.pathname + url.search (confirmed from workbox-routing's source),
  // not pathname alone — a shared/campaign link is the most likely way a
  // route is ever loaded with a query string, so every known route has to
  // admit one.
  it('does not deny the fallback for any known route with a query string', () => {
    for (const path of Object.keys(ROUTE_META)) {
      expect(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.test(`${path}?utm_source=twitter`)).toBe(false)
    }
  })

  it('does not deny the fallback for the root path with a query string', () => {
    expect(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.test('/?x=1')).toBe(false)
  })

  it('denies the fallback for an unknown top-level path with a query string', () => {
    expect(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.test('/nonsense?x=1')).toBe(true)
  })
})

// public/_redirects had no drift guard at all — unlike the SW denylist
// above, which at least got a hand-synced mirror test — even though it's
// the file deciding whether a route exists on production in the first
// place. Add a route to ROUTE_META and forget _redirects and the route
// 404s on a cold load with a fully green `pnpm validate`.
describe('public/_redirects', () => {
  const redirectsPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'public',
    '_redirects',
  )
  const redirectsLines = readFileSync(redirectsPath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())

  it('has a 200 rewrite to /index.html for every ROUTE_META route except the root', () => {
    for (const path of Object.keys(ROUTE_META)) {
      if (path === '/') continue
      expect(redirectsLines).toContain(`${path} /index.html 200`)
    }
  })

  // Explicit, rather than just skipping '/' in the loop above: Vite emits
  // index.html at the root of the build output directly, so '/' needs no
  // rewrite rule the way the other five routes do — this asserts that's
  // still true rather than leaving it as an implied gap in the loop.
  it("has no rewrite rule for '/' — Vite emits index.html there directly", () => {
    expect(redirectsLines).not.toContain('/ /index.html 200')
    expect(redirectsLines.some((line) => /^\/\s/.test(line))).toBe(false)
  })

  it('has no /* catch-all rewrite (an unknown path must still 404)', () => {
    expect(redirectsLines.some((line) => line.startsWith('/*'))).toBe(false)
  })
})
