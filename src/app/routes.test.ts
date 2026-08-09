import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DYNAMIC_ROUTES, labelForPath, ROUTE_META } from './routes'

// Mirrors vite.config.ts's workbox.navigateFallbackDenylist[0] exactly —
// not imported from there, since vite.config.ts lives in its own isolated
// tsconfig.node.json project and doesn't export anything for src/ to
// import. Kept in sync by hand; the "matches vite.config.ts's own regex
// source" test below (not just this test file's own copy) is what
// actually catches drift — see that test's own comment (pre-merge review
// finding: this constant alone caught nothing, since every test here only
// ever asserted against itself).
const SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN =
  /^\/(?!(?:practice|daily|rush|browse|legal|trace|challenge|settings|puzzle\/[^/?]+)?(?:\?|$))/

describe('labelForPath', () => {
  it('labels the known routes', () => {
    expect(labelForPath('/')).toBe('Home')
    expect(labelForPath('/browse')).toBe('Browse')
    expect(labelForPath('/practice')).toBe('Practice')
    expect(labelForPath('/legal')).toBe('Legal')
    expect(labelForPath('/settings')).toBe('Settings')
  })

  it('labels a dynamic /puzzle/<id> route generically, without needing the real id', () => {
    expect(labelForPath('/puzzle/tc-009')).toBe('Puzzle')
  })

  it('falls back to "Codoro" for an unknown path, including a bare /puzzle/ with no id', () => {
    expect(labelForPath('/nonsense')).toBe('Codoro')
    expect(labelForPath('/puzzle/')).toBe('Codoro')
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

  // v2 Phase 1b: /puzzle/:id is the first dynamic route, and workbox-routing
  // matches this pattern against pathname + search (see the query-string
  // case above) — so a real id needs the same four-case coverage every
  // static route already gets: bare, with a query string, the no-id edge
  // case, and confirmation an unrelated unknown path is still denied.
  it('does not deny the fallback for a real /puzzle/<id> path', () => {
    expect(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.test('/puzzle/tc-009')).toBe(false)
  })

  it('does not deny the fallback for a /puzzle/<id> path with a query string', () => {
    expect(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.test('/puzzle/tc-009?utm_source=twitter')).toBe(
      false,
    )
  })

  it('denies the fallback for a bare /puzzle/ with no id', () => {
    expect(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.test('/puzzle/')).toBe(true)
  })

  // Pre-merge review finding: every test above only ever asserts against
  // this file's OWN copy of the regex, so they'd all stay green even if
  // vite.config.ts's real navigateFallbackDenylist drifted out of sync
  // entirely (e.g. a route added to ROUTES/ROUTE_META but forgotten in
  // vite.config.ts's alternation) — `pnpm validate` would be fully green
  // while an installed PWA, offline or on a flaky connection, gets denied
  // the cached shell for a route that works fine online. Reading
  // vite.config.ts's actual text and asserting this constant's source
  // appears in it verbatim is what closes that gap — same readFileSync
  // pattern the _redirects guard below already uses.
  it("matches vite.config.ts's own navigateFallbackDenylist regex source verbatim, not just this file's copy of it", () => {
    const viteConfigPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'vite.config.ts',
    )
    const viteConfigSource = readFileSync(viteConfigPath, 'utf-8')
    expect(viteConfigSource).toContain(SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN.source)
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

  it('has a 200 rewrite to / for every ROUTE_META route except the root', () => {
    for (const path of Object.keys(ROUTE_META)) {
      if (path === '/') continue
      expect(redirectsLines).toContain(`${path} / 200`)
    }
  })

  // Rewrite target must be '/', not '/index.html': Cloudflare Pages
  // canonicalizes '.html' URLs and 308-redirects '/index.html' to '/',
  // stripping the original path and query string before the SPA's router
  // ever sees them (v2 Phase 1b Finding 4).
  it('has no rewrite rule targeting /index.html', () => {
    const ruleLines = redirectsLines.filter((line) => line && !line.startsWith('#'))
    expect(ruleLines.some((line) => line.includes('/index.html'))).toBe(false)
  })

  // Explicit, rather than just skipping '/' in the loop above: Vite emits
  // index.html at the root of the build output directly, so '/' needs no
  // rewrite rule the way the other five routes do — this asserts that's
  // still true rather than leaving it as an implied gap in the loop.
  it("has no rewrite rule for '/' — Vite emits index.html there directly", () => {
    expect(redirectsLines).not.toContain('/ / 200')
    expect(redirectsLines.some((line) => /^\/\s/.test(line))).toBe(false)
  })

  it('has no /* catch-all rewrite (an unknown path must still 404)', () => {
    expect(redirectsLines.some((line) => line.startsWith('/*'))).toBe(false)
  })

  it('has a rewrite rule for every DYNAMIC_ROUTES entry', () => {
    for (const route of DYNAMIC_ROUTES) {
      expect(redirectsLines).toContain(route.redirectsRule)
    }
  })
})
