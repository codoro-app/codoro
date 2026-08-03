/**
 * The streak-pause moment (Phase 5b Item 7/8, decision 8) — Practice and
 * Trace only. Blocking (a dimmed overlay, not a dismiss-and-forget toast):
 * decision 8's own brief is explicit that the point of the feature is a
 * place to stop, so it must offer stopping as a real option, not just a
 * "keep going" button with confetti. Two exits, both real:
 *
 * - "Keep going" dismisses the overlay AND serves the next puzzle
 *   immediately (the caller's onKeepGoing does both) — the streak
 *   continues exactly as if this moment hadn't interrupted it.
 * - "Done for now" only dismisses the overlay, leaving the underlying
 *   puzzle's own feedback panel (with its own Continue button) visible
 *   underneath — the streak is left untouched either way; this button
 *   exists so a player who wants to actually stop has a real, named way to
 *   do it, rather than needing to intuit that ignoring the overlay is safe.
 *
 * Shared between usePracticeSession.ts and useTraceSession.ts (see
 * streakPauseLogic.ts's own doc comment for why the trigger logic is
 * shared too) — Rush never renders this (timed, decision 8), Daily has no
 * in-session streak to speak of.
 */
import './streakPause.css'

export interface StreakPauseProps {
  streak: number
  isNewBest: boolean
  onKeepGoing: () => void
  onDoneForNow: () => void
}

export function StreakPause({ streak, isNewBest, onKeepGoing, onDoneForNow }: StreakPauseProps) {
  return (
    <div className="streak-pause-overlay">
      <div className="streak-pause" role="dialog" aria-modal="true" aria-label="Streak milestone">
        <p className="streak-pause__streak">{streak} in a row</p>
        {isNewBest && <p className="streak-pause__badge">New best streak</p>}
        <p className="streak-pause__copy">
          Keep the momentum going, or stop here — your streak stays intact either way.
        </p>
        <div className="streak-pause__actions">
          <button type="button" className="streak-pause__keep-going" onClick={onKeepGoing}>
            Keep going
          </button>
          <button type="button" className="streak-pause__done" onClick={onDoneForNow}>
            Done for now
          </button>
        </div>
      </div>
    </div>
  )
}
