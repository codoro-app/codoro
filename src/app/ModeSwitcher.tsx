/**
 * Minimal three-tab switcher between Practice, Daily, and Rush — no routing
 * library, per the build plan's "keep it minimal" instruction for reaching
 * additional screens. Plain-text tabs, same no-icon-library convention as
 * StatusBar's pills. Rush's tab reuses the exact same markup as Practice/
 * Daily (Phase 7 enabled it here rather than introducing new nav layout).
 */
import './app.css'

export type AppMode = 'practice' | 'daily' | 'rush' | 'home' | 'legal'

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
        className={`mode-switcher__tab${mode === 'rush' ? ' mode-switcher__tab--active' : ''}`}
        aria-pressed={mode === 'rush'}
        onClick={() => {
          onChange('rush')
        }}
      >
        Rush
      </button>
    </nav>
  )
}
