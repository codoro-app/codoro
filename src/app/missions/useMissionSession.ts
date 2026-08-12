/**
 * Orchestrates the Missions chain's outer state machine — which stage is
 * active, the shared 60s stage clock, and boundary-only persistence — but
 * NOT any stage's own puzzle-serving/scoring logic. That stays inside
 * useTraceSession/useRushSession/useBossSession, called directly by each
 * stage component (Task 4: TraceStage/SpeedStage/BossStage), never by this
 * hook — calling all three unconditionally here would violate Rules of
 * Hooks (can't conditionally call only the active stage's hook in one
 * function body) and would run the two inactive hooks' real mount effects
 * (loadProfile/startRun) on every render regardless of which stage is
 * actually active. See docs/design/click-meaningfulness.md §3 and
 * docs/superpowers/plans/2026-08-11-missions-definition-and-plan.md for
 * the full design record.
 *
 * Persistence discipline (the resume/abandon mechanism): `missionProgress`
 * is written to storage ONLY at stage boundaries — mission start
 * (handleStartStage, first time only), each stage transition
 * (handleStageComplete), explicit abandon (handleAbandon) — NEVER mid-stage.
 * This is what makes a bare tab close silently resumable (nothing to write,
 * nothing to distinguish from an ordinary resumable state) while only the
 * explicit "Exit mission" action clears progress early.
 *
 * Native-end vs. timer-cutoff (see the design doc's §3): this hook doesn't
 * decide which one happened — the calling stage component does (by reading
 * its own useRushSession/useBossSession's `phase`/`status` vs. calling
 * hasStageClockExpired itself) and passes `endedReason` into
 * handleStageComplete. This hook just records whichever it's told.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MISSION_STAGE_ORDER, loadProfile, saveProfile } from '../../storage'
import type {
  MissionProgress,
  MissionStageId,
  MissionStageStats,
  MissionStageSummary,
  MissionStats,
  UserProfile,
} from '../../storage'
import type { MissionStageCompletePayload } from '../../telemetry'
import {
  trackError,
  trackMissionAbandoned,
  trackMissionFinished,
  trackMissionStageComplete,
  trackMissionStart,
} from '../../telemetry'
import { MISSION_STAGE_DURATION_MS } from './missionStageClock'

export type MissionSessionStatus = 'loading' | 'ready' | 'error'

/** 'checkpoint' = the pre-stage arc screen (first entry, every inter-stage transition, and mid-arc resume); a MissionStageId = that stage actively playing; 'complete' = the payoff screen. */
export type MissionPhase = 'checkpoint' | MissionStageId | 'complete'

export interface MissionSession {
  status: MissionSessionStatus
  profile: UserProfile | null
  phase: MissionPhase
  /** The stage about to start (phase 'checkpoint') or actively playing (phase matches it). Meaningless once phase === 'complete'. */
  currentStage: MissionStageId
  /** Stage summaries banked so far this run, in play order. */
  completedStages: readonly MissionStageSummary[]
  /** Fixed deadline (Date.now()-based) for the active stage's clock. Null outside an active stage. */
  stageDeadlineMs: number | null
  /** Ticking countdown for display, mirrors useRushSession's remainingMs. 0 outside an active stage. */
  remainingMs: number
  /** The profile's updated mission stats, populated once phase === 'complete'. */
  finishedStats: MissionStats | null
  /** From the checkpoint screen: begins currentStage's active play, starting its 60s clock. */
  handleStartStage: () => void
  /** Called by whichever stage component is mounted once its stage has ended. Advances to the next stage's checkpoint, or to 'complete' after Boss. */
  handleStageComplete: (stats: MissionStageStats, endedReason: 'timer' | 'native') => void
  /** Explicit "Exit mission" action — clears progress, fires trackMissionAbandoned, resets to a fresh checkpoint at stage 1. */
  handleAbandon: () => void
  /** From the payoff screen: starts a brand-new run. */
  handleRunItAgain: () => void
  retryLoad: () => void
}

function nextStage(stage: MissionStageId): MissionStageId | null {
  const index = MISSION_STAGE_ORDER.indexOf(stage)
  return MISSION_STAGE_ORDER[index + 1] ?? null
}

