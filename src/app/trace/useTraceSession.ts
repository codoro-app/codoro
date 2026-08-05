/**
 * Orchestrates the Trace (scrubber) loop: serves puzzles from `scrubberPool`
 * via engine's rating-matched `selectNext` (same selector Practice uses),
 * accumulates per-checkpoint results as the player scrubs through a single
 * puzzle's trace, and — once every checkpoint on the current puzzle has been
 * answered — scores/rates/persists the attempt, persistence-wise mirroring
 * Practice's own single-commit puzzles but with two trace-specific scoring
 * differences: "solved" (streak/requeue) stays all-or-nothing
 * (scoreScrubberAttempt), while the rating update itself takes fractional
 * per-checkpoint credit (scrubberActualScore) at a boosted K
 * (TRACE_K_MULTIPLIER) — see those two exports' doc comments for why.
 * Mirrors usePracticeSession's rated-attempt lifecycle (`shouldRateAttempt`,
 * rating update, requeue-on-miss, `recentIds`) and useRushSession's
 * structural shape (status/mount-effect/`resolvePool` dev override).
 *
 * handleCheckpointAnswered/handleContinue are split exactly like Practice's
 * handleAnswered/handleContinue: handleCheckpointAnswered accumulates one
 * checkpoint result the instant it's answered, and — only once the
 * accumulated array reaches the current puzzle's checkpoint count — scores
 * the whole attempt via scoreScrubberAttempt, updates rating, and persists.
 * It does NOT itself serve the next puzzle; a UI layer still needs to show
 * the completed trace/explanation before advancing. handleContinue is what
 * actually serves the next puzzle, same as every other session hook's
 * Continue button.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  recordMiss,
  roundForDisplay,
  scoreScrubberAttempt,
  scrubberActualScore,
  selectNext,
  shouldRateAttempt,
  TRACE_K_MULTIPLIER,
  updateRating,
} from '../../engine'
import type { CheckpointResult, SelectionSource } from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, UserProfile } from '../../storage'
import { scrubberPool } from '../../content'
import { resolvePool } from '../devTools/devPuzzleMode'
import type { Puzzle as ContentPuzzle, ScrubberPuzzle } from '../../content'
import { trackError, trackStreakPause, trackTraceAttempt } from '../../telemetry'
import { resolveStreakPause } from '../streakPauseLogic'
import type { StreakPauseState } from '../streakPauseLogic'

// Practice's own no-repeat-within-20 convention (src/engine/selection.ts) —
// kept here as the upper bound, not the value actually used. See
// `traceRecentIdsWindow` below for why Trace clamps this down for its much
// smaller pool.
const PRACTICE_RECENT_IDS_WINDOW = 20

/**
 * Small-pool investigation (build-plan Task 1, item 6): `scrubberPool`
 * currently has 5 pilot puzzles, far below selection.ts's MIN_ELIGIBLE (10)
 * and Practice's RECENT_IDS_WINDOW (20). Two things were checked against
 * selection.ts's actual logic (not just reasoned about in the abstract):
 *
 * 1. `selectNext` returning `null`/getting stuck: does NOT happen.
 *    `widenedEligible` only returns fewer than MIN_ELIGIBLE candidates when
 *    the window has already grown to cover every puzzle in the pool (its
 *    `half <= maxDistance` loop bound guarantees termination once no wider
 *    window could add anything) — so with 5 puzzles it always ends up
 *    returning all 5 as eligible, never fewer, never zero.
 *    `selectNext` itself only returns `null` when `pool.length === 0`,
 *    which can't happen while `scrubberPool` is non-empty. The
 *    requeue-starvation guard (`lastSource !== 'requeue'`) bounds requeue
 *    entries to at most every other serve regardless of pool size, so it
 *    doesn't stall a 5-item pool either.
 *
 * 2. Practice's RECENT_IDS_WINDOW (20) applied unmodified to a 5-item pool:
 *    this IS a real (if narrow) problem. `recentIds` is deduped via a
 *    `Set` inside `pickFromWindow`; once a session has served all 5 ids at
 *    least once within the trailing window, `notRecent` (eligible minus
 *    recent) becomes permanently empty every following tick, and
 *    `pickFromWindow` falls back to the *unfiltered* eligible set (all 5,
 *    including the puzzle the player just answered). With a 20-wide window
 *    and only 5 distinct ids, that saturation happens almost immediately
 *    (typically well under 20 puzzles served) and then never un-saturates
 *    for the rest of the session — so the "no immediate repeat" guarantee
 *    Practice relies on silently stops holding for Trace specifically. This
 *    is not "unservable" (every call still returns a puzzle), but it does
 *    mean the exact puzzle a player just finished can resurface on the very
 *    next serve indefinitely from that point on.
 *
 * Fix (a parameter at this call site, not an edit to selection.ts): clamp
 * the window to `poolSize - 1` instead of the flat 20. With `poolSize - 1`
 * ids excluded, at least one eligible puzzle is always left over
 * (`poolSize - min(window, poolSize - 1) >= 1`), which structurally
 * guarantees `notRecent` never goes empty and the "just-answered puzzle
 * can't repeat immediately" property holds for as long as the pool has 2+
 * puzzles — see useTraceSession.selection.test.ts for both the `null`
 * non-stuck check and this no-immediate-repeat guarantee, proven directly
 * against engine's `selectNext` with a 5-item fixture pool. Computed from
 * the resolved pool's actual size (not hardcoded to 5) so this keeps
 * degrading gracefully as more scrubber content ships, and automatically
 * reverts to Practice's own 20 once the catalog grows past 21 puzzles.
 */
