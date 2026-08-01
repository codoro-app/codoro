/**
 * Rush mode: continuous escalating-difficulty puzzles, 3 strikes ends the
 * run — no countdown timer (locked decision, see the build plan). Composed
 * entirely from existing v2 Arena patterns rather than inventing new ones:
 *
 * - The end-of-run card reuses DailyPage's `.daily-hero`/`.daily-hero__stats`
 *   treatment (the boldest existing "result card" pattern in the app —
 *   appropriate for a share/retention moment) and ShareCard's `.share-card`
 *   clipboard mechanism verbatim (see RushShareCard.tsx). Both class sets
 *   live in dailyPage.css but are global, already loaded by the bundle
 *   whenever DailyPage is reachable — the same reuse convention DailyPage
 *   itself relies on for `.status-bar`, which actually lives in
 *   practicePage.css, not dailyPage.css.
 * - The running "solved" count and in-run streak badge reuse
 *   `.status-bar`/`.status-bar__solved`/`.status-bar__combo` (practicePage.css)
 *   verbatim.
 * - The strikes indicator (three dot-slots, filled with the danger token on
 *   a miss) is the one genuinely new pattern — see rushPage.css.
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { RushIcon } from '../Icons'
import { useRushSession } from './useRushSession'
import { RushShareCard } from './RushShareCard'
import './rushPage.css'

export function RushPage() {
  const session = useRushSession()

  if (session.status === 'error') {
    return (
      <div className="rush-page app-shell__main">
        <p className="rush-page__status">We couldn&apos;t load Rush. Please try again.</p>
        <button type="button" className="daily-page__link" onClick={session.retryLoad}>
          Try again
        </button>
      </div>
    )
  }

  if (session.status === 'loading' || session.profile === null) {
    return (
      <div className="rush-page app-shell__main">
        <p className="rush-page__status">Loading Rush…</p>
      </div>
    )
  }

  if (session.status === 'empty') {
    return (
      <div className="rush-page app-shell__main">
        <p className="rush-page__status">No puzzles available for Rush right now.</p>
      </div>
    )
  }

  return (
    <div className="rush-page app-shell__main">
      {session.phase === 'playing' && (
        <div className="rush-header">
          <div
            className="rush-strikes"
            role="status"
            aria-label={`${String(session.strikes)} of 3 strikes`}
          >
            {[0, 1, 2].map((slot) => (
              <span
                key={slot}
                className={`rush-strikes__slot${
                  slot < session.strikes ? ' rush-strikes__slot--missed' : ''
                }`}
                aria-hidden="true"
              />
            ))}
          </div>
          <div className="status-bar">
            <div className="status-bar__solved" title="Solved this run">
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
              <span>{session.solvedCount} solved</span>
            </div>
            {session.currentStreak >= 2 && (
              <div className="status-bar__combo">
                <RushIcon size={14} />
                <span>{session.currentStreak} in a row</span>
              </div>
            )}
          </div>
        </div>
      )}

      {session.phase === 'ended' && session.runSummary && (
        <>
          <div className="daily-hero">
            <div className="daily-hero__top">
              <div className="daily-hero__icon" aria-hidden="true">
                <RushIcon size={22} />
              </div>
              <div className="daily-hero__copy">
                <p className="daily-hero__verdict">Run complete</p>
              </div>
            </div>
            <div className="daily-hero__stats">
              <div className="daily-hero__stat">
                <span className="daily-hero__stat-value">{session.runSummary.solvedCount}</span>
                <span className="daily-hero__stat-label">Solved</span>
              </div>
              <div className="daily-hero__stat">
                <span className="daily-hero__stat-value">
                  {session.runSummary.bestStreakThisRun}
                </span>
                <span className="daily-hero__stat-label">Best streak (run)</span>
              </div>
              <div className="daily-hero__stat">
                <span className="daily-hero__stat-value">
                  {session.runSummary.longestStreakEver}
                </span>
                <span className="daily-hero__stat-label">Longest streak ever</span>
              </div>
              <div className="daily-hero__stat">
                <span className="daily-hero__stat-value">{session.runSummary.bestScoreEver}</span>
                <span className="daily-hero__stat-label">Best score ever</span>
              </div>
            </div>
          </div>

          {session.puzzle && (
            <RushShareCard
              solvedCount={session.runSummary.solvedCount}
              bestStreakThisRun={session.runSummary.bestStreakThisRun}
              puzzleId={session.puzzle.id}
            />
          )}

          <button type="button" className="share-card__button" onClick={session.handleRunItBack}>
            Run it back
          </button>
        </>
      )}

      {session.phase === 'playing' && session.puzzle && (
        <PuzzleCardShell
          key={session.puzzle.id}
          puzzle={session.puzzle}
          ratingDelta={null}
          onAnswered={session.handleAnswered}
          onContinue={session.handleContinue}
        />
      )}
    </div>
  )
}
