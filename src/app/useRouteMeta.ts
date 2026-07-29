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
import { ROUTE_META } from './routes'

const NOT_FOUND_TITLE = 'Page not found — Codoro'

export function useRouteMeta() {
  const [location] = useLocation()

  useEffect(() => {
    const meta = ROUTE_META[location]
    document.title = meta?.title ?? NOT_FOUND_TITLE
    if (meta) {
      document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description)
    }
  }, [location])
}
