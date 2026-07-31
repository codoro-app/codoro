/**
 * Sets document.title and <meta name="description"> per route. Browser-
 * and screen-reader-facing only — unfurl bots (Twitter/Slack/iMessage/
 * Discord) read served HTML and never run this, so it doesn't touch the
 * Open Graph or Twitter card meta tags and doesn't fix link-preview cards;
 * that's a separate, priced decision for Phase 1b (see the build plan).
 *
 * A path with no ROUTE_META entry only happens on the client-side
 * not-found fallback route (every real route has an entry), so that case
 * gets the same title 404.html itself uses rather than leaving whatever
 * the previously-matched route set.
 */
import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { DYNAMIC_ROUTES, ROUTE_META } from './routes'

const NOT_FOUND_TITLE = 'Page not found — Codoro'

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
    }
  }, [location])
}
