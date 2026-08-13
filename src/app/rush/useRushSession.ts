/**
 * Orchestrates the Rush loop: escalating-difficulty serving via engine's
 * rush.ts, 3-strikes-ends-it, in-run streak/solved tracking, and Rush's
 * all-time best-score/best-streak persistence. Mirrors useDailySession's/
 * usePracticeSession's shape but for a session that spans many puzzles with
 * its own end condition instead of one puzzle (Daily) or an endless stream
 * (Practice).
 *
 * handleAnswered/handleContinue are split exactly like Daily/Practice's own
 * onAnswered/onContinue: handleAnswered fires the instant a commit lands
 * (records the attempt, updates strikes/streak/solvedCount) but does NOT
 * itself serve the next puzzle or end the run — PuzzleCardShell still needs
 * to show its feedback panel first. handleContinue (PuzzleCardShell's own
 * Continue button) is what actually advances: to the next puzzle, or — if
 * the just-recorded answer was the 3rd strike — into the ended phase. This
 * is why `pendingEndRef`/`pendingDifficultyRef` exist: they're the decision
 * handleAnswered computed, waiting for the Continue tap to act on it.
 *
 * Rush is unrated by construction, not by omission: shouldRateAttempt
 * (rating.ts) hardcodes `mode === 'rush' -> false`, so `rates` below is
 * always false and the `updateRating` call on the next line is provably
 * dead code — structurally identical to how usePracticeSession/
 * useDailySession call the same function for their own (always-true /
 * conditionally-true) modes. See useRushSession.test.ts's "never rates"
 * describe block, which spies on `updateRating` across a full simulated run
 * (including wrong answers) and asserts zero calls — the guard the build
 * plan requires at the orchestration layer, not just at shouldRateAttempt's
 * own unit test.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RUSH_STRIKE_LIMIT,
  selectRushPuzzle,
  shouldRateAttempt,
  startingRushDifficulty,
  stepDifficulty,
  updateRating,
} from '../../engine'
import type { RushInteraction, RushPuzzle } from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, RushStats, UserProfile } from '../../storage'
import { quizPool } from '../../content'
import { resolvePool } from '../devTools/devPuzzleMode'
import type { Puzzle as ContentPuzzle } from '../../content'
import { trackError, trackRushAttempt, trackRushRunEnd } from '../../telemetry'
import type { ChallengeAttemptInput } from '../../challenge'
import type { CommitPayload } from '../practice/interactionTypes'

/**
 * Flat per-puzzle clock (Phase 5b Item 6, decision 4/5) — untuned: no
 * production telemetry has ever fired (docs/v2-backlog.md), so there's no
 * attempt-duration distribution to size this against. Flat rather than
 * compressing with difficulty (decision 5): the difficulty ramp already
 * makes each puzzle take longer to read against this same clock, and
 * compounding two untuned curves would make a miss untraceable to either
 * one. Play-test and adjust.
 */
export const RUSH_PUZZLE_TIME_LIMIT_MS = 15_000

/** How often the on-screen countdown updates. Purely a render-smoothness constant, not a game-rule number — unrelated to RUSH_PUZZLE_TIME_LIMIT_MS's own tuning. */
const RUSH_TIMER_TICK_MS = 100

/** Local calendar-date string (YYYY-MM-DD) from wall-clock time — same convention as every other session hook. */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

/**
 * Rush is quiz-only — scrubber's multi-checkpoint attempt shape doesn't fit
 * Rush's single strike-or-solve-and-move-on loop (Phase 2/3 build plan).
 * RushInteraction's own union already excludes 'scrubber'; this guard is
 * what keeps a puzzle with that discriminant from ever reaching
 * toRushPuzzle in the first place, rather than relying on the type error
 * `tsc` would otherwise raise at the call site to catch it.
 */
function isRushEligible(
  puzzle: ContentPuzzle,
): puzzle is ContentPuzzle & { interaction: RushInteraction } {
  return (
    puzzle.interaction === 'mcq' ||
    puzzle.interaction === 'swipe-binary' ||
    puzzle.interaction === 'tap-line'
  )
}

function toRushPuzzle(puzzle: ContentPuzzle & { interaction: RushInteraction }): RushPuzzle {
  return { id: puzzle.id, rating: puzzle.difficulty_rating, interaction: puzzle.interaction }
}

