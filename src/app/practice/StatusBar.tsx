/**
 * Session status bar: rating pill (trophy), daily-streak pill (flame/drop),
 * an uncapped "solved this session" counter, and the in-session combo badge.
 *
 * Inline SVG icons (v2 Arena design system), no icon-library dependency —
 * copied from the reference file (docs/design/codoro-v2-arena.html)'s
 * rating/streak/solved icons where an exact match exists. The combo
 * (lightning-bolt) icon has no equivalent in the reference — Codoro's
 * "combo" concept (in-session correct-answer streak) doesn't appear in any
 * reference screen — so it uses a reasonable Feather/Lucide-style zap-bolt
 * substitute instead, per the Task 3 brief's explicit allowance.
 *
 * The streak icon's stroke is conditional: var(--warn) once the streak is
 * actually running (streak > 0), var(--text-2) at streak === 0 — matches
 * the reference's 2a (streak 0, muted icon) vs 2b (streak 1, warn-colored
 * icon) distinction.
 */
import { useNumberTween } from './useNumberTween'
import './practicePage.css'

export interface StatusBarProps {
  /** Elo rating, rounded for display by the caller or here — always shown as an integer. */
  rating: number
  streak: number
  /** In-session correct-answer streak; the badge only renders at 2+ (see practice-flow brief). */
  combo: number
  /** Uncapped count of correct answers this session — see PracticePage's doc comment for why this replaces a fixed "out of N" progress bar in an endless practice mode. */
  solvedThisSession: number
}

export function StatusBar({ rating, streak, combo, solvedThisSession }: StatusBarProps) {
  const pillClass =
    'flex items-center gap-1.5 min-h-11 py-1.5 px-3 rounded-full bg-surface-1 border border-border text-text-0 font-bold tabular-nums'
  // Tweens from the previous rating to the new one over ~600ms whenever it
  // changes — never on first mount (see useNumberTween's own doc comment).
  // A rating that silently changes is the single clearest signal that
  // nothing is at stake (docs/design/practice-feedback-loop.md section 7).
  const tweenedRating = useNumberTween(rating, 600)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={pillClass} title="Rating">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
        <span>{Math.round(tweenedRating)}</span>
      </div>
      <div className={pillClass} title="Daily streak">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={streak > 0 ? 'var(--warn)' : 'var(--text-2)'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        </svg>
        <span>{streak}</span>
      </div>
      <div className="flex items-center gap-1.5 text-text-1 text-sm" title="Solved this session">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>{solvedThisSession} solved this session</span>
      </div>
      {combo >= 2 && (
        <div
          className="status-bar__combo flex items-center gap-1.5 min-h-11 py-1.5 px-3 rounded-full bg-ok-dim text-accent font-bold"
          data-testid="combo-badge"
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>{combo} in a row</span>
        </div>
      )}
    </div>
  )
}
