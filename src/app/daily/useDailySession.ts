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
 *
 * Puzzle body (content-metadata-lazy-load Task 5b): per the selection audit
 * (docs/superpowers/plans/2026-08-24-content-metadata-lazy-load-selection-audit.md,
 * Step 2.1), Daily has NO candidate machinery to build — today's id is 100%
 * deterministic (`DAILY_CALENDAR[getDailyCalendarIndex(...)]`), so there is
 * no "next puzzle within a session" to speculatively prefetch; Daily serves
 * exactly one puzzle per calendar day. The id itself is still resolved
 * synchronously (cheap — no full body read), but the body is now loaded via
 * the shared `loadPuzzleBody` cache, a genuine async hop — `status` stays
 * 'loading' (RouteSkeleton, see DailyPage.tsx) until that first-ever load
 * resolves, same "cold boot only" contract every other converted session
 * hook uses. DEV puzzle-mode (`devTools/devPuzzleMode.ts`) is unaffected:
 * `resolveDailyStubPuzzle` already returns a full in-memory body, so that
 * branch stays synchronous, same as before this task.
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
import { DAILY_CALENDAR } from '../../content'
import { isDevPuzzleModeEnabled, resolveDailyStubPuzzle } from '../devTools/devPuzzleMode'
import type { Puzzle as ContentPuzzle } from '../../content'
import { trackAttempt, trackError } from '../../telemetry'
import type { ChallengeAttemptInput } from '../../challenge'
import type { CommitPayload } from '../practice/interactionTypes'
import { loadPuzzleBody } from '../practice/puzzleBodyCache'

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
  /** True once today's puzzle has a recorded first (rated) attempt — drives the ShareMenu. */
  completedToday: boolean
  /** Rating delta for the most recent attempt; null for an unrated retry. */
  ratingDelta: number | null
  /** Bumped by handleRetry to force PuzzleCardShell to remount for another (unrated) attempt at the same puzzle. */
  attemptNonce: number
  /** Bumped on every recorded attempt (first-of-day or retry) — MasteryView takes this as a prop so it can refetch attempts instead of only reading them once on mount. */
  attemptVersion: number
  /** The day's first (rated) attempt, for a challenge link. Session-only (no schema migration, Phase 5c locked decision) and set exactly once — unrated retries never overwrite it, the same "no re-taking for a better share" rule as the ShareMenu. Null until the first attempt of the day. */
  challengeAttempt: ChallengeAttemptInput | null
  handleAnswered: (payload: CommitPayload) => void
  handleRetry: () => void
  retryLoad: () => void
}

