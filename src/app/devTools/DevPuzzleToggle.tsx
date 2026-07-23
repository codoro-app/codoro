/**
 * Floating dev-only switch between the real puzzle pool and the trivial
 * DEV_STUB_PUZZLES set (src/content/devPuzzles.ts) — see devPuzzleMode.ts's
 * doc comment for the full gating story.
 *
 * Only ever mounted when `import.meta.env.DEV` (see AppShell.tsx) — but it
 * also self-checks at render time and renders nothing outside DEV, so an
 * accidental unconditional import can never surface it in a built app.
 *
 * Toggling reloads the page rather than live-swapping an in-progress
 * session's pool (see devPuzzleMode.ts) — simplest correct behavior, and
 * "reload into the other pool" is still effectively instant.
 */
import { isDevPuzzleModeEnabled, setDevPuzzleMode } from './devPuzzleMode'

export function DevPuzzleToggle() {
  if (!import.meta.env.DEV) return null

  const enabled = isDevPuzzleModeEnabled()

  return (
    <button
      type="button"
      className="dev-puzzle-toggle"
      aria-pressed={enabled}
      title={
        enabled
          ? 'DEV: serving stub puzzles — click to switch back to real content'
          : 'DEV: serving real content — click to switch to stub puzzles'
      }
      onClick={() => {
        setDevPuzzleMode(!enabled)
        window.location.reload()
      }}
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9999,
        padding: '6px 10px',
        borderRadius: 999,
        border: '1px solid #fff',
        background: enabled ? '#e0433c' : '#1a1a1a',
        color: '#fff',
        fontSize: 11,
        fontFamily: 'monospace',
        cursor: 'pointer',
        opacity: 0.85,
      }}
    >
      {enabled ? 'DEV: STUB PUZZLES' : 'DEV: real content'}
    </button>
  )
}
