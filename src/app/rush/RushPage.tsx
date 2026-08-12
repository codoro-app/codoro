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
        <button
          type="button"
          className="min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer"
          onClick={session.retryLoad}
        >
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
          {/* 2b.0: was `.daily-hero`/`.daily-hero__*` (dailyPage.css) — this
              card is always the "correct"/accent styling, never the
              `--wrong` variant. */}
          <div className="flex flex-col gap-4 p-4 lg:py-[28px] lg:px-[30px] rounded-xl border-[1.5px] border-accent [background:linear-gradient(160deg,var(--accent-dim),var(--surface-1))]">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center shrink-0 w-11 h-11 rounded-md bg-accent"
                aria-hidden="true"
              >
                <RushIcon size={22} />
              </div>
              <div className="flex flex-col gap-1">
                <p className="m-0 text-lg font-bold text-text-0">Run complete</p>
                {session.runSummary.isNewBestScore && (
                  <p className="m-0 text-sm font-semibold text-accent">New personal best</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
                <span className="text-lg font-bold text-text-0">
                  {session.runSummary.solvedCount}
                </span>
                <span className="text-xs text-text-2">Solved</span>
              </div>
              <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
                <span className="text-lg font-bold text-text-0">
                  {session.runSummary.bestStreakThisRun}
                </span>
                <span className="text-xs text-text-2">Best streak (run)</span>
              </div>
              <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
                <span className="text-lg font-bold text-text-0">
                  {session.runSummary.longestStreakEver}
                </span>
                <span className="text-xs text-text-2">Longest streak ever</span>
              </div>
              <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
                <span className="text-lg font-bold text-text-0">
                  {session.runSummary.bestScoreEver}
                </span>
                <span className="text-xs text-text-2">Best score ever</span>
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

          <button
            type="button"
            className="min-h-11 border-0 rounded-sm bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            onClick={session.handleRunItBack}
          >
            Run it back
          </button>
        </>
      )}
    </div>
  )
}
