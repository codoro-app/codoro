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
 *   appropriate for a share/retention moment); its class set lives in
 *   dailyPage.css but is global, already loaded by the bundle whenever
 *   DailyPage is reachable — the same reuse convention DailyPage itself
 *   relies on for `.status-bar`, which actually lives in practicePage.css,
 *   not dailyPage.css. Sharing itself (v3 Phase 2b.4) is the shared
 *   `ShareMenu` component (`src/app/ShareMenu.tsx`), not mode-specific
 *   markup.
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
import { buildRushShareText, buildRushChallengeText } from './shareText'
import { ShareMenu } from '../ShareMenu'
import type { ShareAction } from '../ShareMenu'
import { trackShareClick, trackChallengeCreate } from '../../telemetry'
import { truncateToChallengeLimit } from '../../challenge'
// 2b.0: was `.rush-page` in rushPage.css (max-width breakpoint matches
// Tailwind's `lg` exactly). Not test-asserted (grep-verified).
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

export function RushPage() {
  const session = useRushSession()

  if (session.status === 'error') {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">
          We couldn&apos;t load Rush. Please try again.
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
        <p className="text-center text-text-1 py-8">Loading Rush…</p>
      </div>
    )
  }

  if (session.status === 'empty') {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">No puzzles available for Rush right now.</p>
      </div>
    )
  }

  // 2b.4: was separate RushShareCard/RushChallengeCard components (deleted)
  // — one ShareMenu now covers both. `runSummary`/`puzzle` are captured
  // locally so narrowing survives into the onShared closures below.
  const runSummary = session.runSummary
  const puzzle = session.puzzle
  const shareActions: ShareAction[] =
    session.phase === 'ended' && runSummary
      ? [
          ...(puzzle
            ? [
                {
                  id: 'puzzle',
                  label: 'Share puzzle',
                  copiedLabel: 'Copied!',
                  copyAriaLabel: 'Copy puzzle link',
                  description: 'Copy a link to the puzzle you ended on',
                  text: buildRushShareText({
                    solvedCount: runSummary.solvedCount,
                    bestStreakThisRun: runSummary.bestStreakThisRun,
                    puzzleId: puzzle.id,
                  }),
                  onShared: () => {
                    trackShareClick({ surface: 'rush', puzzle_id: puzzle.id })
                  },
                },
              ]
            : []),
          {
            id: 'challenge',
            label: 'Share challenge',
            copiedLabel: 'Link copied!',
            copyAriaLabel: 'Copy challenge link',
            description: `Challenge a friend to beat your run of ${String(runSummary.solvedCount)}`,
            text: buildRushChallengeText({
              solvedCount: runSummary.solvedCount,
              bestStreakThisRun: runSummary.bestStreakThisRun,
              attempts: session.runAttempts,
            }),
            onShared: () => {
              trackChallengeCreate({
                surface: 'rush',
                puzzle_count: truncateToChallengeLimit([...session.runAttempts]).length,
              })
            },
          },
        ]
      : []

  return (
    <div className={PAGE_SHELL_CLASS}>
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

          <ShareMenu actions={shareActions} />

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
