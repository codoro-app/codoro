/**
 * "Update available — refresh" banner — the visible half of the update
 * flow described in useUpdatePrompt.ts. "Later" hides it for this session
 * without discarding the waiting worker, so it reappears on next launch
 * (or immediately, if another deploy lands in the meantime).
 *
 * Presentational: state/refresh/dismiss come from the caller (PwaPrompts)
 * rather than calling useUpdatePrompt itself, so PwaPrompts can own the
 * single hook instance it needs to decide precedence against
 * IosInstallSheet — both are fixed bottom overlays and can't show at once.
 */
import type { UpdatePromptState } from './useUpdatePrompt'
import './pwa.css'

export interface UpdatePromptProps {
  state: UpdatePromptState
  onRefresh: () => void
  onDismiss: () => void
}

export function UpdatePrompt({ state, onRefresh, onDismiss }: UpdatePromptProps) {
  return (
    <div className="update-prompt" role="status">
      <span className="update-prompt__message">
        {state === 'refreshing' ? 'Updating…' : 'Update available — refresh for the latest version'}
      </span>
      <div className="update-prompt__actions">
        <button
          type="button"
          className="update-prompt__refresh"
          onClick={onRefresh}
          disabled={state === 'refreshing'}
        >
          Refresh
        </button>
        {state === 'needs-refresh' && (
          <button type="button" className="update-prompt__dismiss" onClick={onDismiss}>
            Later
          </button>
        )}
      </div>
    </div>
  )
}
