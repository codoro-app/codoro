/**
 * Top-level responsive shell. <1024px: single column — a slim logo-only top
 * bar, whatever page is active full width, and BottomNav fixed to the
 * viewport bottom (v3 Phase 2b.8; replaced ModeSwitcher's old top tab
 * strip — see BottomNav.tsx's own doc comment for why). >=1024px:
 * chess.com-style three-region grid — a fixed left NavRail, and a content
 * region where the active page itself decides (via `useMediaQuery` + its
 * own markup) whether to render a right-hand sidebar alongside its main
 * column; see PracticePage.tsx/DailyPage.tsx.
 *
 * Both BottomNav and NavRail are always mounted — neither has side effects,
 * so there is no cost to rendering both and letting Tailwind's `lg:`
 * breakpoint decide which is visible at a given width. This keeps nav
 * visibility pure-CSS, consistent with the "CSS grid + media queries, no
 * JS breakpoint logic" rule for layout — the one place this shell *does*
 * use a JS breakpoint check (`useMediaQuery`) is reserved for gating
 * components with real side effects (data fetches), not for positioning.
 *
 * No mode/onModeChange props (v2 Phase 1a): NavRail/BottomNav read the
 * active route themselves via wouter's useLocation, and the brand button /
 * footer legal link below are real `<Link>`s rather than callbacks into a
 * parent-owned mode state.
 *
 * Route-change focus/scroll management (v2 Phase 1a) lives here rather than
 * in App.tsx: AppShell is the one thing that stays mounted across every
 * client-side navigation (only `children` — the active page — changes), so
 * it's the natural, single place to own the `<main>` ref that
 * useRouteFocusAndScroll moves focus to and scrolls to on each route
 * change. `tabIndex={-1}` makes it programmatically focusable without
 * adding it to the tab order; `aria-label` names the active page for
 * screen-reader users landing there regardless of whether a heading exists
 * yet in `children` at that instant (e.g. mid-fetch, before a page's own
 * loading/error branch has rendered anything).
 *
 * SEO/a11y follow-up (v4 SEO audit): most routes had no real `<h1>` at
 * all — every page's loading/error/success branches would have needed one
 * added individually. A single `sr-only` `<h1>` here, driven by the same
 * `labelForPath` already used for `aria-label` above, covers every branch
 * of every route in one place instead. Skipped for LegalPage/SettingsPage
 * only — both already render their own real, visible `<h1>` (with a
 * `<h2>` section hierarchy beneath it), and a second `<h1>` would break
 * the "one clear H1 per page" rule instead of fixing it.
 * `focus:outline-none` suppresses the browser's default focus ring on
 * `<main>` — safe only because it's never in the sighted tab order, so a
 * keyboard user tabbing through the page can never land here and lose their
 * visible focus indicator. Without it, every route change briefly shows a
 * stray outline line at the top of `<main>` (originally observed right
 * under the old top mobile nav bar) as `<main>` receives focus.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { loadProfile } from '../storage'
import { BottomNav } from './BottomNav'
import { FeedbackLink } from './FeedbackLink'
import { SettingsIcon } from './Icons'
import { NavRail } from './NavRail'
import { DevPuzzleToggle } from './devTools/DevPuzzleToggle'
import { applyPreferences } from './preferences/applyPreferences'
import { ROUTES, labelForPath } from './routes'
import { useRouteFocusAndScroll } from './useRouteFocusAndScroll'
import { useRouteTelemetry } from './useRouteTelemetry'
import './app.css'

export interface AppShellProps {
  children: ReactNode
}

// The two routes that already render their own real, visible <h1> — see
// this file's own top doc comment for why the sr-only <h1> below is
// skipped for exactly these two.
const PAGES_WITH_OWN_H1 = new Set<string>([ROUTES.legal.path, ROUTES.settings.path])

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useRouteFocusAndScroll(mainRef)
  // Launch instrumentation Item 1: same "AppShell is the one thing mounted
  // across every navigation" reasoning as useRouteFocusAndScroll above —
  // see useRouteTelemetry.ts's own doc comment for why this one does NOT
  // skip the first render.
  useRouteTelemetry()

  // v4 Phase 4.1 (Settings, for real): apply the stored theme/reduced-motion/
  // code-font-size preferences to the document root once, on first mount.
  // AppShell is the one thing mounted across every route (see this file's
  // own top doc comment), so this is the single natural place to do it —
  // every page benefits without each page loading the profile itself.
  // SettingsPage calls applyPreferences again immediately after any save,
  // for instant same-tab feedback; this effect only covers first load.
  useEffect(() => {
    let cancelled = false
    loadProfile()
      .then((profile) => {
        if (!cancelled) applyPreferences(profile.preferences)
      })
      .catch(() => {
        // Preferences failing to load is a cosmetic no-op (the DOM simply
        // keeps its un-attributed defaults, which already match
        // DEFAULT_PREFERENCES) — not worth a user-visible error state.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app-shell">
      {/* v4 Phase 4.0 follow-up (PR #88 review): keyboard-only players
       * reported having to Tab through the entire NavRail (7 links) every
       * time they wanted to get back into the puzzle after tabbing out to
       * the footer — there was no way back in except walking the whole
       * chain again (or Shift+Tab-ing back through it). Standard fix: a
       * skip link, the very first tab stop on any page, invisible until
       * focused (`sr-only` → `focus:not-sr-only`), that jumps straight to
       * `<main>` via the native fragment-focus behavior `href="#main-
       * content"` gets for free on a focusable target — no onClick/JS
       * needed. Tabbing forward off the end of the page and back around
       * now lands here first instead of back at the top of NavRail. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-md focus:bg-accent focus:text-accent-ink focus:no-underline focus:text-md focus:font-semibold"
      >
        Skip to main content
      </a>
      {/* 2b.0: was `.app-shell__mobile-nav` (app.css) — display toggle now
       * inline. 2b.8: slimmed to just the brand link — the old ModeSwitcher
       * tab strip that lived here moved to BottomNav, fixed at the viewport
       * bottom (see below and BottomNav.tsx's own doc comment).
       *
       * 2b.9 (spacing bug, 2026-08-21 — corrected): this bar IS the element
       * that must own `env(safe-area-inset-top)` — it's the first thing in
       * the DOM, rendered at the true top of the viewport, directly under
       * the notch/Dynamic Island. A first attempt at this fix removed the
       * inset from here instead (reasoning that every page root below also
       * adds it, so this looked like the duplicate) — that shipped with the
       * logo bar rendering with zero notch clearance, visibly overlapping
       * the OS status bar. The actual duplicate was never here: every page
       * root re-adding `env(safe-area-inset-top)` on top of an already-
       * cleared position (they render *below* this bar in normal flow, not
       * at the viewport edge) is what doubles the inset. The real fix
       * removes it from each page root instead — see PracticePage.tsx/
       * DailyPage.tsx/PuzzlePage.tsx/etc.'s own `pt-[var(--space-N)]`
       * (no `+env(...)`) for the other half of this. */}
      <div className="flex items-center justify-between gap-2 lg:hidden pt-[calc(var(--space-2)+env(safe-area-inset-top))] px-4">
        <Link
          href="/"
          className="flex items-center gap-2 min-h-11 py-2 bg-transparent no-underline cursor-pointer"
          aria-label="Codoro — Home"
        >
          <div
            className="flex items-center justify-center w-7 h-7 flex-none rounded-sm bg-accent text-accent-ink font-mono font-bold text-md"
            aria-hidden="true"
          >
            C
          </div>
          <span className="text-xl font-bold text-text-0">Codoro</span>
        </Link>
        {/* v4 Phase 4.1: Settings' mobile nav entry point (this bar was
         * logo-only before) — BottomNav's own 4 items (Home/Practice/Daily/
         * Stats) are deliberately capped, so Settings doesn't compete for a
         * 5th slot there (see BottomNav.tsx's own doc comment); a gear here
         * costs nothing extra to reach at every width. */}
        <Link
          href={ROUTES.settings.path}
          className="min-w-11 min-h-11 flex items-center justify-center rounded-sm bg-transparent cursor-pointer"
          aria-current={location === ROUTES.settings.path ? 'page' : undefined}
          aria-label="Settings"
        >
          <span className={location === ROUTES.settings.path ? 'text-accent' : 'text-text-1'}>
            <SettingsIcon size={22} />
          </span>
        </Link>
      </div>
      {/* 2b.0: was `.app-shell__rail` (app.css) — display toggle now inline.
       * `app-shell__nav` (app.css) gives this wrapper an explicit grid area
       * spanning both outer rows (main content + footer), not just row 1 —
       * see that rule's own comment for why NavRail's sticky positioning
       * needs the full page height as its containing block. */}
      <div className="hidden lg:block app-shell__nav">
        <NavRail />
      </div>
      <BottomNav />
      <main
        id="main-content"
        className="app-shell__content focus:outline-none"
        ref={mainRef}
        tabIndex={-1}
        aria-label={labelForPath(location)}
      >
        {!PAGES_WITH_OWN_H1.has(location) && <h1 className="sr-only">{labelForPath(location)}</h1>}
        {children}
      </main>
      {/* 2b.8: bottom padding clears the fixed BottomNav (mobile only) —
       * without it, the footer's Settings/Legal links (and whatever
       * content sits just above them) end up hidden behind the bar once
       * scrolled to the end of the page. --bottom-nav-height is BottomNav's
       * own height; env(safe-area-inset-bottom) matches the same safe-area
       * padding BottomNav itself adds beneath that. */}
      <footer className="app-shell__footer flex justify-center p-4 pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+var(--space-4))] lg:pb-4 border-t border-border">
        <Link
          href={ROUTES.settings.path}
          className="min-h-11 px-3 py-2 bg-transparent text-text-1 text-sm no-underline cursor-pointer inline-flex items-center"
        >
          Settings
        </Link>
        <Link
          href={ROUTES.legal.path}
          className="min-h-11 px-3 py-2 bg-transparent text-text-1 text-sm no-underline cursor-pointer inline-flex items-center"
        >
          Legal
        </Link>
        <FeedbackLink
          surface="footer"
          className="min-h-11 px-3 py-2 bg-transparent text-text-1 text-sm no-underline cursor-pointer inline-flex items-center"
        />
      </footer>
      <DevPuzzleToggle />
    </div>
  )
}
