/**
 * Missions' Trace stage: calls useTraceSession() directly (Rules of Hooks —
 * see useMissionSession.ts's own doc comment for why the outer mission hook
 * can't call this itself) and reuses TraceRunnerPuzzle verbatim, exactly
 * like standalone /trace does. Trace has no native end condition of its own
 * (docs/design/click-meaningfulness.md §3, decision 3) — the mission's own
 * 60s stage clock is its ONLY way to end, checked between puzzles (soft
 * cutoff) at the moment "Continue" is tapped, never mid-puzzle. Every
 * completed MissionStageSummary for this stage therefore has
 * endedReason: 'timer' — this asymmetry with Speed/Boss is intentional, not
 * an oversight (stated explicitly in the design doc rather than papered
 * over).
 *
 * `timed`: unlike standalone /trace (which passes `timed={false}` — Phase 7
 * reversed 5b's original "Trace is timed" decision by direct user
 * preference), this stage passes the default `timed={true}`. Per this
 * session's locked decision ("Should [per-puzzle/per-checkpoint clocks]
 * still apply inside a mission's timed stage?" → "Both apply, first one
 * wins"), Trace's own per-checkpoint clock (TRACE_CHECKPOINT_TIME_LIMIT_MS)
 * stays live here, alongside the mission's 60s stage clock — this is the
 * first real consumer of TraceRunnerPuzzle's `timed=true` path (every other
 * call site opts out of it explicitly).
 *
 * Two distinct continue paths both need the same interception — the
 * feedback panel's own "Continue" button (TraceRunnerPuzzle's onContinue
 * prop) AND the streak-pause overlay's "Keep going" button, which — unlike
 * every other mode's Continue — calls useTraceSession's own
 * handleStreakPauseKeepGoing internally, bypassing TraceRunnerPuzzle's
 * onContinue prop entirely (see TraceRunner.tsx: StreakPause is wired to
 * session.handleStreakPauseKeepGoing, not to the onContinue prop at all).
 * Routing both through the same continueWithinStageOrEndStage keeps the
 * cutoff check from being bypassable by dismissing a streak pause at
 * exactly the wrong moment.
 */
import { useCallback, useRef } from 'react'
import { useTraceSession } from '../trace/useTraceSession'
import { TraceRunnerPuzzle } from '../trace/TraceRunner'
import { StreakPause } from '../StreakPause'
import { hasStageClockExpired } from './missionStageClock'
import type { MissionSession } from './useMissionSession'

export interface TraceStageProps {
  missionSession: MissionSession
}

export function TraceStage({ missionSession }: TraceStageProps) {
  const traceSession = useTraceSession()

  // The just-finished puzzle counts toward the stage's tally even when it's
  // the one that triggers a timer cutoff (soft cutoff — see this file's own
  // doc comment); tracked locally since useTraceSession has no concept of a
  // "puzzles this stage" count. Refs, not state: read/written only inside
  // continueWithinStageOrEndStage, never during render.
  const puzzlesCompletedRef = useRef(0)
  const solvedCountRef = useRef(0)

  const continueWithinStageOrEndStage = useCallback(() => {
    const justSolved = traceSession.solved === true
    puzzlesCompletedRef.current += 1
    if (justSolved) solvedCountRef.current += 1

    const clockExpired =
      missionSession.stageDeadlineMs !== null &&
      hasStageClockExpired(missionSession.stageDeadlineMs, Date.now())

    if (clockExpired) {
      missionSession.handleStageComplete(
        {
          stageId: 'trace',
          puzzlesCompleted: puzzlesCompletedRef.current,
          solvedCount: solvedCountRef.current,
        },
        'timer',
      )
      return
    }

    traceSession.handleContinue()
  }, [traceSession, missionSession])

  const handleStreakPauseKeepGoing = useCallback(() => {
    traceSession.handleStreakPauseDoneForNow()
    continueWithinStageOrEndStage()
  }, [traceSession, continueWithinStageOrEndStage])

  if (traceSession.status === 'error') {
    return (
      <div className="text-center text-text-1 py-8">
        <p>We couldn&apos;t load this stage. Please try again.</p>
        <button
          type="button"
          className="min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer"
          onClick={traceSession.retryLoad}
        >
          Try again
        </button>
      </div>
    )
  }

  if (traceSession.status === 'loading' || traceSession.profile === null) {
    return (
      <div className="text-center text-text-1 py-8">
        <p>Loading…</p>
      </div>
    )
  }

  if (traceSession.status === 'empty' || traceSession.puzzle === null) {
    return (
      <div className="text-center text-text-1 py-8">
        <p>No trace puzzles available yet.</p>
      </div>
    )
  }

  return (
    <>
      {traceSession.streakPause && (
        <StreakPause
          streak={traceSession.streakPause.streak}
          isNewBest={traceSession.streakPause.isNewBest}
          onKeepGoing={handleStreakPauseKeepGoing}
          onDoneForNow={traceSession.handleStreakPauseDoneForNow}
        />
      )}
      <TraceRunnerPuzzle
        key={traceSession.puzzle.id}
        puzzle={traceSession.puzzle}
        checkpointResults={traceSession.checkpointResults}
        isComplete={traceSession.isComplete}
        solved={traceSession.solved}
        ratingDelta={traceSession.ratingDelta}
        onCheckpointAnswered={traceSession.handleCheckpointAnswered}
        onContinue={continueWithinStageOrEndStage}
      />
    </>
  )
}
