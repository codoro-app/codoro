/**
 * Orchestrates the Boss loop: serve BOSS_RUN in fixed order, 3-strikes-ends-
 * it (BOSS_STRIKE_LIMIT), best-depth-ever persistence. Deliberately much
 * simpler than useRushSession: no per-puzzle clock (Boss's settled design
 * questions never call for one — see the Boss Challenges plan's design
 * record), and no live difficulty selection (the run order is fixed, see
 * bossRun.ts) — so there's no widening pool, no rng, no interval/
 * visibilitychange machinery to manage.
 *
 * "Depth reached" is the run's score: the 1-indexed position of the last
 * puzzle the run reached, whether that puzzle was answered right or wrong,
 * capped at BOSS_RUN.length. `cleared` is true whenever depth reached ===
 * BOSS_RUN.length, independent of strikes — a run whose 3rd strike lands
 * exactly on the 10th puzzle still reports cleared: true (it did reach the
 * end of the sequence) even though ended_reason still reports 'strikes'
 * (that's what actually ended it). Both facts are real; neither is dropped.
 *
 * Boss is unrated by construction, not by omission: shouldRateAttempt
 * (rating.ts) hardcodes `mode === 'boss' -> false`, so `rates` below is
 * always false and the `updateRating` call is provably dead code —
 * identical structure to useRushSession's own guard. See this file's own
 * test's "never rates" describe block.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { BOSS_STRIKE_LIMIT, shouldRateAttempt, updateRating } from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, BossStats, UserProfile } from '../../storage'
import { quizPool, BOSS_RUN } from '../../content'
import { resolvePool } from '../devTools/devPuzzleMode'
import type { Puzzle as ContentPuzzle } from '../../content'
import { trackError, trackBossAttempt, trackBossRunEnd } from '../../telemetry'
import type { CommitPayload } from '../practice/interactionTypes'

/** Local calendar-date string (YYYY-MM-DD) — same convention as every other session hook. */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export type BossSessionStatus = 'loading' | 'ready' | 'empty' | 'error'
export type BossPhase = 'playing' | 'ended'

export interface BossRunSummary {
  depthReached: number
  cleared: boolean
  /** All-time deepest run, post this run's update. */
  bestDepthEver: number
  /** True when this run's depthReached just beat the profile's prior all-time bestDepth. */
  isNewBestDepth: boolean
}

export interface BossSession {
  status: BossSessionStatus
  phase: BossPhase
  profile: UserProfile | null
  puzzle: ContentPuzzle | null
  strikes: number
  /** 1-indexed position of the currently served puzzle within BOSS_RUN. */
  position: number
  /** Populated once phase === 'ended'. */
  runSummary: BossRunSummary | null
  handleAnswered: (payload: CommitPayload) => void
  handleContinue: () => void
  handleRunItBack: () => void
  retryLoad: () => void
}

