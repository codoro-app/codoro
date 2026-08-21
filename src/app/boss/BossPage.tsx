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

// 2b.0: was `.boss-page` in bossPage.css (max-width breakpoint matches
// Tailwind's `lg` exactly). Not test-asserted (grep-verified).
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

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
      <div className={PAGE_SHELL_CLASS}>
        <p className="py-8 px-4 text-center text-text-1">
          We couldn&apos;t load Boss. Please try again.
        </p>
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
      <div className={PAGE_SHELL_CLASS}>
        <p className="py-8 px-4 text-center text-text-1">Loading Boss…</p>
      </div>
    )
  }

  if (session.status === 'empty') {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="py-8 px-4 text-center text-text-1">Boss isn&apos;t available right now.</p>
      </div>
    )
  }

  return (
    <div className={PAGE_SHELL_CLASS}>
      {session.phase === 'playing' && <BossActivePlay session={session} />}

      {session.phase === 'ended' && session.runSummary && (
        <>
          {/* 2b.0: was `.daily-hero`/`.daily-hero__*` (dailyPage.css) — this
              card is always the "correct"/accent styling, never `--wrong`. */}
          <div className="flex flex-col gap-4 p-4 lg:py-[28px] lg:px-[30px] rounded-xl border-[1.5px] border-accent [background:linear-gradient(160deg,var(--accent-dim),var(--surface-1))]">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center shrink-0 w-11 h-11 rounded-md bg-accent"
                aria-hidden="true"
              >
                <BossIcon size={22} />
              </div>
              <div className="flex flex-col gap-1">
                <p className="m-0 text-lg font-bold text-text-0">
                  {session.runSummary.cleared ? 'Boss cleared!' : 'Run complete'}
                </p>
                {session.runSummary.isNewBestDepth && (
                  <p className="m-0 text-sm font-semibold text-accent">New personal best</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
                <span className="text-lg font-bold text-text-0">
                  {session.runSummary.depthReached}
                </span>
                <span className="text-xs text-text-2">Reached</span>
              </div>
              <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
                <span className="text-lg font-bold text-text-0">
                  {session.runSummary.bestDepthEver}
                </span>
                <span className="text-xs text-text-2">Best ever</span>
              </div>
            </div>
            {ghostPaceText && <p className="m-0 text-sm text-text-1">{ghostPaceText}</p>}
          </div>

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