export function useDailySession(): DailySession {
  const [status, setStatus] = useState<DailySessionStatus>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [puzzle, setPuzzle] = useState<ContentPuzzle | null>(null)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [attemptNonce, setAttemptNonce] = useState(0)
  const [attemptVersion, setAttemptVersion] = useState(0)
  const [challengeAttempt, setChallengeAttempt] = useState<ChallengeAttemptInput | null>(null)

  const today = todayDateString()
  const dayNumber = getDailyNumber(today)

  // Today's target — cheap and pure to compute per render (id/lookup only,
  // never a full body read). DEV puzzle-mode resolves its own full body
  // directly (`resolveDailyStubPuzzle` — DEV_STUB_PUZZLES isn't an ordered
  // calendar and isn't real content, so it can't go through
  // `loadPuzzleBody`/`getPuzzleBody` at all); the real path only resolves an
  // id here, loaded into a full body by `load` below.
  const devMode = isDevPuzzleModeEnabled()
  const devPuzzle: ContentPuzzle | null = devMode ? resolveDailyStubPuzzle(dayNumber - 1) : null
  const dailyPuzzleId: string | null =
    !devMode && DAILY_CALENDAR.length > 0
      ? (DAILY_CALENDAR[getDailyCalendarIndex(today, DAILY_CALENDAR.length)] ?? null)
      : null

  const servedAtRef = useRef<number>(0)
  const cancelledRef = useRef(false)
  // Bumped every time `serveBody` runs (mount's `load`, or a fast repeat
  // `retryLoad` click) — an in-flight `loadPuzzleBody` promise only applies
  // its result if this still matches the token it captured. Same idiom as
  // Task 6's useBossSession.ts/PuzzlePage.tsx and Task 5a/5b's
  // usePracticeSession.ts/useRushSession.ts: an ever-incrementing
  // per-attempt token compared after the await, not a second boolean flag —
  // `cancelledRef` above already exists for the OUTER loadProfile step
  // (mirroring usePracticeSession.ts's own mount-effect/retryLoad split),
  // reusing it here for the body step too would have the exact "a later
  // call's reset silently re-arms an earlier call's guard" defect the boss
  // doc comment describes, since `load`/`retryLoad` can both reset the same
  // shared boolean.
  const bodyTokenRef = useRef(0)

  /** The real (non-dev) path's body step — split out from `load` below so it can carry its own supersession token independent of the outer loadProfile step's `cancelledRef`. */
  const serveBody = useCallback((id: string) => {
    const token = ++bodyTokenRef.current
    loadPuzzleBody(id)
      .then((body) => {
        if (bodyTokenRef.current !== token) return // superseded by a newer load
        if (!body) {
          // puzzleMeta/DAILY_CALENDAR and getPuzzleBody's loaders are both
          // generated from the same on-disk content at build time, so this
          // should be unreachable in practice — reported via trackError
          // either way, same as every other converted session hook's
          // analogous branch.
          trackError(
            new Error(`getPuzzleBody: unknown puzzle id "${id}"`),
            'useDailySession: puzzle body lookup miss',
          )
          setStatus('error')
          return
        }
        setPuzzle(body)
        servedAtRef.current = Date.now()
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (bodyTokenRef.current !== token) return
        trackError(error, 'useDailySession: puzzle body fetch failed')
        setStatus('error')
      })
  }, [])

  const load = useCallback(() => {
    cancelledRef.current = false
    void (async () => {
      if (devMode) {
        if (!devPuzzle) {
          if (!cancelledRef.current) setStatus('empty')
          return
        }
        try {
          const loaded = await loadProfile()
          if (cancelledRef.current) return
          setProfile(loaded)
          setPuzzle(devPuzzle)
          servedAtRef.current = Date.now()
          setStatus('ready')
        } catch (error) {
          if (cancelledRef.current) return
          trackError(error, 'useDailySession: loadProfile failed on mount')
          setStatus('error')
        }
        return
      }

      if (dailyPuzzleId === null) {
        if (!cancelledRef.current) setStatus('empty')
        return
      }
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        // Stale-while-revalidate has no real mid-session case for Daily —
        // `dailyPuzzleId` doesn't change within a session (see this file's
        // own doc comment) — but the body load is still a genuine async
        // hop, so `puzzle` state only updates once `serveBody` resolves it.
        serveBody(dailyPuzzleId)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useDailySession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
    // Mount-only, same convention as usePracticeSession/useRushSession:
    // `devMode`/`devPuzzle`/`dailyPuzzleId` are re-read fresh on every call
    // to `load` (mount, and retryLoad's own call) via closure, not tracked
    // as reactive deps here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serveBody])

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
        checkpoint_results: null,
        userRatingBefore: oldRating,
        userRatingAfter: newRating,
        localDateString: today,
        createdAt: new Date().toISOString(),
      }

      setProfile(updatedProfile)
      setRatingDelta(delta)
      setAttemptVersion((v) => v + 1)

      // The day's first attempt seeds the challenge link. Session-only and set
      // exactly once — an unrated retry (isFirstAttemptOfDay false) never
      // overwrites it, the same "no re-taking for a better share" rule as the
      // ShareMenu.
      if (isFirstAttemptOfDay) {
        setChallengeAttempt({ puzzleId: puzzle.id, correct: payload.correct, time_ms: timeMs })
      }

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
    challengeAttempt,
    handleAnswered,
    handleRetry,
    retryLoad,
  }
}
