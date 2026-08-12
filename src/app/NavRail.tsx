/**
 * Desktop (>=1024px) left nav rail — chess.com-style shell's fixed left
 * region: logo, mode entries, room to grow. Visibility (not existence) is
 * CSS-driven (`app.css`'s `.app-shell__rail`, shown only >=1024px) so the
 * component has no matchMedia/JS breakpoint logic of its own; it renders
 * unconditionally and the shell decides when it's visible. Mirrors
 * ModeSwitcher's Practice/Daily/disabled-Rush entries — kept as a separate
 * component (not a CSS reskin of ModeSwitcher) because the rail is a
 * vertical logo+nav block, not a horizontal tab strip, and forcing one
 * component to render both shapes via className soup was harder to follow
 * than two small components sharing app.css tokens.
 *
 * The reference design (2a/2c/2d) shows a "Browse patterns" affordance
 * pinned to the rail footer. It isn't rendered here: /browse is a real
 * route now (v2 Phase 1a), so a plain `<Link href="/browse">` here would
 * work, but it would duplicate the one working entry point PracticePage's
 * own nav row (practicePage.css) already provides, visible at every width.
 * Revisit if/when Browse earns a dedicated rail entry on its own merits,
 * not as a routing-capability question — that part is already solved.
 *
 * Collapse state: a device-level UI preference, not app data — persisted to
 * `localStorage` (key convention from pwa/useIosInstallPrompt.ts: `codoro:`
 * prefix, wrapped in try/catch for Safari private browsing), never routed
 * through src/storage/'s IndexedDB profile. Read synchronously in the
 * `useState` initializer (same pattern as useMediaQuery.ts's
 * useSyncExternalStore snapshot) so there's no flash-then-collapse on
 * mount and no effect-driven setState to trip the set-state-in-effect
 * lint rule.
 *
 * app.css picks up the collapsed state via a `:has(.nav-rail--collapsed)`
 * selector on `.app-shell` rather than a prop threaded down from AppShell —
 * nothing outside this component needs to know the rail is collapsed, so
 * there's no reason to lift the state up.
 *
 * Mode entries are real `<Link>`s (real `<a href>`s under the hood), not
 * buttons with onClick handlers — cmd/middle-click opening a new tab is
 * most of the point of having URLs (v2 Phase 1a). Active state is
 * `aria-current="page"`, not `aria-pressed`: these are navigation links,
 * not toggle buttons.
 */
import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  BossIcon,
  CollapseIcon,
  DailyIcon,
  MissionIcon,
  PracticeIcon,
  RushIcon,
  TraceIcon,
} from './Icons'
import { ROUTES } from './routes'

const COLLAPSED_KEY = 'codoro:nav-rail-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Safari private browsing (and similar) can throw — worst case the
    // preference doesn't persist, which is fine.
  }
}

// 2b.0: nav-rail item base/active utilities, built once instead of repeated
// per link (was `.nav-rail__item`/`--active` in app.css). The collapsed
// variant swaps px-4→px-3 and adds justify-center (icon-only, was the
// `.nav-rail--collapsed .nav-rail__item` descendant rule).
const ITEM_BASE =
  'flex items-center gap-2.5 min-h-11 py-3 rounded-sm bg-transparent text-text-1 text-md font-semibold text-left no-underline cursor-pointer'
const ITEM_ACTIVE = 'bg-accent text-accent-ink'

function itemClass(collapsed: boolean, active: boolean): string {
  const width = collapsed ? 'px-3 justify-center' : 'px-4'
  return active ? `${ITEM_BASE} ${width} ${ITEM_ACTIVE}` : `${ITEM_BASE} ${width}`
}

