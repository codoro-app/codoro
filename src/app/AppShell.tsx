/**
 * Top-level responsive shell. <1024px: single column, current behavior —
 * ModeSwitcher's horizontal tab strip on top, then whatever page is active,
 * full width. >=1024px: chess.com-style three-region grid — a fixed left
 * NavRail, and a content region where the active page itself decides (via
 * `useMediaQuery` + its own markup) whether to render a right-hand sidebar
 * alongside its main column; see PracticePage.tsx/DailyPage.tsx.
 *
 * Both ModeSwitcher and NavRail are always mounted — neither has side
 * effects, so there is no cost to rendering both and letting app.css's
 * media queries decide which is visible at a given width. This keeps nav
 * visibility pure-CSS, consistent with the "CSS grid + media queries, no
 * JS breakpoint logic" rule for layout — the one place this shell *does*
 * use a JS breakpoint check (`useMediaQuery`) is reserved for gating
 * components with real side effects (data fetches), not for positioning.
 *
 * No mode/onModeChange props (v2 Phase 1a): NavRail/ModeSwitcher read the
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
 */
import { useRef, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { ModeSwitcher } from './ModeSwitcher'
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
      {/* 2b.0: was `.app-shell__mobile-nav` (app.css) — display toggle now inline. */}
      <div className="block lg:hidden pt-[calc(var(--space-2)+env(safe-area-inset-top))] px-4">
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
        <ModeSwitcher />
      </div>
      {/* 2b.0: was `.app-shell__rail` (app.css) — display toggle now inline. */}
      <div className="hidden lg:block">
        <NavRail />
      </div>
      <main
        className="app-shell__content"
        ref={mainRef}
        tabIndex={-1}
        aria-label={labelForPath(location)}
      >
        {children}
      </main>
      <footer className="flex justify-center p-4 border-t border-border lg:col-span-full">
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
