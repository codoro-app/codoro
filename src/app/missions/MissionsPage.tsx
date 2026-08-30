/**
 * Missions' page-level component — mounted at `/missions`. Owns the single
 * `useMissionSession` instance (Rules of Hooks: see useMissionSession.ts's
 * own doc comment for why the outer state machine and each stage's own
 * session hook can't live in the same function body) and conditionally
 * renders exactly one child per `phase`: `MissionCheckpoint` for
 * `'checkpoint'`, one of `TraceStage`/`SpeedStage`/`BossStage` while that
 * stage is actively playing, and `MissionComplete` once the arc finishes.
 * Mirrors RushPage.tsx's own status-branching shape (loading/error guards
 * before the phase switch).
 */
import { useState } from 'react'
import { useMissionSession } from './useMissionSession'
import { MissionCheckpoint } from './MissionCheckpoint'
import { MissionComplete } from './MissionComplete'
import { StageTracker } from './StageTracker'
import { TraceStage } from './TraceStage'
import { SpeedStage } from './SpeedStage'
import { BossStage } from './BossStage'
import { useMediaQuery } from '../useMediaQuery'
// 2b.0: was `.missions-page` in missionsPage.css (max-width breakpoint
// matches Tailwind's `lg` exactly). Not test-asserted (grep-verified).
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

export function MissionsPage() {
  const missionSession = useMissionSession()
  // 2b.3: desktop places StageTracker in `.app-shell__sidebar` (a different
  // grid area than the mobile copy's inline spot below) — same isDesktop
  // split PracticePage.tsx/DailyPage.tsx already use for their own desktop
  // sidebars. See StageTracker.tsx's own doc comment for why this lives
  // here rather than inside StageTracker itself.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // v4 Phase 4.5 ("the right rail") — same ref-callback-in-state portal
  // target as PracticePage.tsx's identical `sidebarSlotEl`, shared across
  // whichever stage is currently active (each stage forwards it into its
  // own PuzzleCardShell/TraceRunnerPuzzle); appends below StageTracker
  // rather than replacing it.
  const [sidebarSlotEl, setSidebarSlotEl] = useState<HTMLDivElement | null>(null)

  if (missionSession.status === 'error') {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">
          We couldn&apos;t load Missions. Please try again.
        </p>
        <button
          type="button"
          className="min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer"
          onClick={missionSession.retryLoad}
        >
          Try again
        </button>
      </div>
    )
  }

  if (missionSession.status === 'loading' || missionSession.profile === null) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">Loading Missions…</p>
      </div>
    )
  }

  // Tracked throughout the run, not just at checkpoints (2b.3 build item
  // 1) — every phase except 'complete', since MissionComplete already
  // recaps every stage and a tracker there would just repeat it.
  const showStageTracker = missionSession.phase !== 'complete'

  return (
    <>
      <div className={PAGE_SHELL_CLASS}>
        {showStageTracker && !isDesktop && (
          <StageTracker
            currentStage={missionSession.currentStage}
            completedStages={missionSession.completedStages}
            variant="mobile"
          />
        )}
        {missionSession.phase === 'checkpoint' && (
          <MissionCheckpoint missionSession={missionSession} />
        )}
        {missionSession.phase === 'trace' && (
          <TraceStage missionSession={missionSession} sidebarSlot={sidebarSlotEl} />
        )}
        {missionSession.phase === 'speed' && (
          <SpeedStage missionSession={missionSession} sidebarSlot={sidebarSlotEl} />
        )}
        {missionSession.phase === 'boss' && (
          <BossStage missionSession={missionSession} sidebarSlot={sidebarSlotEl} />
        )}
        {missionSession.phase === 'complete' && <MissionComplete missionSession={missionSession} />}
      </div>

      {showStageTracker && isDesktop && (
        <aside className="app-shell__sidebar flex flex-col gap-4 py-6 px-4 border-l border-border self-start">
          <StageTracker
            currentStage={missionSession.currentStage}
            completedStages={missionSession.completedStages}
            variant="desktop"
          />
          {/* Active stage's status row + PuzzleCardShell/TraceRunnerPuzzle
              feedback portal in here below StageTracker (see
              `sidebarSlotEl`'s doc comment); `empty:hidden` matches
              PracticePage.tsx's identical slot so it claims no space
              before anything portals in. */}
          <div ref={setSidebarSlotEl} className="empty:hidden flex flex-col gap-4" />
        </aside>
      )}
    </>
  )
}
