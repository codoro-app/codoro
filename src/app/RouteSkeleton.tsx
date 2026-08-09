/**
 * The one genuine loading boundary in this app worth a skeleton for (v2
 * Phase 7, Item 3 / todo item 9). Codoro is local-first — puzzles ship in
 * the bundle, profile/attempts reads resolve off IndexedDB in single-digit
 * milliseconds — so every other "loading" state in this app (Home,
 * PracticePage, DailyPage, ...) is a synchronous read that only *looks*
 * async, and a skeleton over one of those would make the app feel slower,
 * not faster (a fake loading state most users will never actually see, on
 * a read that's already done by the time it could render). The real
 * boundary is App.tsx's `<Suspense>` around the route `<Switch>`: on a
 * cold or slow connection, the lazy-loaded page chunk genuinely hasn't
 * arrived yet. See docs/v2-build-plan.md's Phase 7 amendment for the full
 * reasoning and why todo item 11 (optimistic rendering) is deferred rather
 * than built here.
 *
 * One shared skeleton for every route (App.tsx wraps the whole `<Switch>`
 * in a single Suspense boundary, not one per route) rather than a
 * per-route-shaped one: it's sized to the page-chrome block every route
 * wrapper already shares (see practicePage.css/legalPage.css/tracePage.css
 * — flex column, gap, max-width, the safe-area-aware padding), so there's
 * no layout shift when the real page swaps in, without needing a second
 * Suspense boundary per route (a bigger, riskier change this item didn't
 * ask for).
 */
import './routeSkeleton.css'

export function RouteSkeleton() {
  return (
    <div className="route-skeleton app-shell__main" aria-hidden="true">
      <div className="route-skeleton__block route-skeleton__block--title" />
      <div className="route-skeleton__block route-skeleton__block--line" />
      <div className="route-skeleton__block route-skeleton__block--line" />
      <div className="route-skeleton__block route-skeleton__block--card" />
    </div>
  )
}
