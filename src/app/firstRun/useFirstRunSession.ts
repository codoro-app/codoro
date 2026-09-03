/**
 * Orchestrates the first-run sequence: serve `FIRST_RUN_SET`'s 3 curated ids
 * in fixed order — no widening, no repeat-exclusion, no rng, exactly
 * `useBossSession`'s `serveAt(position)` shape (see that file's own doc
 * comment), just without Boss's strikes/rotation/ghost-pace machinery, since
 * a first-run sequence always serves all 3 puzzles regardless of
 * correctness rather than ending early. Puzzle 3 is a scrubber puzzle
 * (`dsm-016`), so this hook also needs `useDailySession`'s split:
 * `handleAnswered` (puzzles 1-2, quiz commit via `PuzzleCardShell`) and
 * `onCheckpointAnswered`/`checkpointResults`/`isComplete`/`solved` (puzzle
 * 3, via `TraceRunnerPuzzle`) — a shared `commitAttempt` helper (same role
 * as `useDailySession`'s) does the actual rating/persistence/telemetry
 * write for both paths, exactly once each puzzle.
 *
 * First-run is rated like any other Practice attempt, not a Boss-style
 * unrated mode: `mode: 'practice'` always, and `shouldRateAttempt('practice',
 * …)` is already unconditionally `true` in rating.ts (its `isFirstAttemptOfDay`
 * parameter only matters for `'daily'`) — no new rating carve-out needed
 * here. This is the opposite conclusion from useBossSession's own "Boss
 * never rates" comment, for the same reason stated the other way round: a
 * first-run puzzle IS a normal puzzle a normal player is solving, just
 * curated instead of selected live.
 *
 * `profile.firstRunCompleted` flips to `true` inside `commitAttempt`, only
 * on the 3rd puzzle's commit — not at the payoff screen's own render, and
 * not at the "See your results" tap. This matters: a visitor who solves
 * puzzle 3 and closes the tab before the payoff screen ever paints must
 * still never see the first-run sequence again on their next visit. Home's
 * gate (`attempts.length === 0 && !profile.firstRunCompleted`) reads exactly
 * that persisted flag, not any in-memory phase of this hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  roundForDisplay,
  scoreScrubberAttempt,
  shouldRateAttempt,
  updateRating,
} from '../../engine'
import type { CheckpointResult } from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, UserProfile } from '../../storage'
import { FIRST_RUN_SET, getPuzzleBody } from '../../content'
import type { Puzzle as ContentPuzzle } from '../../content'
import { isDevPuzzleModeEnabled, resolveFirstRunStubPuzzle } from '../devTools/devPuzzleMode'
import {
  trackAttempt,
  trackError,
  trackFirstRunCompleted,
  trackFirstRunStepComplete,
} from '../../telemetry'
import type { ChallengeAttemptInput } from '../../challenge'
import type { CommitPayload } from '../practice/interactionTypes'

/** Local calendar-date string (YYYY-MM-DD) — same convention as every other session hook. */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export type FirstRunSessionStatus = 'loading' | 'ready' | 'empty' | 'error'
export type FirstRunPhase = 'playing' | 'ended'

export interface FirstRunSession {
  status: FirstRunSessionStatus
  phase: FirstRunPhase
  profile: UserProfile | null
  puzzle: ContentPuzzle | null
  /** 1-indexed position of the currently served puzzle within FIRST_RUN_SET. */
  position: number
  /** Always FIRST_RUN_SET.length (3) — exposed as a field, not a hardcoded literal, mirroring useBossSession's totalPuzzles. */
  totalPuzzles: number
  /** Rating delta for the most recently committed puzzle; null before the current puzzle has been answered. */
  ratingDelta: number | null
  /** Running (and, once phase === 'ended', final) tally of correct answers across the sequence — the payoff screen's own `{correct_count}/3` stat. */
  correctCount: number
  /** Every puzzle's attempt so far, in play order — feeds the payoff screen's ChallengeButton (mirrors useBossSession's identical runAttempts field). */
  runAttempts: readonly ChallengeAttemptInput[]
  /** Accumulated per-checkpoint results for puzzle 3 (scrubber). Always `[]` while position 1-2 is active. */
  checkpointResults: readonly CheckpointResult[]
  /** True once every checkpoint on puzzle 3 has been answered. Always false for puzzles 1-2. */
  isComplete: boolean
  /** scoreScrubberAttempt's outcome for puzzle 3, once isComplete. Always null otherwise. */
  solved: boolean | null
  /** Commits a quiz puzzle's answer (puzzles 1-2, via PuzzleCardShell). */
  handleAnswered: (payload: CommitPayload) => void
  /** Records one checkpoint's outcome for puzzle 3 (scrubber, via TraceRunnerPuzzle) — once the final checkpoint lands, commits through the same path handleAnswered uses. */
  onCheckpointAnswered: (result: CheckpointResult) => void
  /** Advances to the next puzzle, or (after puzzle 3) ends the sequence — phase flips to 'ended'. */
  handleContinue: () => void
  retryLoad: () => void
}

