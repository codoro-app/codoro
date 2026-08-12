/**
 * Missions' Speed stage: calls useRushSession() directly and reuses
 * RushActivePlay verbatim (build item 1's extraction) — same
 * Rules-of-Hooks reasoning as TraceStage. Rush's own native end (3 strikes,
 * RUSH_STRIKE_LIMIT) and the mission's 60s stage clock both apply;
 * whichever is true at the moment "Continue" is tapped ends the stage
 * (docs/design/click-meaningfulness.md §3, decision 3) — a pending native
 * end takes priority over a simultaneous timer cutoff, since it's the
 * "real" ending (see useMissionSession.ts's native-end-vs-timer-cutoff doc
 * comment: the mission timer only cuts a stage short when the mode's own
 * run hasn't already ended on its own).
 *
 * `rushSession.strikes` already reflects the just-answered puzzle's outcome
 * by the time Continue is tappable (useRushSession's handleAnswered updates
 * it synchronously on commit, before the Continue button ever renders) — so
 * checking it here mirrors the same `newStrikes >= RUSH_STRIKE_LIMIT` test
 * useRushSession's own handleAnswered uses internally to decide its private
 * pendingEndRef, without this component needing access to that ref.
 *
 * A pending native end is handled by calling rushSession.handleContinue()
 * as normal — that's what actually runs useRushSession's own endRun
 * (persisting rushStats, firing trackRushRunEnd) exactly like standalone
 * Rush. The effect below reactively watches for that landing (phase
 * becoming 'ended') and forwards the result into the mission — this
 * component never tries to duplicate endRun's own logic.
 */
import { useCallback, useEffect, useRef } from 'react'
import { RUSH_STRIKE_LIMIT } from '../../engine'
import { useRushSession } from '../rush/useRushSession'
import { RushActivePlay } from '../rush/RushActivePlay'
import { hasStageClockExpired } from './missionStageClock'
import type { MissionSession } from './useMissionSession'

export interface SpeedStageProps {
  missionSession: MissionSession
}

export function SpeedStage({ missionSession }: SpeedStageProps) {
  const rushSession = useRushSession()
  // Guards against double-forwarding: the effect below can re-run on later
  // renders (e.g. missionSession's own state changing) while phase/runSummary
  // stay the same "just ended" values — this ensures handleStageComplete
  // fires exactly once per native end, same convention as
  // useMissionSession's own boundary-write guards.
  const nativeEndHandledRef = useRef(false)

  useEffect(() => {
    if (rushSession.phase !== 'ended' || !rushSession.runSummary) return
    if (nativeEndHandledRef.current) return
    nativeEndHandledRef.current = true
    missionSession.handleStageComplete(
      {
        stageId: 'speed',
        solvedCount: rushSession.runSummary.solvedCount,
        bestStreakThisRun: rushSession.runSummary.bestStreakThisRun,
      },
      'native',
    )
  }, [rushSession.phase, rushSession.runSummary, missionSession])

  const handleContinue = useCallback(() => {
    const nativeEndPending = rushSession.strikes >= RUSH_STRIKE_LIMIT
    if (nativeEndPending) {
      rushSession.handleContinue()
      return
    }

    const clockExpired =
      missionSession.stageDeadlineMs !== null &&
      hasStageClockExpired(missionSession.stageDeadlineMs, Date.now())
    if (clockExpired) {
      missionSession.handleStageComplete(
        {
          stageId: 'speed',
          solvedCount: rushSession.solvedCount,
          bestStreakThisRun: rushSession.bestStreakThisRun,
        },
        'timer',
      )
      return
    }

    rushSession.handleContinue()
  }, [rushSession, missionSession])

  if (rushSession.status === 'error') {
    return (
      <div className="rush-page__status">
        <p>We couldn&apos;t load this stage. Please try again.</p>
        <button
          type="button"
          className="min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer"
          onClick={rushSession.retryLoad}
        >
          Try again
        </button>
      </div>
    )
  }

  if (rushSession.status === 'loading' || rushSession.profile === null) {
    return (
      <div className="rush-page__status">
        <p>Loading…</p>
      </div>
    )
  }

  if (rushSession.status === 'empty') {
    return (
      <div className="rush-page__status">
        <p>No puzzles available right now.</p>
      </div>
    )
  }

  if (rushSession.phase !== 'playing') {
    // Native end just landed — the effect above is forwarding it into the
    // mission this same tick; nothing meaningful to render in between.
    return null
  }

  return <RushActivePlay session={rushSession} onContinue={handleContinue} />
}
