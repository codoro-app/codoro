/**
 * Minimal two-tab switcher between Practice and Daily — no routing library,
 * per the build plan's "keep it minimal" instruction for reaching a second
 * screen. Plain-text tabs, same no-icon-library convention as StatusBar's
 * pills. A third, disabled "Rush" slot is visible now so Phase 7 (which
 * adds real Rush mode) is an enablement of this button, not a nav layout
 * change.
 */
import './app.css'

export type AppMode = 'practice' | 'daily' | 'home'

export interface ModeSwitcherProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  return (
    <nav className="mode-switcher" aria-label="Mode">
      <button
        type="button"
        className={`mode-switcher__tab${mode === 'practice' ? ' mode-switcher__tab--active' : ''}`}
        aria-pressed={mode === 'practice'}
        onClick={() => {
          onChange('practice')
        }}
      >
        Practice
      </button>
      <button
        type="button"
        className={`mode-switcher__tab${mode === 'daily' ? ' mode-switcher__tab--active' : ''}`}
        aria-pressed={mode === 'daily'}
        onClick={() => {
          onChange('daily')
        }}
      >
        Daily
      </button>
      <button
        type="button"
        className="mode-switcher__tab mode-switcher__tab--disabled"
        disabled
        aria-disabled="true"
        title="Coming soon"
      >
        Rush — coming soon
      </button>
    </nav>
  )
}