export function useBossSession(): BossSession {
  const [status, setStatus] = useState<BossSessionStatus>('loading')
  const [phase, setPhase] = useState<BossPhase>('playing')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [puzzle, setPuzzle] = useState<ContentPuzzle | null>(null)
  const [strikes, setStrikes] = useState(0)
  const [position, setPosition] = useState(0)
  const [runSummary, setRunSummary] = useState<BossRunSummary | null>(null)

  const runIdRef = useRef(crypto.randomUUID())
  const servedAtRef = useRef(0)
  const pendingEndRef = useRef(false)
  const pendingNextIndexRef = useRef(0)
  const cancelledRef = useRef(false)

  const activePool = resolvePool(quizPool)
  const contentById = useRef(new Map(activePool.map((p) => [p.id, p])))

  const serveAt = useCallback((index: number) => {
    const id = BOSS_RUN[index]
    if (id === undefined) {
      setPuzzle(null)
      setStatus('empty')
      return
    }
    const fullPuzzle = contentById.current.get(id)
    if (!fullPuzzle) {
      setPuzzle(null)
      setStatus('empty')
      return
    }
    setPuzzle(fullPuzzle)
    setPosition(index + 1)
    servedAtRef.current = Date.now()
    setStatus('ready')
  }, [])

  const startRun = useCallback(() => {
    runIdRef.current = crypto.randomUUID()
    pendingEndRef.current = false
    pendingNextIndexRef.current = 0
    setPhase('playing')
    setStrikes(0)
    setRunSummary(null)
    serveAt(0)
  }, [serveAt])

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        startRun()
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useBossSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as useRushSession.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryLoad = useCallback(() => {
    cancelledRef.current = false
    setStatus('loading')
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        startRun()
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useBossSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
  }, [startRun])

  const endRun = useCallback((currentProfile: UserProfile, finalPosition: number) => {
    const cleared = finalPosition >= BOSS_RUN.length
    const priorStats = currentProfile.bossStats
    const isNewBestDepth = finalPosition > (priorStats?.bestDepth ?? 0)
    const newBossStats: BossStats = {
      bestDepth: Math.max(priorStats?.bestDepth ?? 0, finalPosition),
      clears: (priorStats?.clears ?? 0) + (cleared ? 1 : 0),
      runs: (priorStats?.runs ?? 0) + 1,
      lastRunAt: new Date().toISOString(),
    }
    const updatedProfile: UserProfile = { ...currentProfile, bossStats: newBossStats }
    setProfile(updatedProfile)
    saveProfile(updatedProfile).catch((error: unknown) => {
      trackError(error, 'useBossSession: saveProfile failed')
    })
    trackBossRunEnd({
      run_id: runIdRef.current,
      depth_reached: finalPosition,
      cleared,
      is_new_best_depth: isNewBestDepth,
    })
    setRunSummary({
      depthReached: finalPosition,
      cleared,
      bestDepthEver: newBossStats.bestDepth,
      isNewBestDepth,
    })
    setPhase('ended')
  }, [])

  const handleAnswered = useCallback(
    (payload: CommitPayload) => {
      if (!profile || !puzzle || phase !== 'playing') return

      const timeMs = Math.max(0, Date.now() - servedAtRef.current)
      const today = todayDateString()

      // Boss never rates — see this file's doc comment.
      const rates = shouldRateAttempt('boss', false)
      const oldRating = profile.rating
      const newRating = rates
        ? updateRating(
            oldRating,
            puzzle.difficulty_rating,
            payload.correct,
            profile.ratedAttemptCount,
          )
        : oldRating

      const attempt: Attempt = {
        id: crypto.randomUUID(),
        puzzleId: puzzle.id,
        puzzleRating: puzzle.difficulty_rating,
        mode: 'boss',
        correct: payload.correct,
        time_ms: timeMs,
        choice_index: payload.choiceIndex,
        checkpoint_results: null,
        userRatingBefore: oldRating,
        userRatingAfter: newRating,
        localDateString: today,
        createdAt: new Date().toISOString(),
      }

      appendAttempt(attempt).catch((error: unknown) => {
        trackError(error, 'useBossSession: appendAttempt failed')
      })

      trackBossAttempt({
        puzzle_id: puzzle.id,
        correct: payload.correct,
        time_ms: timeMs,
        mode: 'boss',
        interaction: puzzle.interaction,
        user_rating_before: oldRating,
        user_rating_after: newRating,
        run_id: runIdRef.current,
        position_in_run: position,
      })

      const newStrikes = payload.correct ? strikes : strikes + 1
      setStrikes(newStrikes)

      const reachedEnd = position >= BOSS_RUN.length
      pendingEndRef.current = newStrikes >= BOSS_STRIKE_LIMIT || reachedEnd
      pendingNextIndexRef.current = position
    },
    [profile, puzzle, phase, strikes, position],
  )

  const handleContinue = useCallback(() => {
    if (!profile || phase !== 'playing') return
    if (pendingEndRef.current) {
      endRun(profile, position)
      return
    }
    serveAt(pendingNextIndexRef.current)
  }, [profile, phase, position, serveAt, endRun])

  const handleRunItBack = useCallback(() => {
    if (!profile) return
    startRun()
  }, [profile, startRun])

  return {
    status,
    phase,
    profile,
    puzzle,
    strikes,
    position,
    runSummary,
    handleAnswered,
    handleContinue,
    handleRunItBack,
    retryLoad,
  }
}
