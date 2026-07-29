/**
 * Minimal three-tab switcher between Practice, Daily, and Rush — no routing
 * library beyond wouter's <Link>, per the build plan's "keep it minimal"
 * instruction for reaching additional screens. Plain-text tabs, same
 * no-icon-library convention as StatusBar's pills. Rush's tab reuses the
 * exact same markup as Practice/Daily (Phase 7 enabled it here rather than
 * introducing new nav layout).
 *
 * Tabs are real `<Link>`s (real `<a href>`s), not buttons — cmd/middle-click
 * opening a new tab is most of the point of having URLs (v2 Phase 1a).
 * Active state is `aria-current="page"`, not `aria-pressed`: these are
 * navigation links, not toggle buttons.
 */
import { Link, useLocation } from 'wouter'
import { ROUTES } from './routes'
import './app.css'

export function ModeSwitcher() {
  const [location] = useLocation()

  return (
    <nav className="mode-switcher" aria-label="Mode">
      <Link
        href={ROUTES.practice.path}
        className={`mode-switcher__tab${location === ROUTES.practice.path ? ' mode-switcher__tab--active' : ''}`}
        aria-current={location === ROUTES.practice.path ? 'page' : undefined}
      >
        Practice
      </Link>
      <Link
        href={ROUTES.daily.path}
        className={`mode-switcher__tab${location === ROUTES.daily.path ? ' mode-switcher__tab--active' : ''}`}
        aria-current={location === ROUTES.daily.path ? 'page' : undefined}
      >
        Daily
      </Link>
      <Link
        href={ROUTES.rush.path}
        className={`mode-switcher__tab${location === ROUTES.rush.path ? ' mode-switcher__tab--active' : ''}`}
        aria-current={location === ROUTES.rush.path ? 'page' : undefined}
      >
        Rush
      </Link>
    </nav>
  )
}