// Exported (not just internal) so useTraceSession.selection.test.ts can
// exercise the real, shipped clamp directly instead of testing a
// hand-maintained local copy that could silently drift from this one.
export function traceRecentIdsWindow(poolSize: number): number {
  return Math.min(PRACTICE_RECENT_IDS_WINDOW, Math.max(poolSize - 1, 0))
}

/** Local calendar-date string (YYYY-MM-DD) from wall-clock time — same convention as every other session hook. */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

function isScrubberPuzzle(
  puzzle: ContentPuzzle,
): puzzle is ContentPuzzle & { interaction: 'scrubber' } {
  return puzzle.interaction === 'scrubber'
}

function toEnginePuzzle(puzzle: ScrubberPuzzle): { id: string; rating: number } {
  return { id: puzzle.id, rating: puzzle.difficulty_rating }
}

export type TraceSessionStatus = 'loading' | 'ready' | 'empty' | 'error'

export interface TraceSession {
  status: TraceSessionStatus
  profile: UserProfile | null
  puzzle: ScrubberPuzzle | null
  /** Accumulated results for the puzzle currently on screen, in answer order. Resets to [] on every new serve. */
  checkpointResults: readonly CheckpointResult[]
  /** True once every checkpoint on `puzzle` has been answered — the attempt has already been scored, rated, and persisted; `handleContinue` serves the next puzzle. */
  isComplete: boolean
  /** scoreScrubberAttempt's outcome for the just-completed puzzle. null until isComplete. */
  solved: boolean | null
  /** Rounded-rating delta for the just-completed puzzle, same convention as Practice's ratingDelta. null until isComplete. */
  ratingDelta: number | null
  /** Bumped on every recorded attempt — lets a consumer (e.g. a mastery view) know to refetch. */
  attemptVersion: number
  /** In-session consecutive-solved-puzzle streak (Phase 5b Item 7). Not persisted itself — resets to 0 on a miss, resets on reload. */
  streak: number
  /** Non-null when the streak-pause moment should be shown — every 5th solved puzzle in a row. Cleared by either exit callback below. */
  streakPause: StreakPauseState | null
  /** Dismisses the pause and serves the next puzzle immediately. */
  handleStreakPauseKeepGoing: () => void
  /** Dismisses the pause only — the underlying solve panel (with its own Continue button) is still there if the player changes their mind. */
  handleStreakPauseDoneForNow: () => void
  /** Records one checkpoint's outcome. No-ops once isComplete (each checkpoint accepts exactly one answer). */
  handleCheckpointAnswered: (result: CheckpointResult) => void
  /** Serves the next puzzle. No-ops until isComplete. */
  handleContinue: () => void
  /** Re-attempts loadProfile() after a mount-time load failure (status === 'error'). */
  retryLoad: () => void
}

