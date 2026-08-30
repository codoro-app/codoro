/**
 * Sets document.title, <meta name="description">, and <link rel="canonical">
 * per route. Browser- and screen-reader-facing only — unfurl bots (Twitter/
 * Slack/iMessage/Discord) read served HTML and never run this, so it
 * doesn't touch the Open Graph or Twitter card meta tags and doesn't fix
 * link-preview cards; that's a separate, priced decision for Phase 1b (see
 * the build plan).
 *
 * A path with no ROUTE_META entry only happens on the client-side
 * not-found fallback route (every real route has an entry), so that case
 * gets the same title 404.html itself uses rather than leaving whatever
 * the previously-matched route set. The canonical link is left untouched
 * on a not-found route — no ROUTE_META entry means no real page for a
 * canonical URL to describe, so it just keeps whatever the last real route
 * set (harmless: a not-found page has no meaningful indexable content of
 * its own to canonicalize).
 *
 * The canonical href is always the clean pathname with no query string —
 * wouter's useLocation() returns pathname alone (see the effect body
 * below), and routes.test.ts's "does not deny the fallback ... with a
 * query string" cases already establish that a query string (e.g. a
 * shared/campaign ?utm_source=... link) is a normal, expected way any
 * route gets loaded; canonicalizing away the query string tells crawlers
 * all of those variants are the same page instead of letting them compete
 * as near-duplicates.
 */
import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { DYNAMIC_ROUTES, ROUTE_META } from './routes'

const NOT_FOUND_TITLE = 'Page not found — Codoro'
const SITE_ORIGIN = 'https://getcodoro.com'

/**
 * A dynamic route (e.g. /puzzle/<id>) has no ROUTE_META entry — see
 * routes.ts's DYNAMIC_ROUTES doc comment for why it can't — so this falls
 * back to that route's own generic title/description instead of
 * NOT_FOUND_TITLE. Per the Phase 1b OG-unfurl decision (option (a): accept
 * the generic site card for v2), this is intentionally the same generic
 * copy for every puzzle id, not a per-puzzle title — unfurl bots never run
 * this code anyway, and a per-puzzle browser-tab title is out of scope this
 * phase.
 */
function metaForLocation(location: string): { title: string; description: string } | undefined {
  const exact = ROUTE_META[location]
  if (exact) return exact
  const dynamicRoute = DYNAMIC_ROUTES.find((route) => route.test(location))
  return dynamicRoute
}

export function useRouteMeta() {
  const [location] = useLocation()

  useEffect(() => {
    const meta = metaForLocation(location)
    document.title = meta?.title ?? NOT_FOUND_TITLE
    if (meta) {
      document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description)
      // `location` is wouter's pathname alone: useLocation() returns
      // usePathname()'s value, which reads location.pathname (never
      // location.search — confirmed in wouter/src/use-browser-location.js),
      // so this is already the clean URL with no query string to strip.
      document
        .querySelector('link[rel="canonical"]')
        ?.setAttribute('href', `${SITE_ORIGIN}${location}`)
    }
  }, [location])
}
