/**
 * Boss mode: a fixed 10-puzzle escalating run, 3 strikes ends it. Composed
 * from the same existing patterns Rush's own page comment documents using:
 * PuzzleCardShell for the puzzle itself, the .daily-hero/.status-bar
 * treatment for the end-of-run summary (global CSS, already loaded whenever
 * DailyPage is reachable — see RushPage.tsx's own doc comment for why that's
 * safe to reuse verbatim). The strikes indicator is Boss's own small CSS
 * (see bossPage.css's doc comment for why it isn't literally rushPage.css's
 * classes). No timer row (Boss has no per-puzzle clock — see the Boss
 * Challenges plan's design record) and no share/challenge cards this phase
 * (not in Phase 1's build item list — a deliberate scope decision, see the
 * same plan).
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { BossIcon } from '../Icons'
import { BOSS_STRIKE_LIMIT } from '../../engine'
import { useBossSession } from './useBossSession'
import './bossPage.css'

const STRIKE_SLOTS = Array.from({ length: BOSS_STRIKE_LIMIT }, (_, i) => i)

export function BossPage() {
  const session = useBossSession()

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
            {STRIKE_SLOTS.map((slot) => (
              <span
                key={slot}
                className={`boss-strikes__slot${
                  slot < session.strikes ? ' boss-strikes__slot--missed' : ''
                }`}
                aria-hidden="true"
              />
            ))}
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
