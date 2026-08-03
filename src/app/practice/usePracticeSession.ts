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
  recordMiss,
  roundForDisplay,
  selectNext,
  shouldRateAttempt,
  updateRating,
} from '../../engine'
import type { SelectionSource } from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, UserProfile } from '../../storage'
import { quizPool } from '../../content'
import { resolvePool } from '../devTools/devPuzzleMode'
import type { Puzzle as ContentPuzzle, PatternSlug, QuizPuzzle } from '../../content'
import { trackAttempt, trackError } from '../../telemetry'
import type { CommitPayload } from './interactionTypes'
import { hapticTick } from './haptics'

type InteractionFilter = QuizPuzzle['interaction'] | null

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

/** Filters combine (AND), not mutually exclusive — a pattern and an interaction filter can both be active at once. */
function poolForFilters(
  pattern: PatternSlug | null,
  interaction: InteractionFilter,
): ContentPuzzle[] {
  const pool = resolvePool(quizPool) as ContentPuzzle[]
  return pool.filter(
    (puzzle) =>
      (pattern === null || puzzle.pattern === pattern) &&
      (interaction === null || puzzle.interaction === interaction),
  )
}

// 'error': loadProfile() rejected on mount (e.g. IndexedDB blocked in private
// browsing, quota exceeded, a corrupt store that fails even storage's own
// recovery). Without this state the mount effect's unhandled rejection would
// leave status stuck at 'loading' forever with no way for the user to
// recover — see retryLoad below.
export type SessionStatus = 'loading' | 'ready' | 'empty' | 'error'

export interface PracticeSession {
  status: SessionStatus
  profile: UserProfile | null
  puzzle: ContentPuzzle | null
  ratingDelta: number | null
  /** In-session correct-answer streak. Not persisted, not derived from stored attempts — resets on wrong, resets to 0 on reload. */
  combo: number
  /** Count of correct answers this session (page load). Session-only, not persisted — see PracticePage's progress-indicator doc comment for why this replaces a fixed-length "out of N" progress bar. */
  solvedThisSession: number
  /** Bumped on every recorded attempt (correct or not) — MasteryView takes this as a prop so it can refetch attempts instead of only reading them once on mount. */
  attemptVersion: number
  patternFilter: PatternSlug | null
  setPatternFilter: (pattern: PatternSlug | null) => void
  /** Combines (AND) with patternFilter, not mutually exclusive — both can be active at once. */
  interactionFilter: InteractionFilter
  setInteractionFilter: (interaction: InteractionFilter) => void
  /** Sets both filters as one atomic update — see the implementation's doc comment for why this isn't just two sequential setter calls. */
  setFilters: (pattern: PatternSlug | null, interaction: InteractionFilter) => void
  handleAnswered: (payload: CommitPayload) => void
  handleContinue: () => void
  /** Re-attempts loadProfile() after a mount-time load failure (status === 'error'). */
  retryLoad: () => void
}

