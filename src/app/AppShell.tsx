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
 */
import type { ReactNode } from 'react'
import { ModeSwitcher } from './ModeSwitcher'
import type { AppMode } from './ModeSwitcher'
import { NavRail } from './NavRail'
import './app.css'

export interface AppShellProps {
  mode: AppMode
  onModeChange: (mode: AppMode) => void
  children: ReactNode
}

export function AppShell({ mode, onModeChange, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__mobile-nav">
        <button
          type="button"
          className="app-shell__mobile-brand"
          aria-label="Home"
          onClick={() => {
            onModeChange('home')
          }}
        >
          <div className="nav-rail__logo-mark" aria-hidden="true">
            C
          </div>
          <span className="nav-rail__wordmark">Codoro</span>
        </button>
        <ModeSwitcher mode={mode} onChange={onModeChange} />
      </div>
      <div className="app-shell__rail">
        <NavRail mode={mode} onChange={onModeChange} />
      </div>
      <main className="app-shell__content">{children}</main>
    </div>
  )
}
