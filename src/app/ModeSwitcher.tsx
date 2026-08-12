/**
 * Minimal tab switcher between Practice, Daily, Rush, and Trace — no
 * routing library beyond wouter's <Link>, per the build plan's "keep it
 * minimal" instruction for reaching additional screens. Plain-text tabs,
 * same no-icon-library convention as StatusBar's pills. Each new mode's tab
 * reuses the exact same markup as the ones before it (Rush at Phase 7,
 * Trace here) rather than introducing new nav layout.
 *
 * Tabs are real `<Link>`s (real `<a href>`s), not buttons — cmd/middle-click
 * opening a new tab is most of the point of having URLs (v2 Phase 1a).
 * Active state is `aria-current="page"`, not `aria-pressed`: these are
 * navigation links, not toggle buttons.
 */
import { Link, useLocation } from 'wouter'
import { ROUTES } from './routes'

// 2b.0: base + active-state utilities live here once instead of repeating
// the full string per tab (was `.mode-switcher__tab`/`--active` in app.css).
const TAB_BASE =
  'flex-1 flex items-center justify-center min-h-11 py-2 px-4 rounded-xs bg-transparent text-text-1 text-md font-semibold text-center no-underline cursor-pointer'
const TAB_ACTIVE = 'bg-accent text-accent-ink'

function tabClass(active: boolean): string {
  return active ? `${TAB_BASE} ${TAB_ACTIVE}` : TAB_BASE
}

export function ModeSwitcher() {
  const [location] = useLocation()

  return (
    // Pre-existing bug, fixed here (not part of 2b.0/2b.1's own scope):
    // TAB_BASE's `flex-1` tabs default to `min-width: auto` (their
    // min-content size), so once 6 tabs' combined min-content width exceeds
    // this bar's own box (narrow viewports), they refuse to shrink further
    // and overflow — with nothing here or on any ancestor setting
    // `overflow`, that overflow bled into the page itself. `overflow-x-auto`
    // contains it as a horizontal scroll region on the bar instead.
    // Deliberately keeps `flex-1` (not `flex-none`): min-width:auto already
    // floors each tab at content width once squeezed (that's the bug
    // itself), so `flex-1` behaves identically to `flex-none` in the
    // overflow case — but unlike `flex-none`, it still stretches tabs to
    // fill the bar evenly on every viewport where they already fit today.
    <nav
      className="flex gap-1 overflow-x-auto bg-surface-1 border border-border rounded-sm p-1"
      aria-label="Mode"
    >
      <Link
        href={ROUTES.practice.path}
        className={tabClass(location === ROUTES.practice.path)}
        aria-current={location === ROUTES.practice.path ? 'page' : undefined}
      >
        Practice
      </Link>
      <Link
        href={ROUTES.daily.path}
        className={tabClass(location === ROUTES.daily.path)}
        aria-current={location === ROUTES.daily.path ? 'page' : undefined}
      >
        Daily
      </Link>
      <Link
        href={ROUTES.rush.path}
        className={tabClass(location === ROUTES.rush.path)}
        aria-current={location === ROUTES.rush.path ? 'page' : undefined}
      >
        Rush
      </Link>
      <Link
        href={ROUTES.boss.path}
        className={tabClass(location === ROUTES.boss.path)}
        aria-current={location === ROUTES.boss.path ? 'page' : undefined}
      >
        Boss
      </Link>
      <Link
        href={ROUTES.trace.path}
        className={tabClass(location === ROUTES.trace.path)}
        aria-current={location === ROUTES.trace.path ? 'page' : undefined}
      >
        Trace
      </Link>
      <Link
        href={ROUTES.missions.path}
        className={tabClass(location === ROUTES.missions.path)}
        aria-current={location === ROUTES.missions.path ? 'page' : undefined}
      >
        Missions
      </Link>
    </nav>
  )
}
