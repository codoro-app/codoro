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

// 2b.0: `.route-skeleton__block` keeps its bare classname (routeSkeleton.css
// still needs it for the shimmer @keyframes) but everything visual —
// rounding, the gradient, its size — moved to Tailwind utilities here.
const BLOCK_BASE =
  'route-skeleton__block rounded-md bg-[linear-gradient(90deg,var(--surface-1)_25%,var(--surface-2)_37%,var(--surface-1)_63%)] bg-[length:400%_100%]'

export function RouteSkeleton() {
  return (
    <>
      {/*
       * The shimmer blocks below are `aria-hidden` — decorative placeholder
       * geometry, meaningless read aloud — which left this component with
       * nothing announceable at all. Fine while it was only App.tsx's
       * route-chunk Suspense fallback, but the content-metadata-lazy-load
       * pass made it the cold-boot state on Practice/Trace/Rush/Daily too,
       * four surfaces that previously rendered synchronously and had no
       * loading state to announce. A screen-reader user would otherwise hear
       * silence for the whole fetch. `sr-only` (Tailwind) keeps this out of
       * the visual layout entirely, so the skeleton's appearance is
       * unchanged.
       */}
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div
        className="app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] mx-auto pt-[var(--space-4)] px-4 pb-4"
        aria-hidden="true"
        data-testid="route-skeleton"
      >
        <div className={`${BLOCK_BASE} h-8 w-2/5`} />
        <div className={`${BLOCK_BASE} h-4 w-[90%]`} />
        <div className={`${BLOCK_BASE} h-4 w-[90%]`} />
        <div className={`${BLOCK_BASE} h-32 w-full`} />
      </div>
    </>
  )
}