export function useTraceSession(): TraceSession {
  const [status, setStatus] = useState<TraceSessionStatus>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [puzzle, setPuzzle] = useState<ScrubberPuzzle | null>(null)
  const [checkpointResults, setCheckpointResults] = useState<readonly CheckpointResult[]>([])
  const [solved, setSolved] = useState<boolean | null>(null)
  const [streak, setStreak] = useState(0)
  const [streakPause, setStreakPause] = useState<StreakPauseState | null>(null)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [attemptVersion, setAttemptVersion] = useState(0)

  // Plain refs, not state: these feed the *next* selection call rather than
  // driving a render themselves — same convention as usePracticeSession.
  const recentIdsRef = useRef<string[]>([])
  const servedAtRef = useRef<number>(0)
  const lastSourceRef = useRef<SelectionSource | null>(null)
  // The source of truth for "how many checkpoints has this puzzle had
  // answered so far" — `checkpointResults` state exists for the UI to
  // render, but reading it back out of the closure inside
  // handleCheckpointAnswered is unsafe: React batches same-tick setState
  // calls, so two calls to handleCheckpointAnswered before a re-render
  // would both see the same stale `checkpointResults` value and silently
  // drop one of them. This ref is updated synchronously instead, exactly
  // like recentIdsRef/lastSourceRef above.
  const checkpointResultsRef = useRef<CheckpointResult[]>([])

  const activePool = resolvePool(scrubberPool).filter(isScrubberPuzzle)
  const contentById = useRef(new Map(activePool.map((p) => [p.id, p])))
  const tracePool = useRef(activePool.map(toEnginePuzzle))

  const serveNext = useCallback((currentProfile: UserProfile) => {
    const result = selectNext({
      pool: tracePool.current,
      rating: currentProfile.rating,
      recentIds: recentIdsRef.current,
      requeueState: currentProfile.requeueState,
      rng: Math.random,
      lastSource: lastSourceRef.current,
    })

    if (result === null) {
      setPuzzle(null)
      checkpointResultsRef.current = []
      setCheckpointResults([])
      setSolved(null)
      setRatingDelta(null)
      setStatus('empty')
      return
    }

    lastSourceRef.current = result.source

    // selectNext advances the requeue ladder as a side effect of being
    // called (one call == one puzzle served) even when the tick isn't
    // itself an answered attempt — kept in memory now, persisted for real
    // the next time an attempt is recorded (handleCheckpointAnswered's
    // saveProfile call), same as usePracticeSession's serveNext.
    setProfile({ ...currentProfile, requeueState: result.newRequeueState })

    const fullPuzzle = contentById.current.get(result.puzzle.id)
    if (!fullPuzzle) {
      throw new Error(`selectNext returned unknown puzzle id "${result.puzzle.id}"`)
    }
    setPuzzle(fullPuzzle)
    checkpointResultsRef.current = []
    setCheckpointResults([])
    setSolved(null)
    setRatingDelta(null)
    servedAtRef.current = Date.now()
    setStatus('ready')
  }, [])

  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        serveNext(loaded)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useTraceSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as usePracticeSession/useRushSession.
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
        serveNext(loaded)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useTraceSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
  }, [serveNext])

  const handleCheckpointAnswered = useCallback(
    (result: CheckpointResult) => {
      if (!profile || !puzzle || status !== 'ready') return
      if (checkpointResultsRef.current.length >= puzzle.checkpoints.length) return // already complete — ignore extra calls

      const nextResults = [...checkpointResultsRef.current, result]
      checkpointResultsRef.current = nextResults
      setCheckpointResults(nextResults)

      if (nextResults.length < puzzle.checkpoints.length) {
        return // more checkpoints remain — scoring/persistence happens on the final one
      }

      const timeMs = Math.max(0, Date.now() - servedAtRef.current)
      const today = todayDateString()
      const isSolved = scoreScrubberAttempt(nextResults)
      // Rating credit is fractional (per-checkpoint), not the same
      // all-or-nothing boolean `isSolved` uses — see scrubberActualScore's
      // doc comment for why the two are deliberately allowed to diverge.
      const actualScore = scrubberActualScore(nextResults)

      // Trace shares Practice's rating pool (mode: 'practice') — see the
      // build plan's "own mode with shared rating" decision. The rating
      // swing itself is boosted (TRACE_K_MULTIPLIER) since one trace
      // attempt carries more signal than one single-commit quiz answer.
      const rates = shouldRateAttempt('practice', false)
      const oldRating = profile.rating
      const newRating = rates
        ? updateRating(
            oldRating,
            puzzle.difficulty_rating,
            actualScore,
            profile.ratedAttemptCount,
            TRACE_K_MULTIPLIER,
          )
        : oldRating
      const delta = roundForDisplay(newRating) - roundForDisplay(oldRating)

      const newRequeueState = isSolved
        ? profile.requeueState
        : recordMiss(profile.requeueState, puzzle.id)

      // Phase 5b Item 7/8: computed explicitly (not via setStreak's own
      // functional updater) since the streak-pause check right below needs
      // the actual new value synchronously, in this same closure — mirrors
      // usePracticeSession.ts's identical combo/pause computation.
      const newStreak = isSolved ? streak + 1 : 0
      const pause = resolveStreakPause(newStreak, profile.bestRunStreak)

      const updatedProfile: UserProfile = {
        ...profile,
        rating: newRating,
        ratedAttemptCount: profile.ratedAttemptCount + 1,
        requeueState: newRequeueState,
        bestRunStreak: pause?.isNewBest ? newStreak : profile.bestRunStreak,
      }

      const attempt: Attempt = {
        id: crypto.randomUUID(),
        puzzleId: puzzle.id,
        puzzleRating: puzzle.difficulty_rating,
        mode: 'practice',
        correct: isSolved,
        time_ms: timeMs,
        choice_index: null,
        checkpoint_results: nextResults,
        userRatingBefore: oldRating,
        userRatingAfter: newRating,
        localDateString: today,
        createdAt: new Date().toISOString(),
      }

      setProfile(updatedProfile)
      setSolved(isSolved)
      setRatingDelta(delta)
      setStreak(newStreak)
      setAttemptVersion((v) => v + 1)
      if (pause) {
        setStreakPause(pause)
        trackStreakPause({ mode: 'trace', streak: pause.streak, is_new_best: pause.isNewBest })
      }

      // Persistence failures here are non-fatal — same convention as
      // usePracticeSession: the UI/telemetry below must still run so the
      // player sees their feedback even if the background write failed.
      appendAttempt(attempt).catch((error: unknown) => {
        trackError(error, 'useTraceSession: appendAttempt failed')
      })
      saveProfile(updatedProfile).catch((error: unknown) => {
        trackError(error, 'useTraceSession: saveProfile failed')
      })

      trackTraceAttempt({
        puzzle_id: puzzle.id,
        correct: isSolved,
        time_ms: timeMs,
        mode: 'practice',
        interaction: puzzle.interaction,
        user_rating_before: oldRating,
        user_rating_after: newRating,
        checkpoint_results: nextResults.map((r) => ({
          correct: r.correct,
          choice_index: r.choiceIndex,
          // A real answer is always a nonnegative index into that
          // checkpoint's choices — null is unambiguously the per-checkpoint
          // clock (Phase 5b Item 6) reaching 0 before an answer landed.
          timed_out: r.choiceIndex === null,
        })),
      })
    },
    [profile, puzzle, status, streak],
  )

  const handleContinue = useCallback(() => {
    if (!profile || !puzzle) return
    if (checkpointResults.length < puzzle.checkpoints.length) return // not complete yet
    const recentIdsWindow = traceRecentIdsWindow(tracePool.current.length)
    recentIdsRef.current = [puzzle.id, ...recentIdsRef.current].slice(0, recentIdsWindow)
    serveNext(profile)
  }, [profile, puzzle, checkpointResults, serveNext])

  const handleStreakPauseKeepGoing = useCallback(() => {
    setStreakPause(null)
    handleContinue()
  }, [handleContinue])

  const handleStreakPauseDoneForNow = useCallback(() => {
    setStreakPause(null)
  }, [])

  const isComplete = puzzle !== null && checkpointResults.length >= puzzle.checkpoints.length

  return {
    status,
    profile,
    puzzle,
    checkpointResults,
    isComplete,
    solved,
    ratingDelta,
    attemptVersion,
    streak,
    streakPause,
    handleStreakPauseKeepGoing,
    handleStreakPauseDoneForNow,
    handleCheckpointAnswered,
    handleContinue,
    retryLoad,
  }
}
