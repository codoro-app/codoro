/**
 * Rush mode: continuous escalating-difficulty puzzles, 3 strikes ends the
 * run. A flat per-puzzle clock (Phase 5b Item 6) is a second way to reach
 * that same ending — a timeout counts as a strike, not a separate ending
 * path, so this stays "3 strikes ends the run" in spirit. This supersedes
 * the prior "no countdown timer" locked decision (see rush.ts's
 * RUSH_STRIKE_LIMIT and the build plan's Phase 5 amendment). Composed
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
 * - The right-side progress bar (Phase 5b Item 6) shows the CURRENT
 *   puzzle's remaining time, draining over RUSH_PUZZLE_TIME_LIMIT_MS and
 *   resetting on every new puzzle — strikes and difficulty already have
 *   their own indicators (the dots above, the escalating puzzle rating
 *   itself), so this shows the one thing neither already covers: how long
 *   is left to answer.
 */
import { RushIcon } from '../Icons'
import { useRushSession } from './useRushSession'
import { RushActivePlay } from './RushActivePlay'
import { RushShareCard } from './RushShareCard'
import { RushChallengeCard } from './RushChallengeCard'
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
      {session.phase === 'playing' && <RushActivePlay session={session} />}

      {session.phase === 'ended' && session.runSummary && (
        <>
          <div className="daily-hero">
            <div className="daily-hero__top">
              <div className="daily-hero__icon" aria-hidden="true">
                <RushIcon size={22} />
              </div>
              <div className="daily-hero__copy">
                <p className="daily-hero__verdict">Run complete</p>
                {session.runSummary.isNewBestScore && (
                  <p className="daily-hero__badge">New personal best</p>
                )}
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

          <RushChallengeCard
            solvedCount={session.runSummary.solvedCount}
            bestStreakThisRun={session.runSummary.bestStreakThisRun}
            attempts={session.runAttempts}
          />

          <button type="button" className="share-card__button" onClick={session.handleRunItBack}>
            Run it back
          </button>
        </>
      )}
    </div>
  )
}
