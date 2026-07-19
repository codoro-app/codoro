/**
 * "Update available — refresh" banner — the visible half of the update
 * flow described in useUpdatePrompt.ts. Renders nothing until a new
 * service worker is actually waiting; "Later" hides it for this session
 * without discarding the waiting worker, so it reappears on next launch
 * (or immediately, if another deploy lands in the meantime).
 */
import { useUpdatePrompt } from './useUpdatePrompt'
import './pwa.css'

export function UpdatePrompt() {
  const { state, refresh, dismiss } = useUpdatePrompt()

  if (state === 'idle') return null

  return (
    <div className="update-prompt" role="status">
      <span className="update-prompt__message">
        {state === 'refreshing' ? 'Updating…' : 'Update available — refresh for the latest version'}
      </span>
      <div className="update-prompt__actions">
        <button
          type="button"
          className="update-prompt__refresh"
          onClick={refresh}
          disabled={state === 'refreshing'}
        >
          Refresh
        </button>
        {state === 'needs-refresh' && (
          <button type="button" className="update-prompt__dismiss" onClick={dismiss}>
            Later
          </button>
        )}
      </div>
    </div>
  )
}