export type RushSessionStatus = 'loading' | 'ready' | 'empty' | 'error'
export type RushPhase = 'playing' | 'ended'

export interface RushRunSummary {
  solvedCount: number
  bestStreakThisRun: number
  /** All-time longest in-run streak, post this run's update. */
  longestStreakEver: number
  /** All-time highest solved-count, post this run's update. */
  bestScoreEver: number
  /** True when this run's solvedCount just beat the profile's prior all-time bestScore (Phase 5b Item 8) — never fires on a rating basis, see the build plan's amendment. */
  isNewBestScore: boolean
}

export interface RushSession {
  status: RushSessionStatus
  phase: RushPhase
  profile: UserProfile | null
  puzzle: ContentPuzzle | null
  strikes: number
  solvedCount: number
  /** In-run correct-answer streak. Resets to 0 on a miss, resets on a new run. */
  currentStreak: number
  bestStreakThisRun: number
  /** Populated once phase === 'ended'. */
  runSummary: RushRunSummary | null
  /** Milliseconds left on the current puzzle's clock (Phase 5b Item 6) — RUSH_PUZZLE_TIME_LIMIT_MS when a puzzle is freshly served, ticking down to 0. Meaningless once phase !== 'playing'. */
  remainingMs: number
  /** Set once the current puzzle's clock reaches 0 before the player answers — pass straight through to PuzzleCardShell's own `forcedCommit` prop. Cleared on every new puzzle. */
  forcedCommit: CommitPayload | undefined
  /** Every attempt of the current run, in play order (correct and incorrect alike) — feeds the end-of-run challenge link. Reset by startRun. */
  runAttempts: readonly ChallengeAttemptInput[]
  /**
   * True once the just-answered puzzle's outcome means the NEXT Continue tap
   * ends the run (3rd strike) rather than serving another puzzle — mirrors
   * `pendingEndRef`'s own decision (2b.2 click-meaningfulness fix), exposed
   * as real state so the Continue button can preview "See results" instead
   * of "Next puzzle" before the tap. False while `phase !== 'playing'` or no
   * puzzle has been answered yet.
   */
  willEndOnContinue: boolean
  handleAnswered: (payload: CommitPayload) => void
  handleContinue: () => void
  handleRunItBack: () => void
  retryLoad: () => void
}

