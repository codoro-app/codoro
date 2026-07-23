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
import type { RushPuzzle } from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, RushStats, UserProfile } from '../../storage'
import { puzzlePool } from '../../content'
import type { Puzzle as ContentPuzzle } from '../../content'
import { trackError } from '../../telemetry'
import type { CommitPayload } from '../practice/interactionTypes'

/** Local calendar-date string (YYYY-MM-DD) from wall-clock time — same convention as every other session hook. */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

function toRushPuzzle(puzzle: ContentPuzzle): RushPuzzle {
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

  const runIdRef = useRef(crypto.randomUUID())
  const positionRef = useRef(0)
  const usedIdsRef = useRef<Set<string>>(new Set())
  const servedAtRef = useRef(0)
  const pendingDifficultyRef = useRef(0)
  const pendingEndRef = useRef(false)
  const cancelledRef = useRef(false)

  const contentById = useRef(new Map(puzzlePool.map((p) => [p.id, p])))
  const rushPool = useRef(puzzlePool.map(toRushPuzzle))

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

  const handleAnswered = useCallback(
    (payload: CommitPayload) => {
      if (!profile || !puzzle || phase !== 'playing') return

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
        userRatingBefore: oldRating,
        userRatingAfter: newRating,
        localDateString: today,
        createdAt: new Date().toISOString(),
      }

      appendAttempt(attempt).catch((error: unknown) => {
        trackError(error, 'useRushSession: appendAttempt failed')
      })

      usedIdsRef.current.add(puzzle.id)

      const newSolvedCount = payload.correct ? solvedCount + 1 : solvedCount
      const newStreak = payload.correct ? currentStreak + 1 : 0
      const newBestStreak = Math.max(bestStreakThisRun, newStreak)
      const newStrikes = payload.correct ? strikes : strikes + 1

      setSolvedCount(newSolvedCount)
      setCurrentStreak(newStreak)
      setBestStreakThisRun(newBestStreak)
      setStrikes(newStrikes)

      pendingEndRef.current = newStrikes >= RUSH_STRIKE_LIMIT
      pendingDifficultyRef.current = payload.correct ? stepDifficulty(difficulty) : difficulty
    },
    [profile, puzzle, phase, solvedCount, currentStreak, bestStreakThisRun, strikes, difficulty],
  )

  const endRun = useCallback(
    (currentProfile: UserProfile, finalSolvedCount: number, finalBestStreak: number) => {
      const priorStats = currentProfile.rushStats
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
      setRunSummary({
        solvedCount: finalSolvedCount,
        bestStreakThisRun: finalBestStreak,
        longestStreakEver: newRushStats.bestStreak,
        bestScoreEver: newRushStats.bestScore,
      })
      setPhase('ended')
    },
    [],
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
    handleAnswered,
    handleContinue,
    handleRunItBack,
    retryLoad,
  }
}