export function NavRail() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [location] = useLocation()

  // 2b.0: width/padding used to come from `.nav-rail`/`.nav-rail--collapsed`
  // in app.css; only the bare `nav-rail--collapsed` classname stays literal
  // (no styles of its own) because `.app-shell`'s `:has(.nav-rail--collapsed)`
  // rule still needs it in the DOM to react to the collapsed state.
  const navClass = collapsed
    ? 'nav-rail--collapsed flex flex-col gap-2 py-6 px-2.5 sticky top-0 h-screen border-r border-border w-[var(--nav-rail-width-collapsed)] transition-[width] duration-150 ease-out'
    : 'flex flex-col gap-2 py-6 px-4 sticky top-0 h-screen border-r border-border w-[var(--nav-rail-width)] transition-[width] duration-150 ease-out'
  const brandClass = collapsed
    ? 'flex items-center justify-center pb-4'
    : 'flex items-center gap-2.5 px-2 pb-4'

  return (
    <nav className={navClass} aria-label="Mode">
      <Link
        href="/"
        className={`${brandClass} bg-transparent no-underline cursor-pointer min-h-11`}
        aria-label="Home"
      >
        <div
          className="flex items-center justify-center w-7 h-7 flex-none rounded-sm bg-accent text-accent-ink font-mono font-bold text-md"
          aria-hidden="true"
        >
          C
        </div>
        {!collapsed && <span className="text-xl font-bold text-text-0">Codoro</span>}
      </Link>
      <Link
        href={ROUTES.practice.path}
        className={itemClass(collapsed, location === ROUTES.practice.path)}
        aria-current={location === ROUTES.practice.path ? 'page' : undefined}
        aria-label="Practice"
        title="Practice"
      >
        <PracticeIcon size={20} />
        {!collapsed && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">Practice</span>
        )}
      </Link>
      <Link
        href={ROUTES.daily.path}
        className={itemClass(collapsed, location === ROUTES.daily.path)}
        aria-current={location === ROUTES.daily.path ? 'page' : undefined}
        aria-label="Daily"
        title="Daily"
      >
        <DailyIcon size={20} />
        {!collapsed && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">Daily</span>
        )}
      </Link>
      <Link
        href={ROUTES.rush.path}
        className={itemClass(collapsed, location === ROUTES.rush.path)}
        aria-current={location === ROUTES.rush.path ? 'page' : undefined}
        aria-label="Rush"
        title="Rush"
      >
        <RushIcon size={20} />
        {!collapsed && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">Rush</span>
        )}
      </Link>
      <Link
        href={ROUTES.boss.path}
        className={itemClass(collapsed, location === ROUTES.boss.path)}
        aria-current={location === ROUTES.boss.path ? 'page' : undefined}
        aria-label="Boss"
        title="Boss"
      >
        <BossIcon size={20} />
        {!collapsed && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">Boss</span>
        )}
      </Link>
      <Link
        href={ROUTES.trace.path}
        className={itemClass(collapsed, location === ROUTES.trace.path)}
        aria-current={location === ROUTES.trace.path ? 'page' : undefined}
        aria-label="Trace"
        title="Trace"
      >
        <TraceIcon size={20} />
        {!collapsed && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">Trace</span>
        )}
      </Link>
      <Link
        href={ROUTES.missions.path}
        className={itemClass(collapsed, location === ROUTES.missions.path)}
        aria-current={location === ROUTES.missions.path ? 'page' : undefined}
        aria-label="Missions"
        title="Missions"
      >
        <MissionIcon size={20} />
        {!collapsed && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">Missions</span>
        )}
      </Link>
      <button
        type="button"
        className="mt-auto min-w-11 min-h-11 flex items-center justify-center border border-border rounded-sm bg-transparent text-text-1 cursor-pointer"
        aria-pressed={collapsed}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        onClick={() => {
          setCollapsed((prev) => {
            const next = !prev
            writeCollapsed(next)
            return next
          })
        }}
      >
        <span
          className="inline-flex transition-transform duration-150 ease-out"
          style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}
        >
          <CollapseIcon size={18} />
        </span>
      </button>
    </nav>
  )
}
