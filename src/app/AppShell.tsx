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
      <div className="app-shell__mobile-nav">
        <Link href="/" className="app-shell__mobile-brand" aria-label="Home">
          <div className="nav-rail__logo-mark" aria-hidden="true">
            C
          </div>
          <span className="nav-rail__wordmark">Codoro</span>
        </Link>
        <ModeSwitcher />
      </div>
      <div className="app-shell__rail">
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
      <footer className="app-shell__footer">
        <Link href={ROUTES.settings.path} className="app-shell__footer-link">
          Settings
        </Link>
        <Link href={ROUTES.legal.path} className="app-shell__footer-link">
          Legal
        </Link>
      </footer>
      <DevPuzzleToggle />
    </div>
  )
}
