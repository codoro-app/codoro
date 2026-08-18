/**
 * Mobile (<1024px) bottom tab bar — v3 Phase 2b.8, replacing ModeSwitcher's
 * top strip as the primary way to navigate on mobile. Fixed to the viewport
 * bottom (not `sticky`, unlike PageShell's header/stickyAction slots — this
 * bar isn't part of any one page's own scroll content, it's shell chrome
 * that has to stay put across every route) so it's always thumb-reachable,
 * the standard mobile pattern.
 *
 * Four items — Home, Practice, Daily, Stats — not all six mode routes:
 * bottom bars should stay at or under ~5 items (overload doesn't read as
 * "here are your options", it reads as noise), and Home's own card grid
 * already gives one-tap access to Rush/Boss/Trace/Missions from the tab
 * this bar's Home item leads to. See this phase's design record for the
 * full reasoning — this is a deliberate scope decision, not an oversight.
 *
 * aria-label="Primary" (not "Mode", which NavRail already uses) — this bar
 * includes Home and Stats, so "Mode" would undersell what's in it. Visible
 * throughout via `lg:hidden`; NavRail's `hidden lg:block` wrapper is the
 * complementary half of the same CSS-only visibility split AppShell.tsx
 * already uses for ModeSwitcher/NavRail — see AppShell.tsx's own comment.
 *
 * `env(safe-area-inset-bottom)` padding matches the convention already
 * established in pwa/IosInstallSheet.tsx and pwa/UpdatePrompt.tsx for
 * fixed-bottom UI. `--bottom-nav-height` (index.css) is this bar's own
 * height *excluding* that safe-area padding — PageShell's stickyAction slot
 * and AppShell's footer both offset by that token to stay clear of the bar.
 *
 * Items are real `<Link>`s, not buttons — same reasoning as
 * ModeSwitcher/NavRail: cmd/middle-click opening a new tab is most of the
 * point of having URLs. Active state is `aria-current="page"`, not
 * `aria-pressed`, for the same "navigation, not a toggle" reason.
 */
import { Link, useLocation } from 'wouter'
import { DailyIcon, HomeIcon, PracticeIcon, StatsIcon } from './Icons'
import { ROUTES } from './routes'

const ITEM_BASE =
  'flex-1 flex flex-col items-center justify-center gap-0.5 min-h-11 py-1.5 bg-transparent text-text-1 text-xs font-semibold no-underline cursor-pointer'
const ITEM_ACTIVE = 'text-accent'

function itemClass(active: boolean): string {
  return active ? `${ITEM_BASE} ${ITEM_ACTIVE}` : ITEM_BASE
}

export function BottomNav() {
  const [location] = useLocation()

  return (
    <nav
      className="lg:hidden fixed inset-x-0 bottom-0 z-20 flex bg-surface-1 border-t border-border pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      <Link
        href="/"
        className={itemClass(location === '/')}
        aria-current={location === '/' ? 'page' : undefined}
      >
        <HomeIcon size={20} />
        Home
      </Link>
      <Link
        href={ROUTES.practice.path}
        className={itemClass(location === ROUTES.practice.path)}
        aria-current={location === ROUTES.practice.path ? 'page' : undefined}
      >
        <PracticeIcon size={20} />
        Practice
      </Link>
      <Link
        href={ROUTES.daily.path}
        className={itemClass(location === ROUTES.daily.path)}
        aria-current={location === ROUTES.daily.path ? 'page' : undefined}
      >
        <DailyIcon size={20} />
        Daily
      </Link>
      <Link
        href={ROUTES.stats.path}
        className={itemClass(location === ROUTES.stats.path)}
        aria-current={location === ROUTES.stats.path ? 'page' : undefined}
      >
        <StatsIcon size={20} />
        Stats
      </Link>
    </nav>
  )
}
