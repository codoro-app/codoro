/**
 * Missions' Boss stage: calls useBossSession() directly and reuses
 * BossActivePlay verbatim (build item 1) — same Rules-of-Hooks and
 * native-end-vs-timer-cutoff reasoning as SpeedStage. Boss's own native end
 * (BOSS_STRIKE_LIMIT strikes, or reaching the active set's last puzzle) and
 * the mission's 60s stage clock both apply; per decision 3, in practice a
 * mission's Boss stage will almost always be cut short by the timer before
 * Boss's own 10-puzzle set finishes — an accepted trade-off, not a bug (see
 * docs/design/click-meaningfulness.md §3).
 *
 * `bossSession.position >= bossSession.totalPuzzles` mirrors useBossSession's
 * own internal `reachedEnd` check (handleAnswered's private pendingEndRef
 * computation) without needing access to that ref — position/totalPuzzles
 * are both already public session state by the time Continue is tappable.
 * A pending native end is handled by calling bossSession.handleContinue()
 * as normal (runs useBossSession's own endRun); the effect below forwards
 * that landing into the mission, same pattern as SpeedStage.
 *
 * A timer cutoff's `cleared` is always false: cleared only means "reached
 * the set's end without striking out" (useBossSession.ts's own doc
 * comment) — a stage the mission clock cut short never reached that
 * natural end, by definition.
 */
import { useCallback, useEffect, useRef } from 'react'
import { BOSS_STRIKE_LIMIT } from '../../engine'
import { useBossSession } from '../boss/useBossSession'
import { BossActivePlay } from '../boss/BossActivePlay'
import { hasStageClockExpired } from './missionStageClock'
import type { MissionSession } from './useMissionSession'

export interface BossStageProps {
  missionSession: MissionSession
}

export function BossStage({ missionSession }: BossStageProps) {
  const bossSession = useBossSession()
  const nativeEndHandledRef = useRef(false)

  useEffect(() => {
    if (bossSession.phase !== 'ended' || !bossSession.runSummary) return
    if (nativeEndHandledRef.current) return
    nativeEndHandledRef.current = true
    missionSession.handleStageComplete(
      {
        stageId: 'boss',
        depthReached: bossSession.runSummary.depthReached,
        cleared: bossSession.runSummary.cleared,
      },
      'native',
    )
  }, [bossSession.phase, bossSession.runSummary, missionSession])

  const handleContinue = useCallback(() => {
    const nativeEndPending =
      bossSession.strikes >= BOSS_STRIKE_LIMIT || bossSession.position >= bossSession.totalPuzzles
    if (nativeEndPending) {
      bossSession.handleContinue()
      return
    }

    const clockExpired =
      missionSession.stageDeadlineMs !== null &&
      hasStageClockExpired(missionSession.stageDeadlineMs, Date.now())
    if (clockExpired) {
      missionSession.handleStageComplete(
        { stageId: 'boss', depthReached: bossSession.position, cleared: false },
        'timer',
      )
      return
    }

    bossSession.handleContinue()
  }, [bossSession, missionSession])

  if (bossSession.status === 'error') {
    return (
      <div className="py-8 px-4 text-center text-text-1">
        <p>We couldn&apos;t load this stage. Please try again.</p>
        <button
          type="button"
          className="min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer"
          onClick={bossSession.retryLoad}
        >
          Try again
        </button>
      </div>
    )
  }

  if (bossSession.status === 'loading' || bossSession.profile === null) {
    return (
      <div className="py-8 px-4 text-center text-text-1">
        <p>Loading…</p>
      </div>
    )
  }

  if (bossSession.status === 'empty') {
    return (
      <div className="py-8 px-4 text-center text-text-1">
        <p>Boss isn&apos;t available right now.</p>
      </div>
    )
  }

  if (bossSession.phase !== 'playing') {
    return null
  }

  return <BossActivePlay session={bossSession} onContinue={handleContinue} />
}
