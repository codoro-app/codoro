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
 * screen-reader users landing there, since not every page has its own
 * visible `<h1>` (only LegalPage does) to move focus to instead.
 * `focus:outline-none` suppresses the browser's default focus ring on
 * `<main>` — safe only because it's never in the sighted tab order, so a
 * keyboard user tabbing through the page can never land here and lose their
 * visible focus indicator. Without it, every route change briefly shows a
 * stray outline line at the top of `<main>` (originally observed right
 * under the old top mobile nav bar) as `<main>` receives focus.
 */
import { useRef, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { BottomNav } from './BottomNav'
import { NavRail } from './NavRail'
import { DevPuzzleToggle } from './devTools/DevPuzzleToggle'
import { ROUTES, labelForPath } from './routes'
import { useRouteFocusAndScroll } from './useRouteFocusAndScroll'
import './app.css'

export interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useRouteFocusAndScroll(mainRef)

  return (
    <div className="app-shell">
      {/* 2b.0: was `.app-shell__mobile-nav` (app.css) — display toggle now
       * inline. 2b.8: slimmed to just the brand link — the old ModeSwitcher
       * tab strip that lived here moved to BottomNav, fixed at the viewport
       * bottom (see below and BottomNav.tsx's own doc comment).
       *
       * 2b.9 (spacing bug, 2026-08-21): top padding is flat `space-2` only —
       * no `env(safe-area-inset-top)` here. Every page root below (Practice/
       * Daily/Puzzle/Home/etc.) already adds its own
       * `pt-[calc(var(--space-N)+env(safe-area-inset-top))]`; this bar sits
       * above all of them and was *also* adding the inset, so the notch
       * safe-area was being applied twice, stacked, producing a visibly
       * oversized gap between this bar and each page's first content. This
       * bar is the one place in the app that isn't itself a page root, so it
       * has no independent reason to own the inset — the page below it
       * already does. Fixing it here (not in every page) corrects the gap
       * app-wide from a single change instead of touching a dozen files. */}
      <div className="block lg:hidden pt-[var(--space-2)] px-4">
        <Link
          href="/"
          className="flex items-center gap-2 min-h-11 py-2 bg-transparent no-underline cursor-pointer"
          aria-label="Home"
        >
          <div
            className="flex items-center justify-center w-7 h-7 flex-none rounded-sm bg-accent text-accent-ink font-mono font-bold text-md"
            aria-hidden="true"
          >
            C
          </div>
          <span className="text-xl font-bold text-text-0">Codoro</span>
        </Link>
      </div>
      {/* 2b.0: was `.app-shell__rail` (app.css) — display toggle now inline. */}
      <div className="hidden lg:block">
        <NavRail />
      </div>
      <BottomNav />
      <main
        className="app-shell__content focus:outline-none"
        ref={mainRef}
        tabIndex={-1}
        aria-label={labelForPath(location)}
      >
        {children}
      </main>
      {/* 2b.8: bottom padding clears the fixed BottomNav (mobile only) —
       * without it, the footer's Settings/Legal links (and whatever
       * content sits just above them) end up hidden behind the bar once
       * scrolled to the end of the page. --bottom-nav-height is BottomNav's
       * own height; env(safe-area-inset-bottom) matches the same safe-area
       * padding BottomNav itself adds beneath that. */}
      <footer className="flex justify-center p-4 pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+var(--space-4))] lg:pb-4 border-t border-border lg:col-span-full">
        <Link
          href={ROUTES.settings.path}
          className="min-h-11 px-3 py-2 bg-transparent text-text-2 text-sm no-underline cursor-pointer inline-flex items-center"
        >
          Settings
        </Link>
        <Link
          href={ROUTES.legal.path}
          className="min-h-11 px-3 py-2 bg-transparent text-text-2 text-sm no-underline cursor-pointer inline-flex items-center"
        >
          Legal
        </Link>
      </footer>
      <DevPuzzleToggle />
    </div>
  )
}
