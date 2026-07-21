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
 */
import type { AppMode } from './ModeSwitcher'

export interface NavRailProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function NavRail({ mode, onChange }: NavRailProps) {
  return (
    <nav className="nav-rail" aria-label="Mode">
      <p className="nav-rail__logo">Codoro</p>
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
    </nav>
  )
}
