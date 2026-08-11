/**
 * Boss mode: a fixed 10-puzzle escalating run, 3 strikes ends it. Composed
 * from the same existing patterns Rush's own page comment documents using:
 * PuzzleCardShell for the puzzle itself, the .daily-hero/.status-bar
 * treatment for the end-of-run summary (global CSS, already loaded whenever
 * DailyPage is reachable — see RushPage.tsx's own doc comment for why that's
 * safe to reuse verbatim). The strikes indicator (engagement pass: now a
 * depleting health bar, not discrete dot-slots — see bossPage.css's own
 * doc comment for the visual design record) is Boss's own small CSS, not
 * literally rushPage.css's classes. No timer row (Boss has no per-puzzle
 * clock — see the Boss Challenges plan's design record) and no share/
 * challenge cards this phase (not in Phase 1's build item list — a
 * deliberate scope decision, see the same plan).
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { BossIcon } from '../Icons'
import { BOSS_STRIKE_LIMIT } from '../../engine'
import { useBossSession } from './useBossSession'
import { buildBossGhostPaceText } from './ghostPace'
import './bossPage.css'

export function BossPage() {
  const session = useBossSession()
  const ghostPaceText = session.runSummary
    ? buildBossGhostPaceText({
        depthReached: session.runSummary.depthReached,
        splits: session.runSummary.splits,
        previousBestSplits: session.runSummary.previousBestSplits,
      })
    : null
  // Health-bar fill: 100% at 0 strikes, draining to 0% once
  // BOSS_STRIKE_LIMIT lands (100% -> ~66% -> ~33% -> 0% at the default
  // limit of 3) — reads session.strikes/BOSS_STRIKE_LIMIT only, the same
  // data the old dot-slot indicator used, no new state.
  const healthPercent = ((BOSS_STRIKE_LIMIT - session.strikes) / BOSS_STRIKE_LIMIT) * 100

  if (session.status === 'error') {
    return (
      <div className="boss-page app-shell__main">
        <p className="boss-page__status">We couldn&apos;t load Boss. Please try again.</p>
        <button type="button" className="daily-page__link" onClick={session.retryLoad}>
          Try again
        </button>
      </div>
    )
  }

  if (session.status === 'loading' || session.profile === null) {
    return (
      <div className="boss-page app-shell__main">
        <p className="boss-page__status">Loading Boss…</p>
      </div>
    )
  }

  if (session.status === 'empty') {
    return (
      <div className="boss-page app-shell__main">
        <p className="boss-page__status">Boss isn&apos;t available right now.</p>
      </div>
    )
  }

  return (
    <div className="boss-page app-shell__main">
      {session.phase === 'playing' && (
        <div className="boss-header">
          <div
            className="boss-strikes"
            role="status"
            aria-label={`${String(session.strikes)} of ${String(BOSS_STRIKE_LIMIT)} strikes`}
          >
            {/* key={session.strikes}: forces a remount on every strike so
                the CSS hit-reaction animation (bossPage.css) restarts each
                time, without any new component state — see that file's
                own doc comment. */}
            <div
              key={session.strikes}
              className={`boss-strikes__fill${session.strikes > 0 ? ' boss-strikes__fill--hit' : ''}`}
              style={{ width: `${String(healthPercent)}%` }}
              aria-hidden="true"
            />
          </div>
          <span className="boss-progress">
            Puzzle {session.position} of {session.totalPuzzles}
          </span>
        </div>
      )}

      {session.phase === 'ended' && session.runSummary && (
        <>
          <div className="daily-hero">
            <div className="daily-hero__top">
              <div className="daily-hero__icon" aria-hidden="true">
                <BossIcon size={22} />
              </div>
              <div className="daily-hero__copy">
                <p className="daily-hero__verdict">
                  {session.runSummary.cleared ? 'Boss cleared!' : 'Run complete'}
                </p>
                {session.runSummary.isNewBestDepth && (
                  <p className="daily-hero__badge">New personal best</p>
                )}
              </div>
            </div>
            <div className="daily-hero__stats">
              <div className="daily-hero__stat">
                <span className="daily-hero__stat-value">{session.runSummary.depthReached}</span>
                <span className="daily-hero__stat-label">Reached</span>
              </div>
              <div className="daily-hero__stat">
                <span className="daily-hero__stat-value">{session.runSummary.bestDepthEver}</span>
                <span className="daily-hero__stat-label">Best ever</span>
              </div>
            </div>
            {ghostPaceText && <p className="boss-ghost-pace">{ghostPaceText}</p>}
          </div>

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
