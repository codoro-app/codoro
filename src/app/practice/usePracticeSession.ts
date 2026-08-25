/**
 * Orchestrates the practice loop: loads/persists the profile, serves puzzles
 * via engine's `selectNext`, and wires each answer through the rating,
 * requeue, and streak engine functions plus storage persistence and
 * telemetry. This is pure orchestration — no rating/selection/streak/requeue
 * logic is reimplemented here, it all comes from src/engine/ (see the
 * barrel-only imports below).
 *
 * Puzzle bodies (content-metadata-lazy-load Task 5): puzzle *selection*
 * (`selectNext`) runs synchronously over `puzzleMeta` — id/pattern/rating/
 * interaction only, never a full body — exactly as it used to run over
 * `quizPool`. The selected id's full `Puzzle` body is then loaded via
 * `loadPuzzleBody` (the shared cache in `puzzleBodyCache.ts`), a genuine
 * async hop. `puzzle` state is stale-while-revalidate: it keeps showing
 * whatever was displayed before until the new id's body resolves, so it is
 * never `null`/`undefined` mid-session — only on true cold boot (the very
 * first puzzle of a session, before anything has ever been displayed) does
 * `status` stay `'loading'` with no puzzle to show (see PracticePage.tsx's
 * `RouteSkeleton` branch). `handleAnswered` additionally fires a best-effort
 * speculative prefetch (`speculativeSelection.ts`) for the puzzle(s) the
 * NEXT real `selectNext` call is likely to pick, once the answer's rating/
 * requeue effects are known (not at serve time — see this task's own report
 * for why serve-time would use the wrong, pre-answer rating).
 *
 * DEV puzzle-mode (`devTools/devPuzzleMode.ts`) is unaffected by any of the
 * above: its stub puzzles are plain in-memory objects, not real content
 * files, so they can't be looked up via `getPuzzleBody`/`puzzleMeta` at all
 * — that whole path keeps selecting from and serving `DEV_STUB_PUZZLES`
 * directly and synchronously, same as before this task.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  recordMiss,
  roundForDisplay,
  selectNext,
  shouldRateAttempt,
  updateRating,
} from '../../engine'
import type { Puzzle as EnginePuzzle, SelectionSource } from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, UserProfile } from '../../storage'
import { DEV_STUB_PUZZLES, puzzleMeta } from '../../content'
import { isDevPuzzleModeEnabled } from '../devTools/devPuzzleMode'
import type { Puzzle as ContentPuzzle, PatternSlug, QuizPuzzle } from '../../content'
import { trackAttempt, trackError, trackStreakPause } from '../../telemetry'
import type { ChallengeAttemptInput } from '../../challenge'
import type { CommitPayload } from './interactionTypes'
import { hapticTick } from './haptics'
import { resolveStreakPause } from '../streakPauseLogic'
import type { StreakPauseState } from '../streakPauseLogic'
import { loadPuzzleBody } from './puzzleBodyCache'
import { speculativeNextIds } from './speculativeSelection'

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

function toEnginePuzzle(puzzle: ContentPuzzle): EnginePuzzle {
  return { id: puzzle.id, rating: puzzle.difficulty_rating }
}

/**
 * The real (non-dev-mode) selection pool: `puzzleMeta` filtered to
 * quiz interactions (excludes scrubber — Trace's own pool, mirroring the
 * pre-existing `quizPool` split at content/index.ts) and the given
 * pattern/interaction filters, which combine (AND), not mutually exclusive
 * — a pattern and an interaction filter can both be active at once.
 * Metadata-only: no puzzle body is read or loaded here.
 */
function poolForFilters(
  pattern: PatternSlug | null,
  interaction: InteractionFilter,
): EnginePuzzle[] {
  return puzzleMeta
    .filter(
      (meta) =>
        meta.interaction !== 'scrubber' &&
        (pattern === null || meta.pattern === pattern) &&
        (interaction === null || meta.interaction === interaction),
    )
    .map((meta) => ({ id: meta.id, rating: meta.difficulty_rating }))
}

/**
 * DEV puzzle-mode's selection pool — `DEV_STUB_PUZZLES` (full bodies, held
 * in memory already) filtered the same way `poolForFilters` filters the real
 * pool. Kept entirely separate from the metadata/lazy-body path above: stub
 * ids don't exist in `puzzleMeta` or in the real content files
 * `getPuzzleBody` loads from, so this branch must never touch either.
 */
