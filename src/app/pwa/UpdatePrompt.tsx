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

// 2b.0: was `.update-prompt, .ios-install-sheet` shared base (pwa.css) —
// duplicated in IosInstallSheet.tsx too, same reasoning as that file's
// own comment.
const SHEET_BASE_CLASS =
  'fixed left-0 right-0 bottom-0 z-[100] py-3.5 px-4 pb-[calc(var(--space-3-5)+env(safe-area-inset-bottom))] bg-surface-1 border-t border-border'

export interface UpdatePromptProps {
  state: UpdatePromptState
  onRefresh: () => void
  onDismiss: () => void
}

export function UpdatePrompt({ state, onRefresh, onDismiss }: UpdatePromptProps) {
  return (
    <div
      className={`${SHEET_BASE_CLASS} flex items-center justify-between gap-3 flex-wrap`}
      role="status"
    >
      <span className="text-text-0 text-md font-semibold">
        {state === 'refreshing' ? 'Updating…' : 'Update available — refresh for the latest version'}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          // 2b.0: was `.update-prompt__refresh`'s border-bottom "lip" press
          // mechanic (pwa.css) — the one place this app keeps that
          // Duolingo-style treatment (see the file's own doc comment on why
          // pwa/ is exempt from the flat-button rule elsewhere). Tailwind's
          // bare `border-b` (1px) is the active-state width the 4px default
          // collapses to.
          className="min-h-11 py-2.5 px-5 border-0 border-b-4 border-b-accent-dim rounded-md bg-accent text-accent-ink text-md font-bold cursor-pointer transition-[transform,border-bottom-width,margin-bottom] duration-[0.05s] ease-out active:translate-y-[3px] active:border-b active:mb-[3px] disabled:opacity-70 disabled:cursor-default"
          onClick={onRefresh}
          disabled={state === 'refreshing'}
        >
          Refresh
        </button>
        {state === 'needs-refresh' && (
          <button
            type="button"
            className="min-h-11 py-2.5 px-3 border-0 bg-transparent text-text-1 text-md font-semibold cursor-pointer"
            onClick={onDismiss}
          >
            Later
          </button>
        )}
      </div>
    </div>
  )
}
