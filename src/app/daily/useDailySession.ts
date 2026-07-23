/**
 * Orchestrates the Daily loop: resolves today's puzzle via engine's
 * deterministic date hash (one puzzle per calendar date, same shape for
 * every user on this bundle), loads/persists the profile, and wires the
 * answer through rating/streak/storage/telemetry. Mirrors
 * usePracticeSession's shape but for a single fixed puzzle rather than
 * selection/requeue.
 *
 * Only the first attempt of a calendar day is rated and advances the streak
 * (Daily anchors the streak now, not Practice — see
 * usePracticeSession.ts's removed recordActivity call). Further attempts the
 * same day are recorded (mode: 'daily' Attempts still get appended) but
 * never touch rating, ratedAttemptCount, streak, or dailyCompletion — "no
 * re-taking for a better share" per the build plan.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDailyCalendarIndex,
  getDailyNumber,
  recordActivity,
  roundForDisplay,
  shouldRateAttempt,
  updateRating,
} from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, UserProfile } from '../../storage'
import { DAILY_CALENDAR, puzzlePool } from '../../content'
import type { Puzzle as ContentPuzzle } from '../../content'
import { trackAttempt, trackError } from '../../telemetry'
import type { CommitPayload } from '../practice/interactionTypes'

/** Local calendar-date string (YYYY-MM-DD) from wall-clock time — never a date library, matching usePracticeSession's convention. */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export type DailySessionStatus = 'loading' | 'ready' | 'empty' | 'error'

export interface DailySession {
  status: DailySessionStatus
  profile: UserProfile | null
  puzzle: ContentPuzzle | null
  dayNumber: number
  /** True once today's puzzle has a recorded first (rated) attempt — drives the ShareCard. */
  completedToday: boolean
  /** Rating delta for the most recent attempt; null for an unrated retry. */
  ratingDelta: number | null
  /** Bumped by handleRetry to force PuzzleCardShell to remount for another (unrated) attempt at the same puzzle. */
  attemptNonce: number
  /** Bumped on every recorded attempt (first-of-day or retry) — MasteryView takes this as a prop so it can refetch attempts instead of only reading them once on mount. */
  attemptVersion: number
  handleAnswered: (payload: CommitPayload) => void
  handleRetry: () => void
  retryLoad: () => void
}

export function useDailySession(): DailySession {
  const [status, setStatus] = useState<DailySessionStatus>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [attemptNonce, setAttemptNonce] = useState(0)
  const [attemptVersion, setAttemptVersion] = useState(0)

  const today = todayDateString()
  const dayNumber = getDailyNumber(today)
  const puzzle: ContentPuzzle | null =
    DAILY_CALENDAR.length > 0
      ? (puzzlePool.find(
          (candidate) =>
            candidate.id === DAILY_CALENDAR[getDailyCalendarIndex(today, DAILY_CALENDAR.length)],
        ) ?? null)
      : null

  const servedAtRef = useRef<number>(0)
  const cancelledRef = useRef(false)

  const load = useCallback(() => {
    cancelledRef.current = false
    void (async () => {
      if (puzzle === null) {
        if (!cancelledRef.current) setStatus('empty')
        return
      }
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        servedAtRef.current = Date.now()
        setStatus('ready')
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useDailySession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as usePracticeSession.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryLoad = useCallback(() => {
    setStatus('loading')
    load()
  }, [load])

  const handleAnswered = useCallback(
    (payload: CommitPayload) => {
      if (!profile || !puzzle) return

      const timeMs = Math.max(0, Date.now() - servedAtRef.current)
      const isFirstAttemptOfDay = profile.dailyCompletion?.date !== today
      const rates = shouldRateAttempt('daily', isFirstAttemptOfDay)

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

      const attemptId = crypto.randomUUID()
      const newStreak = isFirstAttemptOfDay ? recordActivity(profile.streak, today) : profile.streak
      const newDailyCompletion = isFirstAttemptOfDay
        ? { date: today, attemptId, correct: payload.correct }
        : profile.dailyCompletion

      const updatedProfile: UserProfile = {
        ...profile,
        rating: newRating,
        ratedAttemptCount: rates ? profile.ratedAttemptCount + 1 : profile.ratedAttemptCount,
        streak: newStreak,
        dailyCompletion: newDailyCompletion,
      }

      const attempt: Attempt = {
        id: attemptId,
        puzzleId: puzzle.id,
        puzzleRating: puzzle.difficulty_rating,
        mode: 'daily',
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
      setAttemptVersion((v) => v + 1)

      appendAttempt(attempt).catch((error: unknown) => {
        trackError(error, 'useDailySession: appendAttempt failed')
      })
      saveProfile(updatedProfile).catch((error: unknown) => {
        trackError(error, 'useDailySession: saveProfile failed')
      })

      trackAttempt({
        puzzle_id: puzzle.id,
        correct: payload.correct,
        time_ms: timeMs,
        mode: 'daily',
        interaction: puzzle.interaction,
        user_rating_before: oldRating,
        user_rating_after: newRating,
      })
    },
    [profile, puzzle, today],
  )

  const handleRetry = useCallback(() => {
    servedAtRef.current = Date.now()
    setRatingDelta(null)
    setAttemptNonce((n) => n + 1)
  }, [])

  return {
    status,
    profile,
    puzzle,
    dayNumber,
    completedToday: profile?.dailyCompletion?.date === today,
    ratingDelta,
    attemptNonce,
    attemptVersion,
    handleAnswered,
    handleRetry,
    retryLoad,
  }
}
