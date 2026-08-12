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
import { BossIcon } from '../Icons'
import { useBossSession } from './useBossSession'
import { BossActivePlay } from './BossActivePlay'
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
      {session.phase === 'playing' && <BossActivePlay session={session} />}

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
    </div>
  )
}