function devPoolForFilters(
  pattern: PatternSlug | null,
  interaction: InteractionFilter,
): EnginePuzzle[] {
  // Fix-round finding #6: guards this function's own `DEV_STUB_PUZZLES`
  // reference behind the same build-time-foldable check `resolvePool`
  // (devPuzzleMode.ts) uses internally — its call site here (`serveNext`,
  // gated on the runtime `isDevPuzzleModeEnabled()`) is NOT by itself
  // something Rollup/terser can constant-fold, so without this the
  // `DEV_STUB_PUZZLES` reference stayed reachable (and un-tree-shakeable)
  // in a production bundle even though it could never actually run there.
  if (!import.meta.env.DEV) return []
  return DEV_STUB_PUZZLES.filter(
    (puzzle) =>
      (pattern === null || puzzle.pattern === pattern) &&
      (interaction === null || puzzle.interaction === interaction),
  ).map(toEnginePuzzle)
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
  /** The current streak's correct answers, in order — feeds the streak challenge link. Cleared on a miss so the link always encodes the live streak. */
  streakAttempts: readonly ChallengeAttemptInput[]
  /** Bumped on every recorded attempt (correct or not) — MasteryView takes this as a prop so it can refetch attempts instead of only reading them once on mount. */
  attemptVersion: number
  patternFilter: PatternSlug | null
  setPatternFilter: (pattern: PatternSlug | null) => void
  /** Combines (AND) with patternFilter, not mutually exclusive — both can be active at once. */
  interactionFilter: InteractionFilter
  setInteractionFilter: (interaction: InteractionFilter) => void
  /** Sets both filters as one atomic update — see the implementation's doc comment for why this isn't just two sequential setter calls. */
  setFilters: (pattern: PatternSlug | null, interaction: InteractionFilter) => void
  /** Non-null when the streak-pause moment (Phase 5b Item 7/8) should be shown — every 5th correct answer in a row. Cleared by either exit callback below. */
  streakPause: StreakPauseState | null
  /** Dismisses the pause and serves the next puzzle immediately — the streak continues uninterrupted. */
  handleStreakPauseKeepGoing: () => void
  /** Dismisses the pause only — the underlying puzzle's own feedback panel (with its own Continue button) is still there if the player changes their mind. */
  handleStreakPauseDoneForNow: () => void
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
  const [streakPause, setStreakPause] = useState<StreakPauseState | null>(null)
  const [solvedThisSession, setSolvedThisSession] = useState(0)
  const [streakAttempts, setStreakAttempts] = useState<ChallengeAttemptInput[]>([])
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

  // The most recently SELECTED id (set synchronously, the instant
  // `selectNext` picks it) — distinct from `puzzle.id`, which only updates
  // once that selection's body has actually resolved (stale-while-
  // revalidate). Selection-bookkeeping (recentIds, prefetch) must key off
  // this, not off the possibly-stale displayed puzzle, so a second
  // handleContinue landing before the first's body resolves can't push the
  // same id into recentIds twice while never recording the one actually
  // selected in between.
  const lastSelectedIdRef = useRef<string | null>(null)
  // A dev-mode DEV_STUB_PUZZLES lookup — the DEV-only counterpart to the
  // real path's `loadPuzzleBody` cache. Stub ids don't exist in real content
  // files, so they can never go through `getPuzzleBody`; only ever read when
  // `isDevPuzzleModeEnabled()`. Fix-round finding #6: this line ran
  // unconditionally on every mount regardless of dev mode — a plain runtime
  // `if` inside a hook body isn't something Rollup/terser can constant-fold
  // the way `import.meta.env.DEV` itself can, so `DEV_STUB_PUZZLES` (and the
  // ~12 stub puzzles it holds) stayed reachable in the production bundle.
  // Guarded the same way `resolvePool` (devPuzzleMode.ts) guards its own
  // `DEV_STUB_PUZZLES` reference, so the `true`-branch — and the stub
  // puzzles themselves — dead-code-eliminate out of a production build.
  const devStubById = useRef(
    import.meta.env.DEV
      ? new Map(DEV_STUB_PUZZLES.map((p) => [p.id, p]))
      : new Map<string, ContentPuzzle>(),
  )
  // Bumped every time `serveNext` runs. A body-load promise's `.then`/
  // `.catch` only applies its result if this still matches the token it
  // captured — guards the same class of race Task 6's
  // useBossSession.ts/PuzzlePage.tsx fix (an older selection's slower fetch
  // landing after a newer selection's faster one) — reachable here too: two
  // `handleContinue` calls close enough together that the first's body
  // fetch is still in flight when the second selects a different id.
  const selectionTokenRef = useRef(0)
  // Fix-round finding #1: true once a puzzle has EVER actually been
  // displayed (`setPuzzle` called with a real body — dev-stub or resolved
  // fetch), for the lifetime of the hook instance. Cold boot is exactly
  // "this is still false" — the only state with no stale puzzle to fall
  // back on if the body-load fails, so it's the only case that needs to
  // surface an 'error' status at all (mid-session, a failed background
  // refresh just leaves the stale puzzle on screen — see the `.then`/
  // `.catch` branches below).
  const hasDisplayedRef = useRef(false)

  const serveNext = useCallback(
    (currentProfile: UserProfile, pattern: PatternSlug | null, interaction: InteractionFilter) => {
      // Fix-round finding #2: bumped FIRST, before the null-pool early
      // return below (or anything else) — an older selection's still-
      // in-flight body-load promise captured the PREVIOUS token value, so
      // bumping it here immediately invalidates that promise's eventual
      // `.then`/`.catch` no matter which branch THIS call takes, including
      // the early `result === null` return. Without this, that early
      // return skipped the bump entirely (it lived after the null check),
      // so a stale in-flight fetch could still resolve later and overwrite
      // the 'empty' status this call is about to set with a stale puzzle —
      // reachable via PracticePage's `?pattern=&interaction=` URL effect
      // landing on an empty intersection while a cold-boot fetch is still
      // in flight.
      const token = ++selectionTokenRef.current
      const devMode = isDevPuzzleModeEnabled()
      const pool = devMode
        ? devPoolForFilters(pattern, interaction)
        : poolForFilters(pattern, interaction)
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
      lastSelectedIdRef.current = result.puzzle.id

      // selectNext advances the requeue ladder as a side effect of being
      // called (one call == one puzzle served, per its own doc comment) even
      // when the tick isn't itself an answered attempt — keep that state in
      // memory now; it's persisted for real the next time an attempt is
      // recorded (handleAnswered's saveProfile call), matching the brief's
      // "Per-attempt flow" persistence step rather than writing on every serve.
      setProfile({ ...currentProfile, requeueState: result.newRequeueState })

      // Cleared synchronously, for both paths, regardless of when the new
      // puzzle's BODY resolves: this is "the previous attempt's feedback is
      // gone now that a new one has started" state, not part of the puzzle
      // card's own content — there's no reason to keep showing a stale
      // rating delta just because the stale puzzle body is still on screen.
      // (Only `puzzle` itself is stale-while-revalidate — see below.)
      setRatingDelta(null)

      if (devMode) {
        const fullPuzzle = devStubById.current.get(result.puzzle.id)
        if (!fullPuzzle) {
          throw new Error(`selectNext returned unknown dev-stub puzzle id "${result.puzzle.id}"`)
        }
        setPuzzle(fullPuzzle)
        hasDisplayedRef.current = true
        servedAtRef.current = Date.now()
        setStatus('ready')
        return
      }

      // Real path: `puzzle` state is left untouched here (stale-while-
      // revalidate) — the previously-displayed puzzle keeps showing until
      // this id's body resolves below. Only true cold boot (no puzzle has
      // ever been displayed, `status` still 'loading') has no stale puzzle
      // to fall back on; PracticePage.tsx renders a RouteSkeleton for that
      // one case.
      loadPuzzleBody(result.puzzle.id)
        .then((fullPuzzle) => {
          if (selectionTokenRef.current !== token) return // superseded by a newer selection
          if (!fullPuzzle) {
            // puzzleMeta and getPuzzleBody's loaders are both generated from
            // the same on-disk content at build time, so this should be
            // unreachable in practice — reported via trackError either way.
            trackError(
              new Error(`getPuzzleBody: unknown puzzle id "${result.puzzle.id}"`),
              'usePracticeSession: serveNext body lookup miss',
            )
            // Fix-round finding #1: cold boot (nothing ever displayed) has
            // no stale puzzle to fall back on — without this the page would
            // hang on RouteSkeleton forever with no way to recover. Reuses
            // the existing 'error' status + retryLoad path (same recovery
            // loadProfile failures already use), mirroring Task 6's
            // useBossSession.ts prefetch-failure handling. Mid-session, the
            // stale puzzle (if any) is left exactly as it was — SWR's whole
            // point is that a fetch failure doesn't blank/replace it.
            if (!hasDisplayedRef.current) {
              setStatus('error')
            }
            return
          }
          setPuzzle(fullPuzzle)
          hasDisplayedRef.current = true
          servedAtRef.current = Date.now()
          setStatus('ready')
        })
        .catch((error: unknown) => {
          if (selectionTokenRef.current !== token) return
          // A failed dynamic import (offline, deploy-invalidated chunk) or
          // the zod validation throw on invalid content.
          trackError(error, 'usePracticeSession: serveNext body fetch failed')
          // Same cold-boot-only recovery path as the `!fullPuzzle` branch
          // above — see its comment.
          if (!hasDisplayedRef.current) {
            setStatus('error')
          }
        })
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

      // Speculative prefetch (content-metadata-lazy-load Task 5, carried-
      // forward Task 1 finding #1 — "rating drift"): fired HERE, once the
      // answer's rating/requeue effects are known, not at serve time. A
      // prefetch fired when this puzzle was originally served would have to
      // guess using the PRE-answer rating, but the real next `selectNext`
      // call (handleContinue -> serveNext) reads `profile.rating` AFTER this
      // answer updates it — so a serve-time prefetch would silently predict
      // against the wrong rating window for every rated attempt. Using
      // `newRating`/`newRequeueState` here instead means every speculative
      // draw models the exact state the next real call will actually see.
      // Skipped in DEV puzzle-mode: stub ids aren't real content, so
      // prefetching them via getPuzzleBody would only ever resolve
      // `undefined` — wasted work with nothing to show for it.
      if (!isDevPuzzleModeEnabled()) {
        const candidateIds = speculativeNextIds({
          pool: poolForFilters(patternFilter, interactionFilter),
          rating: newRating,
          requeueState: newRequeueState,
          lastSource: lastSourceRef.current,
          recentIds: [puzzle.id, ...recentIdsRef.current],
        })
        for (const id of candidateIds) {
          // Swallowed here, not reported: a speculative miss is expected and
          // routine (see the selection audit's hit-rate caveat) — a real
          // failure only matters if the id is later actually served, and
          // that path (serveNext) already reports it via trackError.
          loadPuzzleBody(id).catch(() => undefined)
        }
      }

      // Phase 5b Item 7/8: computed explicitly (not via setCombo's own
      // functional updater) since the streak-pause check right below needs
      // the actual new value synchronously, in this same closure.
      const newCombo = payload.correct ? combo + 1 : 0
      const pause = resolveStreakPause(newCombo, profile.bestRunStreak)

      const updatedProfile: UserProfile = {
        ...profile,
        rating: newRating,
        ratedAttemptCount: profile.ratedAttemptCount + 1,
        requeueState: newRequeueState,
        bestRunStreak: pause?.isNewBest ? newCombo : profile.bestRunStreak,
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
      setCombo(newCombo)
      // The live streak's correct answers, in order — feeds the streak
      // challenge link. A miss (combo → 0) clears it, so the link always
      // encodes the current streak.
      if (payload.correct) {
        setSolvedThisSession((s) => s + 1)
        setStreakAttempts((prev) => [
          ...prev,
          { puzzleId: puzzle.id, correct: true, time_ms: timeMs },
        ])
      } else {
        setStreakAttempts([])
      }
      setAttemptVersion((v) => v + 1)
      if (pause) {
        setStreakPause(pause)
        trackStreakPause({ mode: 'practice', streak: pause.streak, is_new_best: pause.isNewBest })
      }

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
    [profile, puzzle, combo, patternFilter, interactionFilter],
  )

  const handleContinue = useCallback(() => {
    if (!profile || !puzzle) return
    // Excludes the id most recently SELECTED, not necessarily `puzzle.id`
    // (the id most recently DISPLAYED) — see lastSelectedIdRef's own doc
    // comment for the narrow race this matters for. The two are the same id
    // in every normal flow (answer, see feedback, tap Continue once).
    const justServedId = lastSelectedIdRef.current ?? puzzle.id
    recentIdsRef.current = [justServedId, ...recentIdsRef.current].slice(0, RECENT_IDS_WINDOW)
    serveNext(profile, patternFilter, interactionFilter)
  }, [profile, puzzle, patternFilter, interactionFilter, serveNext])

  const handleStreakPauseKeepGoing = useCallback(() => {
    setStreakPause(null)
    handleContinue()
  }, [handleContinue])

  const handleStreakPauseDoneForNow = useCallback(() => {
    setStreakPause(null)
  }, [])

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
        const justServedId = lastSelectedIdRef.current ?? puzzle.id
        recentIdsRef.current = [justServedId, ...recentIdsRef.current].slice(0, RECENT_IDS_WINDOW)
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
        const justServedId = lastSelectedIdRef.current ?? puzzle.id
        recentIdsRef.current = [justServedId, ...recentIdsRef.current].slice(0, RECENT_IDS_WINDOW)
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
        const justServedId = lastSelectedIdRef.current ?? puzzle.id
        recentIdsRef.current = [justServedId, ...recentIdsRef.current].slice(0, RECENT_IDS_WINDOW)
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
    streakAttempts,
    attemptVersion,
    patternFilter,
    setPatternFilter,
    interactionFilter,
    setInteractionFilter,
    setFilters,
    streakPause,
    handleStreakPauseKeepGoing,
    handleStreakPauseDoneForNow,
    handleAnswered,
    handleContinue,
    retryLoad,
  }
}