/** Snake_cases a stored MissionStageStats into telemetry's locked payload shape — see events.ts's MissionStageCompletePayload doc comment for why the two are kept in sync rather than sharing one vocabulary. */
function toTelemetryStats(stats: MissionStageStats): MissionStageCompletePayload['stats'] {
  switch (stats.stageId) {
    case 'trace':
      return {
        stage_id: 'trace',
        puzzles_completed: stats.puzzlesCompleted,
        solved_count: stats.solvedCount,
      }
    case 'speed':
      return {
        stage_id: 'speed',
        solved_count: stats.solvedCount,
        best_streak_this_run: stats.bestStreakThisRun,
      }
    case 'boss':
      return { stage_id: 'boss', depth_reached: stats.depthReached, cleared: stats.cleared }
  }
}

export function useMissionSession(): MissionSession {
  const [status, setStatus] = useState<MissionSessionStatus>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [phase, setPhase] = useState<MissionPhase>('checkpoint')
  const [currentStage, setCurrentStage] = useState<MissionStageId>(MISSION_STAGE_ORDER[0])
  const [completedStages, setCompletedStages] = useState<MissionStageSummary[]>([])
  const [remainingMs, setRemainingMs] = useState(0)
  const [finishedStats, setFinishedStats] = useState<MissionStats | null>(null)
  // The public deadline value — real React state (safe to read during
  // render, e.g. from the returned object below), kept in sync with
  // deadlineRef by every setDeadline call. Null outside an active stage.
  const [stageDeadlineMs, setStageDeadlineMs] = useState<number | null>(null)

  const runIdRef = useRef<string>(crypto.randomUUID())
  const startedAtRef = useRef(new Date().toISOString())
  // Fast, effect-internal mirror of stageDeadlineMs, in Date.now() terms —
  // same convention as useRushSession's own deadlineRef. Read by the ticking
  // interval/visibilitychange effects below without waiting on a render;
  // never read directly during render (react-hooks/refs) — that's what
  // stageDeadlineMs state is for. Always written through setDeadline so the
  // two never drift apart.
  const deadlineRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)

  const setDeadline = useCallback((value: number | null) => {
    deadlineRef.current = value
    setStageDeadlineMs(value)
  }, [])

  const hydrateFromProfile = useCallback(
    (loaded: UserProfile) => {
      setProfile(loaded)
      const progress = loaded.missionProgress
      if (progress) {
        runIdRef.current = progress.runId
        startedAtRef.current = progress.startedAt
        setCurrentStage(progress.currentStage)
        setCompletedStages(progress.completedStages)
      } else {
        runIdRef.current = crypto.randomUUID()
        startedAtRef.current = new Date().toISOString()
        setCurrentStage(MISSION_STAGE_ORDER[0])
        setCompletedStages([])
      }
      setPhase('checkpoint')
      setDeadline(null)
      setRemainingMs(0)
      setFinishedStats(null)
      setStatus('ready')
    },
    [setDeadline],
  )

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        hydrateFromProfile(loaded)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useMissionSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as every other session hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryLoad = useCallback(() => {
    cancelledRef.current = false
    setStatus('loading')
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        hydrateFromProfile(loaded)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useMissionSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
  }, [hydrateFromProfile])

  // Ticking display clock while an active stage is in progress — mirrors
  // useRushSession's own interval pattern. Purely cosmetic (remainingMs for
  // a UI countdown): it never itself ends a stage — see missionStageClock.ts's
  // doc comment for why that check is pull-based, at each stage component's
  // own onContinue interception, not push-based from this interval.
  useEffect(() => {
    if (phase === 'checkpoint' || phase === 'complete') return
    const interval = setInterval(() => {
      if (document.hidden) return
      if (deadlineRef.current === null) return
      setRemainingMs(Math.max(0, deadlineRef.current - Date.now()))
    }, 100)
    return () => {
      clearInterval(interval)
    }
  }, [phase])

  // A backgrounded tab must not silently drain the clock — same
  // deadline-pushback pattern as useRushSession's own visibilitychange
  // effect, applied to this hook's own deadlineRef instead.
  useEffect(() => {
    let hiddenAt: number | null = null
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
      } else if (hiddenAt !== null && deadlineRef.current !== null) {
        setDeadline(deadlineRef.current + (Date.now() - hiddenAt))
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [setDeadline])

  const handleStartStage = useCallback(() => {
    if (phase !== 'checkpoint' || status !== 'ready' || !profile) return

    // The actual "mission started" boundary for a brand-new run — persisted
    // here, not at hydration (hydrateFromProfile only reads/derives local
    // state). Guarded so this fires exactly once per run: completedStages
    // empty AND missionProgress still null distinguishes "truly never
    // persisted" from "resumed mid-arc with nothing completed yet" (a
    // profile whose missionProgress already has currentStage/startedAt set,
    // even with an empty completedStages array, must not be re-written here).
    if (completedStages.length === 0 && profile.missionProgress === null) {
      const progress: MissionProgress = {
        runId: runIdRef.current,
        currentStage,
        completedStages: [],
        startedAt: startedAtRef.current,
      }
      const updated: UserProfile = { ...profile, missionProgress: progress }
      setProfile(updated)
      saveProfile(updated).catch((error: unknown) => {
        trackError(error, 'useMissionSession: saveProfile failed (mission start)')
      })
      trackMissionStart({ run_id: runIdRef.current })
    }

    setDeadline(Date.now() + MISSION_STAGE_DURATION_MS)
    setRemainingMs(MISSION_STAGE_DURATION_MS)
    setPhase(currentStage)
  }, [phase, status, profile, completedStages, currentStage, setDeadline])

  const handleStageComplete = useCallback(
    (stats: MissionStageStats, endedReason: 'timer' | 'native') => {
      if (!profile || phase === 'checkpoint' || phase === 'complete') return

      const summary: MissionStageSummary = {
        stats,
        endedReason,
        completedAt: new Date().toISOString(),
      }
      const newCompletedStages = [...completedStages, summary]

      trackMissionStageComplete({
        run_id: runIdRef.current,
        stage: currentStage,
        ended_reason: endedReason,
        stats: toTelemetryStats(stats),
      })

      setDeadline(null)
      setRemainingMs(0)

      const next = nextStage(currentStage)
      if (next === null) {
        // Boss (the last stage in MISSION_STAGE_ORDER) just ended — the
        // whole mission is finished. missionProgress clears (the run is no
        // longer "in progress"); missionStats records the completion.
        const priorStats = profile.missionStats
        const nowIso = new Date().toISOString()
        const newMissionStats: MissionStats = {
          completions: (priorStats?.completions ?? 0) + 1,
          lastRunAt: nowIso,
          lastCompletedAt: nowIso,
        }
        const updated: UserProfile = {
          ...profile,
          missionProgress: null,
          missionStats: newMissionStats,
        }
        setProfile(updated)
        setCompletedStages(newCompletedStages)
        setFinishedStats(newMissionStats)
        setPhase('complete')
        saveProfile(updated).catch((error: unknown) => {
          trackError(error, 'useMissionSession: saveProfile failed (mission finished)')
        })
        trackMissionFinished({
          run_id: runIdRef.current,
          completions: newMissionStats.completions,
        })
        return
      }

      const progress: MissionProgress = {
        runId: runIdRef.current,
        currentStage: next,
        completedStages: newCompletedStages,
        startedAt: startedAtRef.current,
      }
      const updated: UserProfile = { ...profile, missionProgress: progress }
      setProfile(updated)
      setCompletedStages(newCompletedStages)
      setCurrentStage(next)
      setPhase('checkpoint')
      saveProfile(updated).catch((error: unknown) => {
        trackError(error, 'useMissionSession: saveProfile failed (stage complete)')
      })
    },
    [profile, phase, completedStages, currentStage, setDeadline],
  )

  const handleAbandon = useCallback(() => {
    if (!profile || phase === 'complete') return

    trackMissionAbandoned({
      run_id: runIdRef.current,
      stage: currentStage,
      completed_stage_count: completedStages.length,
    })

    const updated: UserProfile = { ...profile, missionProgress: null }
    setProfile(updated)
    saveProfile(updated).catch((error: unknown) => {
      trackError(error, 'useMissionSession: saveProfile failed (abandon)')
    })

    runIdRef.current = crypto.randomUUID()
    startedAtRef.current = new Date().toISOString()
    setDeadline(null)
    setRemainingMs(0)
    setCurrentStage(MISSION_STAGE_ORDER[0])
    setCompletedStages([])
    setPhase('checkpoint')
  }, [profile, phase, currentStage, completedStages, setDeadline])

  const handleRunItAgain = useCallback(() => {
    if (!profile || phase !== 'complete') return

    runIdRef.current = crypto.randomUUID()
    startedAtRef.current = new Date().toISOString()
    setDeadline(null)
    setRemainingMs(0)
    setCurrentStage(MISSION_STAGE_ORDER[0])
    setCompletedStages([])
    setFinishedStats(null)
    setPhase('checkpoint')
  }, [profile, phase, setDeadline])

  return {
    status,
    profile,
    phase,
    currentStage,
    completedStages,
    stageDeadlineMs,
    remainingMs,
    finishedStats,
    handleStartStage,
    handleStageComplete,
    handleAbandon,
    handleRunItAgain,
    retryLoad,
  }
}
