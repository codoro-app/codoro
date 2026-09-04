/**
 * Practice's non-blocking combo-surge moment — replaces the old blocking
 * StreakPause modal for Practice ONLY (Trace keeps StreakPause/
 * streakPauseLogic.ts entirely unmodified). `role="status"`, no buttons,
 * auto-dismissing: interrupting a streak with a decision the player has to
 * act on is exactly what this change is fixing (see
 * docs/design/practice-feedback-loop.md §9). Overlaid above the card by
 * the caller (PracticePage), not a portal — it's a toast, not a dialog.
 */
import { useEffect } from 'react'
import type { Outcome } from './feel'

const AUTO_DISMISS_MS = 1600

export interface ComboSurgeProps {
  outcome: Extract<Outcome, { kind: 'correct' }>
  isNewBest: boolean
  onDismiss: () => void
}

export function ComboSurge({ outcome, isNewBest, onDismiss }: ComboSurgeProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [onDismiss])

  return (
    <div
      role="status"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 py-3 px-5 rounded-lg border border-accent bg-surface-1 text-center shadow-lg"
    >
      <p className="m-0 text-lg font-bold text-text-0">{outcome.newCombo} in a row</p>
      {outcome.newShields > 0 && <p className="m-0 text-sm font-semibold text-accent">+1 shield</p>}
      {isNewBest && <p className="m-0 text-sm font-semibold text-accent">New best</p>}
    </div>
  )
}