export function useRushSession(): RushSession {
  const [status, setStatus] = useState<RushSessionStatus>('loading')
  const [phase, setPhase] = useState<RushPhase>('playing')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [puzzle, setPuzzle] = useState<ContentPuzzle | null>(null)
  const [difficulty, setDifficulty] = useState(0)
  const [strikes, setStrikes] = useState(0)
  const [solvedCount, setSolvedCount] = useState(0)
  const [currentStreak, setCurrentStreak] = useState(0)
  const [bestStreakThisRun, setBestStreakThisRun] = useState(0)
  const [runSummary, setRunSummary] = useState<RushRunSummary | null>(null)
  const [remainingMs, setRemainingMs] = useState(RUSH_PUZZLE_TIME_LIMIT_MS)
  const [forcedCommit, setForcedCommit] = useState<CommitPayload | undefined>(undefined)
  const [runAttempts, setRunAttempts] = useState<ChallengeAttemptInput[]>([])
  const [willEndOnContinue, setWillEndOnContinue] = useState(false)

  const runIdRef = useRef(crypto.randomUUID())
  const positionRef = useRef(0)
  const usedIdsRef = useRef<Set<string>>(new Set())
  const servedAtRef = useRef(0)
  const pendingDifficultyRef = useRef(0)
  const pendingEndRef = useRef(false)
  const cancelledRef = useRef(false)
  // Deadline for the CURRENT puzzle's clock, in Date.now() terms (not a
  // countdown-from value) — this is what a visibilitychange pause pushes
  // back, rather than needing to separately track "how much was already
  // ticked off."
  const deadlineRef = useRef(0)
  // Guards the timer from firing a forced commit after a real tap already
  // landed for the current puzzle (and vice versa) — same race PuzzleCardShell
  // itself already guards against via its own `committed` check, but the
  // interval needs its own flag since it runs independently of that render.
  const answeredRef = useRef(false)
  // Whether the run's most recent MISS (if any) was itself a timeout —
  // read by endRun to report `ended_reason` on the run that miss ends.
  const lastMissTimedOutRef = useRef(false)

  const activePool = resolvePool(quizPool)
  const contentById = useRef(new Map(activePool.map((p) => [p.id, p])))
  const rushPool = useRef(activePool.filter(isRushEligible).map(toRushPuzzle))

  const serveNext = useCallback((atDifficulty: number) => {
    const result = selectRushPuzzle({
      pool: rushPool.current,
      difficulty: atDifficulty,
      usedIds: usedIdsRef.current,
      rng: Math.random,
    })
    if (result === null) {
      setPuzzle(null)
      setStatus('empty')
      return
    }
    const fullPuzzle = contentById.current.get(result.puzzle.id)
    if (!fullPuzzle) {
      throw new Error(`selectRushPuzzle returned unknown puzzle id "${result.puzzle.id}"`)
    }
    positionRef.current += 1
    setPuzzle(fullPuzzle)
    setDifficulty(atDifficulty)
    servedAtRef.current = Date.now()
    deadlineRef.current = Date.now() + RUSH_PUZZLE_TIME_LIMIT_MS
    answeredRef.current = false
    setRemainingMs(RUSH_PUZZLE_TIME_LIMIT_MS)
    setForcedCommit(undefined)
    setWillEndOnContinue(false)
    setStatus('ready')
  }, [])

  const startRun = useCallback(
    (currentProfile: UserProfile) => {
      runIdRef.current = crypto.randomUUID()
      positionRef.current = 0
      usedIdsRef.current = new Set()
      pendingDifficultyRef.current = 0
      pendingEndRef.current = false
      setPhase('playing')
      setStrikes(0)
      setSolvedCount(0)
      setCurrentStreak(0)
      setBestStreakThisRun(0)
      setRunSummary(null)
      setRunAttempts([])
      serveNext(startingRushDifficulty(currentProfile.rating))
    },
    [serveNext],
  )

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        startRun(loaded)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useRushSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as usePracticeSession/useDailySession.
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
        startRun(loaded)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useRushSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
  }, [startRun])

  // The clock itself: ticks deadlineRef down to a rendered remainingMs, and
  // synthesizes a timeout (forcedCommit) once it reaches 0 — PuzzleCardShell
  // reacts to forcedCommit exactly like a real tap (see its own doc
  // comment), so handleAnswered below still only ever fires once per puzzle
  // regardless of which path (tap or timeout) reaches it first.
  useEffect(() => {
    if (phase !== 'playing' || puzzle === null) return
    const interval = setInterval(() => {
      if (answeredRef.current) return
      // Real browsers typically throttle/pause a backgrounded tab's
      // intervals, but that's a performance behavior, not a correctness
      // guarantee this code can rely on — skipping explicitly while hidden
      // means the clock can't expire from ticks that fire anyway (a
      // browser that doesn't throttle, or a test environment's fake
      // timers, which don't). The visibilitychange effect below still
      // pushes the deadline forward once the tab becomes visible again.
      if (document.hidden) return
      const left = Math.max(0, deadlineRef.current - Date.now())
      setRemainingMs(left)
      if (left <= 0) {
        setForcedCommit({ correct: false, choiceIndex: null })
      }
    }, RUSH_TIMER_TICK_MS)
    return () => {
      clearInterval(interval)
    }
  }, [phase, puzzle])

  // A backgrounded tab must not silently drain the clock (decision 6's
  // visibilitychange requirement) — rather than pausing/resuming the
  // interval above, this pushes the deadline itself back by however long
  // the tab was hidden, so the interval's own `deadlineRef.current -
  // Date.now()` math already reflects the pause with no other change.
  useEffect(() => {
    let hiddenAt: number | null = null
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
      } else if (hiddenAt !== null) {
        deadlineRef.current += Date.now() - hiddenAt
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const handleAnswered = useCallback(
    (payload: CommitPayload) => {
      if (!profile || !puzzle || phase !== 'playing') return
      answeredRef.current = true

      // Rush-eligible interactions (mcq/swipe-binary/tap-line) never
      // naturally commit a null choiceIndex — only the clock's own
      // synthesized forcedCommit does (see the ticking effect above) — so
      // this is a safe, unambiguous "this outcome came from the clock, not
      // a tap" signal without threading a separate flag through.
      const timedOut = payload.choiceIndex === null
      if (!payload.correct) {
        lastMissTimedOutRef.current = timedOut
      }

      const timeMs = Math.max(0, Date.now() - servedAtRef.current)
      const today = todayDateString()

      // Rush never rates — see this file's doc comment and
      // useRushSession.test.ts's "never rates" guard.
      const rates = shouldRateAttempt('rush', false)
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
        mode: 'rush',
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
        trackError(error, 'useRushSession: appendAttempt failed')
      })

      usedIdsRef.current.add(puzzle.id)

      trackRushAttempt({
        puzzle_id: puzzle.id,
        correct: payload.correct,
        time_ms: timeMs,
        mode: 'rush',
        interaction: puzzle.interaction,
        user_rating_before: oldRating,
        user_rating_after: newRating,
        run_id: runIdRef.current,
        position_in_run: positionRef.current,
        difficulty_served: difficulty,
        timed_out: timedOut,
      })

      const newSolvedCount = payload.correct ? solvedCount + 1 : solvedCount
      const newStreak = payload.correct ? currentStreak + 1 : 0
      const newBestStreak = Math.max(bestStreakThisRun, newStreak)
      const newStrikes = payload.correct ? strikes : strikes + 1

      setSolvedCount(newSolvedCount)
      setCurrentStreak(newStreak)
      setBestStreakThisRun(newBestStreak)
      setStrikes(newStrikes)
      // Every answer lands in the run's challenge-link sequence, correct and
      // incorrect alike — the link replays the whole run as it happened.
      setRunAttempts((prev) => [
        ...prev,
        { puzzleId: puzzle.id, correct: payload.correct, time_ms: timeMs },
      ])

      const willEnd = newStrikes >= RUSH_STRIKE_LIMIT
      pendingEndRef.current = willEnd
      setWillEndOnContinue(willEnd)
      pendingDifficultyRef.current = payload.correct ? stepDifficulty(difficulty) : difficulty
    },
    [profile, puzzle, phase, solvedCount, currentStreak, bestStreakThisRun, strikes, difficulty],
  )

  const endRun = useCallback(
    (currentProfile: UserProfile, finalSolvedCount: number, finalBestStreak: number) => {
      const priorStats = currentProfile.rushStats
      const isNewBestScore = finalSolvedCount > (priorStats?.bestScore ?? 0)
      const newRushStats: RushStats = {
        bestScore: Math.max(priorStats?.bestScore ?? 0, finalSolvedCount),
        bestStreak: Math.max(priorStats?.bestStreak ?? 0, finalBestStreak),
        runs: (priorStats?.runs ?? 0) + 1,
        lastRunAt: new Date().toISOString(),
      }
      const updatedProfile: UserProfile = { ...currentProfile, rushStats: newRushStats }
      setProfile(updatedProfile)
      saveProfile(updatedProfile).catch((error: unknown) => {
        trackError(error, 'useRushSession: saveProfile failed')
      })
      trackRushRunEnd({
        run_id: runIdRef.current,
        solved_count: finalSolvedCount,
        best_streak_in_run: finalBestStreak,
        final_difficulty: difficulty,
        ended_reason: lastMissTimedOutRef.current ? 'clock' : 'strikes',
        is_new_best_score: isNewBestScore,
      })
      setRunSummary({
        solvedCount: finalSolvedCount,
        bestStreakThisRun: finalBestStreak,
        longestStreakEver: newRushStats.bestStreak,
        bestScoreEver: newRushStats.bestScore,
        isNewBestScore,
      })
      setPhase('ended')
    },
    [difficulty],
  )

  const handleContinue = useCallback(() => {
    if (!profile || phase !== 'playing') return
    if (pendingEndRef.current) {
      endRun(profile, solvedCount, bestStreakThisRun)
      return
    }
    serveNext(pendingDifficultyRef.current)
  }, [profile, phase, solvedCount, bestStreakThisRun, serveNext, endRun])

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
    solvedCount,
    currentStreak,
    bestStreakThisRun,
    runSummary,
    remainingMs,
    forcedCommit,
    runAttempts,
    willEndOnContinue,
    handleAnswered,
    handleContinue,
    handleRunItBack,
    retryLoad,
  }
}
