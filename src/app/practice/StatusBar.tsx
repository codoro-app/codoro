/**
 * Session status bar: rating pill (trophy), daily-streak pill (flame), an
 * uncapped "solved this session" counter, and the in-session combo badge.
 *
 * Unicode glyphs only, no icon-library dependency — same approach concern
 * (a) used for the feedback panel's checkmark/cross (see PuzzleCardShell.tsx).
 *
 * Text color on the rating/streak pills uses --pill-text (src/index.css),
 * a fixed dark color chosen because --accent/--warning are the same hue in
 * both light and dark mode and a dark text color clears WCAG AA against both
 * (>=7:1 in every combination) while white fails all four — see index.css's
 * comment for the actual contrast numbers.
 */
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
  return (
    <div className="status-bar">
      <div className="status-bar__pill status-bar__pill--rating" title="Rating">
        <span aria-hidden="true">🏆</span>
        <span>{Math.round(rating)}</span>
      </div>
      <div className="status-bar__pill status-bar__pill--streak" title="Daily streak">
        <span aria-hidden="true">🔥</span>
        <span>{streak}</span>
      </div>
      <div className="status-bar__solved" title="Solved this session">
        <span aria-hidden="true">✓</span>
        <span>{solvedThisSession} solved this session</span>
      </div>
      {combo >= 2 && (
        <div className="status-bar__combo" data-testid="combo-badge">
          <span aria-hidden="true">⚡</span>
          <span>{combo} in a row</span>
        </div>
      )}
    </div>
  )
}