export function usePracticeSession(): PracticeSession {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [puzzle, setPuzzle] = useState<ContentPuzzle | null>(null)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [combo, setCombo] = useState(0)
  const [solvedThisSession, setSolvedThisSession] = useState(0)
  const [attemptVersion, setAttemptVersion] = useState(0)
  const [patternFilter, setPatternFilterState] = useState<PatternSlug | null>(null)
  const [interactionFilter, setInteractionFilterState] = useState<InteractionFilter>(null)

  // Plain refs, not state: these feed the *next* selection call rather than
  // driving a render themselves.
  const recentIdsRef = useRef<string[]>([])
  const servedAtRef = useRef<number>(0)
  // Feeds selectNext's requeue-starvation guard (see selection.ts's
  // `lastSource` doc comment) — tracks the `source` of the previous serve so
  // two requeue entries can never be served back-to-back.
  const lastSourceRef = useRef<SelectionSource | null>(null)

  const contentById = useRef(new Map(poolForFilters(null, null).map((p) => [p.id, p])))

  const serveNext = useCallback(
    (currentProfile: UserProfile, pattern: PatternSlug | null, interaction: InteractionFilter) => {
      const pool = poolForFilters(pattern, interaction).map(toEnginePuzzle)
      const result = selectNext({
        pool,
        rating: currentProfile.rating,
        recentIds: recentIdsRef.current,
        requeueState: currentProfile.requeueState,
        rng: Math.random,
        lastSource: lastSourceRef.current,
      })

      if (result === null) {
        setPuzzle(null)
        setRatingDelta(null)
        setStatus('empty')
        return
      }

      lastSourceRef.current = result.source

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
    },
    [],
  )

  const cancelledRef = useRef(false)

  useEffect(() => {
    // A ref, not a plain `let` closure var: typescript-eslint's
    // no-unnecessary-condition otherwise narrows a `let cancelled = false`
    // read inside this same closure to the literal `false` — it can't see
    // that the cleanup function below (a different closure, invoked later
    // by React) is the one that flips it.
    cancelledRef.current = false
    // try/catch around the await: a rejected loadProfile() (IndexedDB
    // blocked in private browsing, quota exceeded, a corrupt store that
    // fails even storage's own recovery) used to be an unhandled rejection
    // here, leaving status stuck at 'loading' forever with no way to
    // recover. Kept as an inline IIFE (not a shared named callback also
    // invoked from retryLoad below) so react-hooks/set-state-in-effect can
    // verify every setState call here happens after the `await`.
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        serveNext(loaded, null, null)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'usePracticeSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only: subsequent puzzle changes go through handleContinue/setPatternFilter/setInteractionFilter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-attempts loadProfile() from the error state (the "Try again" button
  // in PracticePage). Not called from the mount effect above — kept
  // separate so each call site's setState calls are easy for
  // react-hooks/set-state-in-effect to verify independently.
  const retryLoad = useCallback(() => {
    cancelledRef.current = false
    setStatus('loading')
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        serveNext(loaded, null, null)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'usePracticeSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
  }, [serveNext])

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

      const updatedProfile: UserProfile = {
        ...profile,
        rating: newRating,
        ratedAttemptCount: profile.ratedAttemptCount + 1,
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
        checkpoint_results: null,
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
      setAttemptVersion((v) => v + 1)

      // Persistence failures here are non-fatal: the UI/telemetry below must
      // still run so the user sees their feedback even if the background
      // write to storage failed (e.g. IndexedDB quota exceeded). Reported via
      // trackError rather than silently swallowed.
      appendAttempt(attempt).catch((error: unknown) => {
        trackError(error, 'usePracticeSession: appendAttempt failed')
      })
      saveProfile(updatedProfile).catch((error: unknown) => {
        trackError(error, 'usePracticeSession: saveProfile failed')
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

      hapticTick()
    },
    [profile, puzzle],
  )

  const handleContinue = useCallback(() => {
    if (!profile || !puzzle) return
    recentIdsRef.current = [puzzle.id, ...recentIdsRef.current].slice(0, RECENT_IDS_WINDOW)
    serveNext(profile, patternFilter, interactionFilter)
  }, [profile, puzzle, patternFilter, interactionFilter, serveNext])

  const setPatternFilter = useCallback(
    (pattern: PatternSlug | null) => {
      if (!profile) return
      // Switching the filter is not itself a "continue" past the puzzle on
      // screen — the user may not have pressed Continue yet (e.g. they tap
      // Browse Patterns right after seeing the feedback panel). Without
      // this, the currently-displayed puzzle was never added to
      // recentIdsRef (only handleContinue does that), so selectNext had no
      // reason to exclude it and could immediately re-serve the exact
      // puzzle just solved. Previously this also reset recentIdsRef to
      // `[]`, dropping the whole no-repeat window on every filter switch —
      // that exclusion should carry over across entry points, not just
      // within one, so it's preserved here instead.
      if (puzzle) {
        recentIdsRef.current = [puzzle.id, ...recentIdsRef.current].slice(0, RECENT_IDS_WINDOW)
      }
      setPatternFilterState(pattern)
      serveNext(profile, pattern, interactionFilter)
    },
    [profile, puzzle, interactionFilter, serveNext],
  )

  // Mirrors setPatternFilter exactly (same recentIdsRef exclusion reasoning
  // — switching this filter isn't a "continue" either) with pattern/
  // interaction's roles swapped.
  const setInteractionFilter = useCallback(
    (interaction: InteractionFilter) => {
      if (!profile) return
      if (puzzle) {
        recentIdsRef.current = [puzzle.id, ...recentIdsRef.current].slice(0, RECENT_IDS_WINDOW)
      }
      setInteractionFilterState(interaction)
      serveNext(profile, patternFilter, interaction)
    },
    [profile, puzzle, patternFilter, serveNext],
  )

  // Sets both filters as one atomic update. NOT equivalent to calling
  // setPatternFilter then setInteractionFilter back to back: each of those
  // closes over the OTHER filter's value at the time it was created, so two
  // calls in the same tick (no render in between) would serveNext once with
  // (newPattern, oldInteraction) and again with (staleOldPattern,
  // newInteraction) — the second call's serveNext wins, silently dropping
  // the first filter from the puzzle actually served even though both
  // filter values end up correct in state. Needed for applying
  // ?pattern=&interaction= together from one URL (Phase 5 Item 4).
  const setFilters = useCallback(
    (pattern: PatternSlug | null, interaction: InteractionFilter) => {
      if (!profile) return
      if (puzzle) {
        recentIdsRef.current = [puzzle.id, ...recentIdsRef.current].slice(0, RECENT_IDS_WINDOW)
      }
      setPatternFilterState(pattern)
      setInteractionFilterState(interaction)
      serveNext(profile, pattern, interaction)
    },
    [profile, puzzle, serveNext],
  )

  return {
    status,
    profile,
    puzzle,
    ratingDelta,
    combo,
    solvedThisSession,
    attemptVersion,
    patternFilter,
    setPatternFilter,
    interactionFilter,
    setInteractionFilter,
    setFilters,
    handleAnswered,
    handleContinue,
    retryLoad,
  }
}
