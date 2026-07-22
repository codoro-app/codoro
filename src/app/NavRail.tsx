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
 * pinned to the rail footer. It isn't rendered here: NavRail has no
 * visibility into PracticePage's internal "view" state (patterns/mastery/
 * practice) — that's owned by usePracticeSession's caller, several
 * component boundaries away — so a rail-footer button here could only ever
 * switch to Practice mode, not actually open the pattern picker. Rather
 * than ship a button that looks actionable but does nothing new, the one
 * working "Browse patterns" entry point stays in PracticePage.tsx's own
 * nav row (practicePage.css), visible at every width. Revisit if/when
 * that view state is worth lifting up to bridge NavRail and PracticePage.
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
 */
import { useState } from 'react'
import type { AppMode } from './ModeSwitcher'
import { CollapseIcon } from './Icons'

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

export interface NavRailProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function NavRail({ mode, onChange }: NavRailProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const itemLabel = (label: string) => (collapsed ? undefined : label)

  return (
    <nav className={`nav-rail${collapsed ? ' nav-rail--collapsed' : ''}`} aria-label="Mode">
      <div className="nav-rail__brand">
        <div className="nav-rail__logo-mark" aria-hidden="true">
          C
        </div>
        {!collapsed && <span className="nav-rail__wordmark">Codoro</span>}
      </div>
      <button
        type="button"
        className={`nav-rail__item${mode === 'practice' ? ' nav-rail__item--active' : ''}`}
        aria-pressed={mode === 'practice'}
        aria-label="Practice"
        title="Practice"
        onClick={() => {
          onChange('practice')
        }}
      >
        {itemLabel('Practice')}
      </button>
      <button
        type="button"
        className={`nav-rail__item${mode === 'daily' ? ' nav-rail__item--active' : ''}`}
        aria-pressed={mode === 'daily'}
        aria-label="Daily"
        title="Daily"
        onClick={() => {
          onChange('daily')
        }}
      >
        {itemLabel('Daily')}
      </button>
      <button
        type="button"
        className="nav-rail__item nav-rail__item--disabled"
        disabled
        aria-disabled="true"
        aria-label="Rush — coming soon"
        title="Rush — coming soon"
      >
        {itemLabel('Rush — coming soon')}
      </button>
      <button
        type="button"
        className="nav-rail__collapse-toggle"
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
          className="nav-rail__collapse-icon"
          style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}
        >
          <CollapseIcon size={18} />
        </span>
      </button>
    </nav>
  )
}
