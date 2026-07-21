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
 * Rail-bottom "Browse patterns" affordance (v2 Arena, matches the
 * reference's 2a/2c/2d rail footer, shown regardless of active mode): it
 * lives here rather than in PracticePage.tsx because the reference always
 * renders it in the shared rail chrome, not inside the Practice page's own
 * content column. NavRail has no visibility into PracticePage's internal
 * "view" state (patterns/mastery/practice) though — that's owned by
 * usePracticeSession's caller, several component boundaries away, and
 * lifting it up to bridge NavRail and PracticePage is out of this task's
 * scope. So this button's click only switches the active mode to
 * 'practice' via the existing onChange prop; it does not (yet) deep-link
 * into the pattern-filter picker itself. Flagged as a known gap.
 */
import type { AppMode } from './ModeSwitcher'

export interface NavRailProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function NavRail({ mode, onChange }: NavRailProps) {
  return (
    <nav className="nav-rail" aria-label="Mode">
      <div className="nav-rail__brand">
        <div className="nav-rail__logo-mark" aria-hidden="true">
          C
        </div>
        <span className="nav-rail__wordmark">Codoro</span>
      </div>
      <button
        type="button"
        className={`nav-rail__item${mode === 'practice' ? ' nav-rail__item--active' : ''}`}
        aria-pressed={mode === 'practice'}
        onClick={() => {
          onChange('practice')
        }}
      >
        Practice
      </button>
      <button
        type="button"
        className={`nav-rail__item${mode === 'daily' ? ' nav-rail__item--active' : ''}`}
        aria-pressed={mode === 'daily'}
        onClick={() => {
          onChange('daily')
        }}
      >
        Daily
      </button>
      <button
        type="button"
        className="nav-rail__item nav-rail__item--disabled"
        disabled
        aria-disabled="true"
        title="Coming soon"
      >
        Rush — coming soon
      </button>
      <div className="nav-rail__footer">
        <button
          type="button"
          className="nav-rail__browse"
          onClick={() => {
            onChange('practice')
          }}
        >
          <span>Browse patterns</span>
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>
    </nav>
  )
}
