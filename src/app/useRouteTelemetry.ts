/**
 * Fires the `route_view` telemetry event (src/telemetry/events.ts) once per
 * distinct client-side route — including the very first render, which is
 * why this deliberately does NOT copy useRouteFocusAndScroll's
 * skip-first-render behavior: that hook skips the first render because the
 * browser's own initial-load focus/scroll behavior is already correct
 * there, but the landing route is the single most valuable data point in
 * the whole event, so it must fire on mount too.
 *
 * Deduped against the last route reported (a ref, not just the effect's own
 * dependency array), so a re-render at the same location — from an
 * unrelated state change elsewhere in AppShell — never double-fires.
 *
 * `route` is always a route PATTERN from routes.ts's routePatternForPath —
 * never the raw pathname, a query string, or a hash. See that function's
 * own doc comment for why (a real puzzle id in /puzzle/<id>, challenge
 * payload data in /challenge).
 *
 * Known accepted race, same as trackSessionStart's own (see main.tsx):
 * registerAnonId resolves after the profile loads, so the very first
 * route_view of a session may rarely fire before `codoro_anon_id` is
 * registered as a super property — not worth solving for one event on one
 * cold load.
 */
import { useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { trackRouteView } from '../telemetry'
import { routePatternForPath } from './routes'

export function useRouteTelemetry() {
  const [location] = useLocation()
  const lastReportedRef = useRef<string | null>(null)

  useEffect(() => {
    if (lastReportedRef.current === location) return
    lastReportedRef.current = location
    trackRouteView({ route: routePatternForPath(location) })
  }, [location])
}
