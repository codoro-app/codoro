/**
 * Orchestrates the practice loop: loads/persists the profile, serves puzzles
 * via engine's `selectNext`, and wires each answer through the rating,
 * requeue, and streak engine functions plus storage persistence and
 * telemetry. This is pure orchestration — no rating/selection/streak/requeue
 * logic is reimplemented here, it all comes from src/engine/ (see the
 * barrel-only imports below).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  recordActivity,
  recordMiss,
  roundForDisplay,
  selectNext,
  shouldRateAttempt,
  updateRating,
} from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, UserProfile } from '../../storage'
import { puzzlePool } from '../../content'
import type { Puzzle as ContentPuzzle, PatternSlug } from '../../content'
import { trackAttempt } from '../../telemetry'
import type { CommitPayload } from './interactionTypes'
import { hapticTick } from './haptics'

// Matches src/engine/selection.ts's own no-repeat-within-20 convention for
// `recentIds` — see that file's doc comment.
const RECENT_IDS_WINDOW = 20

/** Local calendar-date string (YYYY-MM-DD) from wall-clock time — never a date library, per the brief. */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

function toEnginePuzzle(puzzle: ContentPuzzle): { id: string; rating: number } {
  return { id: puzzle.id, rating: puzzle.difficulty_rating }
}

function poolForPattern(pattern: PatternSlug | null): ContentPuzzle[] {
  return pattern === null ? puzzlePool : puzzlePool.filter((puzzle) => puzzle.pattern === pattern)
}

export type SessionStatus = 'loading' | 'ready' | 'empty'

export interface PracticeSession {
  status: SessionStatus
  profile: UserProfile | null
  puzzle: ContentPuzzle | null
  ratingDelta: number | null
  /** In-session correct-answer streak. Not persisted, not derived from stored attempts — resets on wrong, resets to 0 on reload. */
  combo: number
  /** Count of correct answers this session (page load). Session-only, not persisted — see PracticePage's progress-indicator doc comment for why this replaces a fixed-length "out of N" progress bar. */
  solvedThisSession: number
  patternFilter: PatternSlug | null
  setPatternFilter: (pattern: PatternSlug | null) => void
  handleAnswered: (payload: CommitPayload) => void
  handleContinue: () => void
}