export function useFirstRunSession(): FirstRunSession {
  const [status, setStatus] = useState<FirstRunSessionStatus>('loading')
  const [phase, setPhase] = useState<FirstRunPhase>('playing')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [puzzle, setPuzzle] = useState<ContentPuzzle | null>(null)
  const [position, setPosition] = useState(0)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [correctCount, setCorrectCount] = useState(0)
  const [runAttempts, setRunAttempts] = useState<ChallengeAttemptInput[]>([])
  const checkpointResultsRef = useRef<CheckpointResult[]>([])
  const [checkpointResults, setCheckpointResults] = useState<readonly CheckpointResult[]>([])

  const servedAtRef = useRef(0)
  const cancelledRef = useRef(false)
  // Same "compare against the latest, not a boolean flag" idiom as
  // useBossSession's startRunTokenRef — guards a fast repeat retryLoad click
  // from having an earlier prefetch's result clobber a later one.
  const loadTokenRef = useRef(0)
  const contentByIdRef = useRef<Map<string, ContentPuzzle>>(new Map())

  const serveAt = useCallback((index: number) => {
    if (isDevPuzzleModeEnabled()) {
      setPuzzle(resolveFirstRunStubPuzzle(index))
      setPosition(index + 1)
      servedAtRef.current = Date.now()
      setStatus('ready')
      return
    }
    const id = FIRST_RUN_SET[index]
    if (id === undefined) {
      setPuzzle(null)
      setStatus('empty')
      return
    }
    const fullPuzzle = contentByIdRef.current.get(id)
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

  // Split into loadAndStart (profile) + startSequence (content prefetch),
  // exactly useBossSession.ts's own loadAndStart/startRun split — each
  // async function has exactly ONE await and ONE cancellation guard,
  // instead of two of each in sequence inside a single function. That
  // structural shape matters, not just style: with two awaits/guards in one
  // function, `@typescript-eslint/no-unnecessary-condition` flagged the
  // SECOND guard as "always falsy" — TS's flow analysis, once it sees the
  // first guard return early when cancelledRef.current is true, keeps
  // treating that ref read as narrowed to false afterward, even across the
  // second `await` (where it genuinely can flip true again, e.g. an
  // unmount). Splitting into two single-await functions sidesteps that
  // false positive entirely, the same way Boss's own shape already does.
  //
  // Also — unlike the version this replaced — startSequence always
  // prefetches FIRST_RUN_SET's real content, dev mode included: exactly
  // Boss's startRun, which always prefetches its activeSet regardless of
  // isDevPuzzleModeEnabled() and lets serveAt's own dev branch (above)
  // override with a stub puzzle afterward, rather than short-circuiting the
  // prefetch itself.
  const startSequence = useCallback(() => {
    const token = ++loadTokenRef.current
    void (async () => {
      try {
        const bodies = await Promise.all(FIRST_RUN_SET.map((id) => getPuzzleBody(id)))
        if (cancelledRef.current || loadTokenRef.current !== token) return
        const map = new Map<string, ContentPuzzle>()
        FIRST_RUN_SET.forEach((id, i) => {
          const body = bodies[i]
          if (body) map.set(id, body)
        })
        contentByIdRef.current = map
        serveAt(0)
      } catch (error) {
        if (cancelledRef.current || loadTokenRef.current !== token) return
        trackError(error, 'useFirstRunSession: puzzle body prefetch failed')
        setStatus('error')
      }
    })()
  }, [serveAt])

  // No synchronous setState here — the mount effect below calls this
  // directly, and every value it would reset already matches this hook's
  // own useState initializers on first mount (status: 'loading', phase:
  // 'playing', etc.), so a synchronous reset would be a redundant no-op
  // that only exists to trip react-hooks/set-state-in-effect. retryLoad
  // (an event-handler call, not an effect body) is what needs — and
  // performs — the explicit reset for an actual retry.
  const loadAndStart = useCallback(() => {
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        startSequence()
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useFirstRunSession: loadProfile failed')
        setStatus('error')
      }
    })()
  }, [startSequence])

  useEffect(() => {
    cancelledRef.current = false
    loadAndStart()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as useBossSession/useDailySession.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryLoad = useCallback(() => {
    cancelledRef.current = false
    setStatus('loading')
    setPhase('playing')
    setRatingDelta(null)
    setCorrectCount(0)
    setRunAttempts([])
    checkpointResultsRef.current = []
    setCheckpointResults([])
    loadAndStart()
  }, [loadAndStart])

  /**
   * Shared commit path for both puzzles 1-2 (handleAnswered) and puzzle 3
   * (onCheckpointAnswered, once its final checkpoint lands) — mirrors
   * useDailySession's own commitAttempt split. `checkpointResultsForLog` is
   * puzzle 3's full per-checkpoint array for the persisted Attempt record;
   * null for puzzles 1-2 (same null convention as every other quiz
   * interaction's checkpoint_results field).
   */
  const commitAttempt = useCallback(
    (payload: CommitPayload, checkpointResultsForLog: CheckpointResult[] | null = null) => {
      if (!profile || !puzzle) return

      const timeMs = Math.max(0, Date.now() - servedAtRef.current)
      const today = todayDateString()

      // First-run is a normal rated Practice attempt, not a Boss-style
      // unrated mode — see this file's own doc comment.
      const rates = shouldRateAttempt('practice', true)
      const oldRating = profile.rating
      const newRating = rates
        ? updateRating(
            oldRating,
            puzzle.difficulty_rating,
            payload.correct,
            profile.ratedAttemptCount,
          )
        : oldRating
      const delta = rates ? roundForDisplay(newRating) - roundForDisplay(oldRating) : null

      // Puzzle 3's commit is what actually completes the sequence — see this
      // file's own doc comment for why this flips HERE (commit time), not at
      // the payoff screen's later render.
      const isFinalPuzzle = position >= FIRST_RUN_SET.length
      const nextCorrectCount = correctCount + (payload.correct ? 1 : 0)

      const attempt: Attempt = {
        id: crypto.randomUUID(),
        puzzleId: puzzle.id,
        puzzleRating: puzzle.difficulty_rating,
        mode: 'practice',
        correct: payload.correct,
        time_ms: timeMs,
        choice_index: payload.choiceIndex,
        checkpoint_results: checkpointResultsForLog,
        userRatingBefore: oldRating,
        userRatingAfter: newRating,
        localDateString: today,
        createdAt: new Date().toISOString(),
      }

      const updatedProfile: UserProfile = {
        ...profile,
        rating: newRating,
        ratedAttemptCount: rates ? profile.ratedAttemptCount + 1 : profile.ratedAttemptCount,
        firstRunCompleted: isFinalPuzzle ? true : profile.firstRunCompleted,
      }

      setProfile(updatedProfile)
      setRatingDelta(delta)
      setCorrectCount(nextCorrectCount)
      setRunAttempts((prev) => [
        ...prev,
        { puzzleId: puzzle.id, correct: payload.correct, time_ms: timeMs },
      ])

      appendAttempt(attempt).catch((error: unknown) => {
        trackError(error, 'useFirstRunSession: appendAttempt failed')
      })
      saveProfile(updatedProfile).catch((error: unknown) => {
        trackError(error, 'useFirstRunSession: saveProfile failed')
      })

      trackAttempt({
        puzzle_id: puzzle.id,
        correct: payload.correct,
        time_ms: timeMs,
        mode: 'practice',
        interaction: puzzle.interaction,
        user_rating_before: oldRating,
        user_rating_after: newRating,
      })
      trackFirstRunStepComplete({
        position: position as 1 | 2 | 3,
        puzzle_id: puzzle.id,
        interaction: puzzle.interaction,
        correct: payload.correct,
      })
      if (isFinalPuzzle) {
        trackFirstRunCompleted({ correct_count: nextCorrectCount })
      }
    },
    [profile, puzzle, position, correctCount],
  )

  const handleAnswered = useCallback(
    (payload: CommitPayload) => {
      commitAttempt(payload)
    },
    [commitAttempt],
  )

  /** Mirrors useDailySession.onCheckpointAnswered exactly — accumulate one checkpoint result; only score/commit once every checkpoint on the puzzle has answered. */
  const onCheckpointAnswered = useCallback(
    (result: CheckpointResult) => {
      if (!profile || puzzle?.interaction !== 'scrubber') return
      if (checkpointResultsRef.current.length >= puzzle.checkpoints.length) return

      const nextResults = [...checkpointResultsRef.current, result]
      checkpointResultsRef.current = nextResults
      setCheckpointResults(nextResults)

      if (nextResults.length < puzzle.checkpoints.length) return

      const solved = scoreScrubberAttempt(nextResults)
      commitAttempt({ correct: solved, choiceIndex: null }, nextResults)
    },
    [profile, puzzle, commitAttempt],
  )

  const handleContinue = useCallback(() => {
    if (!profile || phase !== 'playing') return
    if (position >= FIRST_RUN_SET.length) {
      setPhase('ended')
      return
    }
    // `position` is the current 1-indexed puzzle; serveAt takes a 0-indexed
    // target, so the current position value IS the next index — identical
    // to useBossSession's pendingNextIndexRef = position convention.
    serveAt(position)
  }, [profile, phase, position, serveAt])

  const isComplete =
    puzzle !== null &&
    puzzle.interaction === 'scrubber' &&
    checkpointResults.length >= puzzle.checkpoints.length
  const solved = isComplete ? scoreScrubberAttempt(checkpointResults) : null

  return {
    status,
    phase,
    profile,
    puzzle,
    position,
    totalPuzzles: FIRST_RUN_SET.length,
    ratingDelta,
    correctCount,
    runAttempts,
    checkpointResults,
    isComplete,
    solved,
    handleAnswered,
    onCheckpointAnswered,
    handleContinue,
    retryLoad,
  }
}
