/**
 * Orchestrates the Boss loop: serve the run's active BOSS_SETS entry in
 * fixed order, 3-strikes-ends-it (BOSS_STRIKE_LIMIT), best-depth-ever
 * persistence. Deliberately much simpler than useRushSession: no
 * per-puzzle clock (Boss's settled design questions never call for one —
 * see the Boss Challenges plan's design record), and no live difficulty
 * selection (each run's order is a fixed, pre-authored sequence, see
 * bossRun.ts) — so there's no widening pool, no rng, no interval/
 * visibilitychange machinery to manage.
 *
 * BOSS_SETS rotation (engagement pass): a run no longer always plays the
 * same 10 puzzles — resolveActiveBossSet(runsCompleted) picks which
 * BOSS_SETS entry this run serves, keyed off bossStats.runs at the moment
 * the run starts. That resolution happens exactly ONCE per run, in
 * startRun, and is cached in activeSetRef for the run's entire lifetime —
 * never recomputed per puzzle. This matters: bossStats.runs only changes
 * when a run ends (endRun writes the incremented count), so nothing
 * *could* change it mid-run today, but resolving it once at run start
 * rather than reading BOSS_SETS/profile.bossStats.runs live on every
 * serveAt call is still the deliberate contract — it's what makes "this
 * run stays on one set from puzzle 1 to its end" true by construction
 * rather than true by accident of when runs happens to change.
 *
 * "Depth reached" is the run's score: the 1-indexed position of the last
 * puzzle the run reached, whether that puzzle was answered right or wrong,
 * capped at the active set's length. This always hits that length once a
 * run gets that far — there's no puzzle 11 to fail into — so depth alone
 * can't distinguish "answered puzzle 10 correctly" from "answered it wrong
 * but it wasn't the 3rd strike" from "answered it wrong AS the 3rd
 * strike". `cleared` is the fact that actually makes that distinction:
 * true only when the run reached the end of the sequence WITHOUT being
 * struck out (`finalStrikes < BOSS_STRIKE_LIMIT`) — a run that reaches the
 * last puzzle and loses its 3rd strike there is `cleared: false`, exactly
 * like striking out on any earlier puzzle. `ended_reason` names which of
 * the two ending conditions actually fired (`'strikes'` vs `'completed'`),
 * independent of `cleared`/`depthReached` — Amendment finding from the
 * Phase 1 final review: an earlier draft computed `cleared` from depth
 * alone (true whenever position reached the end, regardless of the final
 * answer) and documented an `ended_reason` field this file never actually
 * shipped — both fixed together here, since they're the same underlying
 * question ("what does a run's outcome actually mean?").
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
import { quizPool, BOSS_SETS, resolveActiveBossSet } from '../../content'
import { isDevPuzzleModeEnabled, resolveBossStubPuzzle } from '../devTools/devPuzzleMode'
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
  /** True only when the run reached the active set's length WITHOUT being struck out — see this file's doc comment for why depth alone can't tell the two apart. */
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
  /** 1-indexed position of the currently served puzzle within this run's active set. */
  position: number
  /** Length of this run's active set (BOSS_SETS rotation) — always the current run's real puzzle count, not a hardcoded constant. */
  totalPuzzles: number
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
  // Mirrors activeSetRef.current.length as real state (not a ref read at
  // render time — eslint's react-hooks/refs rule disallows accessing
  // ref.current during render): set once per run start, alongside
  // strikes/position, from the same activeSet startRun just resolved.
  const [totalPuzzles, setTotalPuzzles] = useState(() => resolveActiveBossSet(0).length)
  const [runSummary, setRunSummary] = useState<BossRunSummary | null>(null)

  const runIdRef = useRef(crypto.randomUUID())
  const servedAtRef = useRef(0)
  const pendingEndRef = useRef(false)
  const pendingNextIndexRef = useRef(0)
  const cancelledRef = useRef(false)

  // This run's resolved BOSS_SETS entry + its index, cached once at
  // startRun and read (never recomputed) by serveAt/endRun/handleAnswered
  // for the rest of the run — see this file's own doc comment.
  const activeSetRef = useRef<readonly string[]>(resolveActiveBossSet(0))
  const setIndexRef = useRef(0)

  const contentById = useRef(new Map(quizPool.map((p) => [p.id, p])))

  const serveAt = useCallback((index: number) => {
    // Dev-stub swap (see devPuzzleMode.ts's own doc comment): the curated
    // BOSS_SETS ids don't exist in DEV_STUB_PUZZLES, so — unlike
    // useRushSession's resolvePool(quizPool), which swaps the whole pool —
    // Boss branches explicitly and asks for a stub keyed by run position,
    // the same fix Daily already needed for its own curated calendar.
    if (isDevPuzzleModeEnabled()) {
      setPuzzle(resolveBossStubPuzzle(index))
      setPosition(index + 1)
      servedAtRef.current = Date.now()
      setStatus('ready')
      return
    }
    const id = activeSetRef.current[index]
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

  const startRun = useCallback(
    (activeProfile: UserProfile) => {
      const runsCompleted = activeProfile.bossStats?.runs ?? 0
      const activeSet = resolveActiveBossSet(runsCompleted)
      activeSetRef.current = activeSet
      setIndexRef.current = runsCompleted % BOSS_SETS.length
      runIdRef.current = crypto.randomUUID()
      pendingEndRef.current = false
      pendingNextIndexRef.current = 0
      setPhase('playing')
      setStrikes(0)
      setTotalPuzzles(activeSet.length)
      setRunSummary(null)
      serveAt(0)
    },
    [serveAt],
  )

  /** Shared by the mount effect and retryLoad — was duplicated verbatim before (Phase 1 final review finding); one copy now, one error-context string. */
  const loadAndStart = useCallback(() => {
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        startRun(loaded)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useBossSession: loadProfile failed')
        setStatus('error')
      }
    })()
  }, [startRun])

  useEffect(() => {
    cancelledRef.current = false
    loadAndStart()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as useRushSession.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryLoad = useCallback(() => {
    cancelledRef.current = false
    setStatus('loading')
    loadAndStart()
  }, [loadAndStart])

  const endRun = useCallback(
    (currentProfile: UserProfile, finalPosition: number, finalStrikes: number) => {
      const struckOut = finalStrikes >= BOSS_STRIKE_LIMIT
      const cleared = finalPosition >= activeSetRef.current.length && !struckOut
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
        ended_reason: struckOut ? 'strikes' : 'completed',
        is_new_best_depth: isNewBestDepth,
        set_index: setIndexRef.current,
      })
      setRunSummary({
        depthReached: finalPosition,
        cleared,
        bestDepthEver: newBossStats.bestDepth,
        isNewBestDepth,
      })
      setPhase('ended')
    },
    [],
  )

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
        set_index: setIndexRef.current,
      })

      const newStrikes = payload.correct ? strikes : strikes + 1
      setStrikes(newStrikes)

      const reachedEnd = position >= activeSetRef.current.length
      pendingEndRef.current = newStrikes >= BOSS_STRIKE_LIMIT || reachedEnd
      pendingNextIndexRef.current = position
    },
    [profile, puzzle, phase, strikes, position],
  )

  const handleContinue = useCallback(() => {
    if (!profile || phase !== 'playing') return
    if (pendingEndRef.current) {
      endRun(profile, position, strikes)
      return
    }
    serveAt(pendingNextIndexRef.current)
  }, [profile, phase, position, strikes, serveAt, endRun])

  const handleRunItBack = useCallback(() => {
    if (!profile) return
    startRun(profile)
  }, [profile, startRun])

  return {
    status,
    phase,
    profile,
    puzzle,
    strikes,
    position,
    totalPuzzles,
    runSummary,
    handleAnswered,
    handleContinue,
    handleRunItBack,
    retryLoad,
  }
}