export function usePracticeSession(): PracticeSession {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [puzzle, setPuzzle] = useState<ContentPuzzle | null>(null)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [combo, setCombo] = useState(0)
  const [solvedThisSession, setSolvedThisSession] = useState(0)
  const [patternFilter, setPatternFilterState] = useState<PatternSlug | null>(null)

  // Plain refs, not state: these feed the *next* selection call rather than
  // driving a render themselves.
  const recentIdsRef = useRef<string[]>([])
  const servedAtRef = useRef<number>(0)

  const contentById = useRef(new Map(puzzlePool.map((p) => [p.id, p])))

  const serveNext = useCallback((currentProfile: UserProfile, pattern: PatternSlug | null) => {
    const pool = poolForPattern(pattern).map(toEnginePuzzle)
    const result = selectNext({
      pool,
      rating: currentProfile.rating,
      recentIds: recentIdsRef.current,
      requeueState: currentProfile.requeueState,
      rng: Math.random,
    })

    if (result === null) {
      setPuzzle(null)
      setRatingDelta(null)
      setStatus('empty')
      return
    }

    // selectNext advances the requeue ladder as a side effect of being
    // called (one call == one puzzle served, per its own doc comment) even
    // when the tick isn't itself an answered attempt — keep that state in
    // memory now; it's persisted for real the next time an attempt is
    // recorded (handleAnswered's saveProfile call), matching the brief's
    // "Per-attempt flow" persistence step rather than writing on every serve.
    setProfile({ ...currentProfile, requeueState: result.newRequeueState })

    const fullPuzzle = contentById.current.get(result.puzzle.id)
    if (!fullPuzzle) {
      throw new Error(`selectNext returned unknown puzzle id "${result.puzzle.id}"`)
    }
    setPuzzle(fullPuzzle)
    setRatingDelta(null)
    servedAtRef.current = Date.now()
    setStatus('ready')
  }, [])

  const cancelledRef = useRef(false)
  useEffect(() => {
    // A ref, not a plain `let` closure var: typescript-eslint's
    // no-unnecessary-condition otherwise narrows a `let cancelled = false`
    // read inside this same closure to the literal `false` — it can't see
    // that the cleanup function below (a different closure, invoked later
    // by React) is the one that flips it.
    cancelledRef.current = false
    void (async () => {
      const loaded = await loadProfile()
      if (cancelledRef.current) return
      setProfile(loaded)
      serveNext(loaded, null)
    })()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only: subsequent puzzle changes go through handleContinue/setPatternFilter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAnswered = useCallback(
    (payload: CommitPayload) => {
      if (!profile || !puzzle) return

      const timeMs = Math.max(0, Date.now() - servedAtRef.current)
      const today = todayDateString()

      // Practice mode always rates (shouldRateAttempt('practice', _) is
      // unconditionally true) — called here for consistency/documentation
      // with daily/rush rather than hardcoding that assumption in this file.
      const rates = shouldRateAttempt('practice', false)
      const oldRating = profile.rating
      const newRating = rates
        ? updateRating(
            oldRating,
            puzzle.difficulty_rating,
            payload.correct,
            profile.ratedAttemptCount,
          )
        : oldRating
      const delta = roundForDisplay(newRating) - roundForDisplay(oldRating)

      const newRequeueState = payload.correct
        ? profile.requeueState
        : recordMiss(profile.requeueState, puzzle.id)
      const newStreak = recordActivity(profile.streak, today)

      const updatedProfile: UserProfile = {
        ...profile,
        rating: newRating,
        ratedAttemptCount: profile.ratedAttemptCount + 1,
        streak: newStreak,
        requeueState: newRequeueState,
      }

      const attempt: Attempt = {
        id: crypto.randomUUID(),
        puzzleId: puzzle.id,
        puzzleRating: puzzle.difficulty_rating,
        mode: 'practice',
        correct: payload.correct,
        time_ms: timeMs,
        choice_index: payload.choiceIndex,
        userRatingBefore: oldRating,
        userRatingAfter: newRating,
        localDateString: today,
        createdAt: new Date().toISOString(),
      }

      setProfile(updatedProfile)
      setRatingDelta(delta)
      setCombo((c) => (payload.correct ? c + 1 : 0))
      if (payload.correct) {
        setSolvedThisSession((s) => s + 1)
      }

      void appendAttempt(attempt)
      void saveProfile(updatedProfile)

      trackAttempt({
        puzzle_id: puzzle.id,
        correct: payload.correct,
        time_ms: timeMs,
        mode: 'practice',
        interaction: puzzle.interaction,
        user_rating_before: oldRating,
        user_rating_after: newRating,
      })

      hapticTick()
    },
    [profile, puzzle],
  )

  const handleContinue = useCallback(() => {
    if (!profile || !puzzle) return
    recentIdsRef.current = [puzzle.id, ...recentIdsRef.current].slice(0, RECENT_IDS_WINDOW)
    serveNext(profile, patternFilter)
  }, [profile, puzzle, patternFilter, serveNext])

  const setPatternFilter = useCallback(
    (pattern: PatternSlug | null) => {
      if (!profile) return
      recentIdsRef.current = []
      setPatternFilterState(pattern)
      serveNext(profile, pattern)
    },
    [profile, serveNext],
  )

  return {
    status,
    profile,
    puzzle,
    ratingDelta,
    combo,
    solvedThisSession,
    patternFilter,
    setPatternFilter,
    handleAnswered,
    handleContinue,
  }
}
