/**
 * Boss's `'playing'`-phase JSX (health-bar header, `PuzzleCardShell`),
 * extracted verbatim from `BossPage.tsx` — pure extraction, zero behavior
 * change (v3 Phase 2 build item 1: Missions' `BossStage` reuses this
 * directly rather than forking Boss's own presentation). `BossPage.tsx`
 * still owns the `'ended'` branch (Boss's own end-of-run summary/ghost-pace
 * text doesn't belong inside a mission's own stage-transition screen — see
 * `docs/superpowers/plans/2026-08-11-missions-definition-and-plan.md`,
 * mirroring `RushActivePlay.tsx`'s identical reasoning).
 *
 * `onContinue` is overridable so a mission's stage wrapper can intercept it
 * (check the shared stage clock before deciding to advance) without this
 * component or `useBossSession` itself needing to know Missions exist —
 * defaults to `session.handleContinue`, BossPage's own original behavior.
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { BOSS_STRIKE_LIMIT } from '../../engine'
import type { BossSession } from './useBossSession'

export interface BossActivePlayProps {
  session: BossSession
  onContinue?: () => void
}

export function BossActivePlay({ session, onContinue }: BossActivePlayProps) {
  // Health-bar fill: 100% at 0 strikes, draining to 0% once BOSS_STRIKE_LIMIT
  // lands — same math as BossPage.tsx's own original inline computation.
  const healthPercent = ((BOSS_STRIKE_LIMIT - session.strikes) / BOSS_STRIKE_LIMIT) * 100

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div
          className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden"
          role="status"
          aria-label={`${String(session.strikes)} of ${String(BOSS_STRIKE_LIMIT)} strikes`}
        >
          {/* key={session.strikes}: forces a remount on every strike so
              the CSS hit-reaction animation (bossPage.css) restarts each
              time, without any new component state — see that file's
              own doc comment. boss-strikes__fill/--hit stay literal —
              BossPage.test.tsx asserts on them directly, and --hit still
              needs its @keyframes from bossPage.css. */}
          <div
            key={session.strikes}
            className={`boss-strikes__fill h-full rounded-full bg-danger transition-[width] duration-[0.25s] ease-out${session.strikes > 0 ? ' boss-strikes__fill--hit' : ''}`}
            style={{ width: `${String(healthPercent)}%` }}
            aria-hidden="true"
          />
        </div>
        <span className="text-sm text-text-1">
          Puzzle {session.position} of {session.totalPuzzles}
        </span>
      </div>

      {session.puzzle && (
        <PuzzleCardShell
          key={session.puzzle.id}
          puzzle={session.puzzle}
          ratingDelta={null}
          onAnswered={session.handleAnswered}
          onContinue={onContinue ?? session.handleContinue}
        />
      )}
    </>
  )
}
