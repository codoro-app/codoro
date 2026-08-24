/**
 * Orchestrates a `/challenge` run (v2 Phase 5c): decodes the payload from the
 * URL fragment (via src/challenge's codec), resolves every id via
 * `getPuzzleBody` (Task 6 of the content-metadata-lazy-load follow-up — same
 * full-union reasoning as `/puzzle/:id`, just fetched on demand instead of
 * read from the eager `puzzlePool`), then sequences the recipient through the
 * same puzzles the challenger played, accumulating per-puzzle correct/time
 * results for the comparison screen and a counter-challenge. `status:
 * 'loading'` covers the brief window between mount and every id settling —
 * see the `Resolution` type below.
 *
 * Structurally unrated, same standard as `/puzzle/:id` (Phase 1b Decision 1):
 * no `appendAttempt`, no `saveProfile`, no rating math anywhere in this hook.
 * Telemetry is the only record of a challenge run — `challenge_link_view`
 * fires once per page load here, and `challenge_link_complete` fires when the
 * run finishes (see handleContinue). The per-puzzle `time_ms` each result
 * carries is measured at answer-commit time from the moment the puzzle became
 * current — the same servedAt convention every other session hook uses — so
 * the recipient's total is directly comparable to the challenger's `totalMs`
 * (which was recorded the same way by the surface's own session hook).
 *
 * Broken-link handling is reject-wholesale, matching the codec's own
 * every-failure-collapses-to-null standard: a payload that doesn't decode, OR
 * whose ids don't all resolve to real bundled puzzles, is one legible broken
 * state — never a partial run. Both collapse to the same `status: 'broken'`.
 *
 * The hook takes the fragment content (no leading '#'), read by
 * ChallengePage from wouter's location and passed through `key={hash}` so a
 * hash change remounts a fresh session — the same keyed-remount convention
 * TraceRunnerPuzzle uses per puzzle, giving exactly-once view telemetry per
 * page load without any reset effect.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getPuzzleBody } from '../../content'
import type { Puzzle } from '../../content'
import { scoreScrubberAttempt } from '../../engine'
import type { CheckpointResult } from '../../engine'
import { decodeChallengePayload } from '../../challenge'
import type { ChallengeAttemptInput, ChallengePayload } from '../../challenge'
import { trackChallengeLinkComplete, trackChallengeLinkView } from '../../telemetry'
import { resolveChallengeOutcome } from './challengeOutcome'
import type { CommitPayload } from '../practice/interactionTypes'

export type ChallengeSessionStatus = 'loading' | 'broken' | 'playing' | 'done'

/**
 * Puzzle-body resolution state, kept as one discriminated value (not
 * separate `status`/`puzzles` state pairs) so TS narrows `puzzles` for free
 * everywhere it's read below — the two are always set together. `loading`
 * covers the async `getPuzzleBody` hop this hook now has (Task 6 of the
 * content-metadata-lazy-load follow-up): every id in the payload used to
 * resolve synchronously against the eager `puzzlePool`; now each is fetched
 * on demand, in parallel, and only decided once every id has settled —
 * still reject-wholesale, matching the codec's own standard (see this
 * file's module doc comment).
 */
type Resolution =
  { status: 'loading' } | { status: 'broken' } | { status: 'resolved'; puzzles: readonly Puzzle[] }

export interface ChallengeSession {
  status: ChallengeSessionStatus
  /** The decoded payload when the link resolved to a playable challenge; null when broken. */
  payload: ChallengePayload | null
  /** The puzzle currently on screen — null unless status === 'playing'. */
  puzzle: Puzzle | null
  /**
   * Position of `puzzle` in the challenge's puzzle order. Exposed so the page
   * can key the puzzle shell by *position* rather than `puzzle.id` — a
   * challenge payload can legally repeat an id back-to-back (a real Practice
   * session can re-serve the same puzzle within its soft no-repeat window,
   * and a hand-edited link can do it on purpose), and PuzzleCardShell's
   * self-reset guard compares `commit.puzzleId === puzzle.id`
   * (src/app/practice/PuzzleCardShell.tsx), which can't distinguish two
   * occurrences of the same id — keying by `puzzle.id` alone would reuse the
   * shell instance across them, leaving it permanently "committed" to the
   * first occurrence's feedback with a Continue button that never re-arms.
   */
  puzzleIndex: number
  /** Per-checkpoint results for the current scrubber puzzle — empty for quiz puzzles. */
  checkpointResults: readonly CheckpointResult[]
  /** True once the current puzzle has been fully answered (quiz commit, or every scrubber checkpoint). */
  isComplete: boolean
  /** Current puzzle's solved verdict for the scrubber branch — null until complete (and always null for quiz puzzles). */
  solved: boolean | null
  /** Per-puzzle results for completed puzzles, in play order. Drives the comparison screen and counter-challenge. */
  results: readonly ChallengeAttemptInput[]
  /** Called the instant a quiz answer commits (PuzzleCardShell's onAnswered) — records that puzzle's result. */
  handleAnswered: (payload: CommitPayload) => void
  /** Called per scrubber checkpoint answer; records the puzzle's result once every checkpoint is answered. */
  handleCheckpointAnswered: (result: CheckpointResult) => void
  /** Called on Continue — advances to the next puzzle, or into the done state after the last one. */
  handleContinue: () => void
}

export function useChallengeSession(hash: string): ChallengeSession {
  const payload = useMemo(() => decodeChallengePayload(hash), [hash])

  const [fetchResolution, setFetchResolution] = useState<Resolution>(() =>
    payload === null ? { status: 'broken' } : { status: 'loading' },
  )
  // useRef, not a plain `let cancelled = false` closed over by the async
  // callback below: eslint's no-unnecessary-condition narrows a bare `let`
  // to its initial literal value across the closure boundary and flags the
  // later `if (cancelled)` read as always-false — same fix
  // usePracticeSession.ts's own mount effect already uses for this exact
  // shape (see its own comment).
  const cancelledRef = useRef(false)

  // Resolve every id in parallel via getPuzzleBody; any unresolvable id
  // collapses the whole payload to the broken state, not a partial run
  // (reject-wholesale, mirroring the codec) — same standard as before, just
  // decided once every fetch settles instead of synchronously against the
  // eager puzzlePool. Re-runs whenever `payload` changes identity (a new
  // hash) — ChallengePage also remounts on hash change (key={hash}), so in
  // practice this only ever runs once per mount, but the hook stays correct
  // standalone too (see this hook's own tests, which drive it directly).
  useEffect(() => {
    // A decode failure is a pure function of `payload` alone — no fetch
    // involved, so it's derived in `resolution` below rather than stored
    // here (react-hooks/set-state-in-effect: an effect branch that does
    // nothing but set state and return belongs in render, not an effect).
    if (payload === null) return
    cancelledRef.current = false
    void (async () => {
      // The loading reset lives here, as the first synchronous work inside
      // the async callback (not as the effect body's own first statement) —
      // react-hooks/set-state-in-effect reads a bare "first-statement
      // setState" as the resetting-state-on-prop-change anti-pattern
      // react.dev warns about. This still runs synchronously, in the same
      // tick as everything else in this effect (JS runs an async function's
      // body up to its first `await` immediately) — same timing, different
      // syntactic position.
      setFetchResolution({ status: 'loading' })
      const results = await Promise.all(payload.ids.map((id) => getPuzzleBody(id)))
      if (cancelledRef.current) return
      if (results.some((puzzle) => puzzle === undefined)) {
        setFetchResolution({ status: 'broken' })
        return
      }
      setFetchResolution({ status: 'resolved', puzzles: results as Puzzle[] })
    })()
    return () => {
      cancelledRef.current = true
    }
  }, [payload])

  // Derived, not stored: a decode failure is knowable synchronously from
  // `payload` alone (see the effect above) — only the fetch outcome
  // (loading/broken-by-missing-id/resolved) actually needs state. Memoized
  // so its identity is stable across renders that don't change either
  // input — several hooks/effects below depend on it.
  const resolution: Resolution = useMemo(
    () => (payload === null ? { status: 'broken' } : fetchResolution),
    [payload, fetchResolution],
  )

  // Fires exactly once per page load, only once resolution has actually
  // settled (broken or resolved) — never while still 'loading', so an
  // unresolved-yet id can't be miscounted as `found: false`. Guarded by a
  // ref (not just an empty deps array, since this effect must react to
  // `resolution` changing) against firing twice if resolution somehow
  // settles more than once in a single mount.
  const viewTrackedRef = useRef(false)
  useEffect(() => {
    if (resolution.status === 'loading') return
    if (viewTrackedRef.current) return
    viewTrackedRef.current = true
    trackChallengeLinkView({ found: resolution.status === 'resolved' })
  }, [resolution])

  // puzzleIndex is the current puzzle's position in `puzzles`; it only
  // advances on Continue (never on answer — the shells need to show their
  // feedback panel first), exactly like Daily/Rush/Practice's own split of
  // handleAnswered vs handleContinue.
  const [puzzleIndex, setPuzzleIndex] = useState(0)
  const [results, setResults] = useState<ChallengeAttemptInput[]>([])
  const [checkpointResults, setCheckpointResults] = useState<CheckpointResult[]>([])
  const servedAtRef = useRef(0)
  // Source of truth for "how many checkpoints answered so far", mutated
  // synchronously — the same ref-plus-state pair useTraceSession and
  // ScrubberLinkPuzzle use. setState updaters must stay pure (React may
  // invoke one more than once for a single logical update, and this app
  // renders under StrictMode, which does so deliberately in development);
  // the guard is the ref's job, telemetry/side-effects the handler's.
  const checkpointResultsRef = useRef<CheckpointResult[]>([])
  // Guards the run-end transition in handleContinue below against firing
  // trackChallengeLinkComplete twice: `isComplete` stays true for every
  // render between the click that ends the run and the setPuzzleIndex
  // update actually committing, so a rapid double-dispatch of onContinue
  // (a fast double-click, or two calls queued before React flushes) would
  // otherwise double-fire the run's only completion telemetry. Same
  // ref-guards-a-callback pattern as checkpointResultsRef above.
  const runCompleteRef = useRef(false)

  useEffect(() => {
    if (resolution.status !== 'resolved') return
    servedAtRef.current = Date.now()
    // Fires once, the instant the ids resolve and the first puzzle actually
    // becomes servable — NOT at mount, unlike before (Task 6: puzzle bodies
    // are now fetched via getPuzzleBody, a genuine async hop puzzlePool
    // never had). Only fires once per mount even though the effect depends
    // on `resolution.status`: that string only ever transitions into
    // 'resolved' a single time (loading -> broken or loading -> resolved,
    // never back), so this doesn't re-stamp on every render while playing —
    // every subsequent puzzle's timestamp comes from handleContinue below,
    // same as before. Date.now() is impure during render
    // (react-hooks/purity), hence stamping it here rather than in a
    // render-time initializer.
  }, [resolution.status])

  const currentPuzzle =
    resolution.status === 'resolved' ? (resolution.puzzles[puzzleIndex] ?? null) : null
  // A puzzle's result lands in `results` the moment it's fully answered —
  // at quiz commit, or at the last scrubber checkpoint — so "is the current
  // puzzle answered" is exactly `results.length === puzzleIndex + 1`.
  const currentAnswered = results.length === puzzleIndex + 1
  const isComplete =
    currentPuzzle !== null &&
    (currentPuzzle.interaction === 'scrubber'
      ? checkpointResults.length >= currentPuzzle.checkpoints.length
      : currentAnswered)
  const solved =
    isComplete && currentPuzzle.interaction === 'scrubber'
      ? scoreScrubberAttempt(checkpointResults)
      : null

  const handleAnswered = useCallback(
    (commit: CommitPayload) => {
      if (resolution.status !== 'resolved' || currentAnswered) return
      const puzzle = resolution.puzzles[puzzleIndex]
      if (!puzzle || puzzle.interaction === 'scrubber') return
      setResults((prev) => [
        ...prev,
        {
          puzzleId: puzzle.id,
          correct: commit.correct,
          time_ms: Math.max(0, Date.now() - servedAtRef.current),
        },
      ])
    },
    [resolution, currentAnswered, puzzleIndex],
  )

  const handleCheckpointAnswered = useCallback(
    (result: CheckpointResult) => {
      if (resolution.status !== 'resolved') return
      const puzzle = resolution.puzzles[puzzleIndex]
      // Optional-chain guard: `puzzle?.interaction !== 'scrubber'` collapses
      // "no puzzle here" (index past the end) and "quiz puzzle" into the same
      // return — `undefined !== 'scrubber'` is true, so both bail. TS then
      // narrows `puzzle` (a const) to ScrubberPuzzle for the calls below.
      if (puzzle?.interaction !== 'scrubber') return
      if (checkpointResultsRef.current.length >= puzzle.checkpoints.length) return // already complete — mirrors useTraceSession's no-op guard

      const next = [...checkpointResultsRef.current, result]
      checkpointResultsRef.current = next
      setCheckpointResults(next)

      if (next.length >= puzzle.checkpoints.length) {
        setResults((prev) => [
          ...prev,
          {
            puzzleId: puzzle.id,
            correct: scoreScrubberAttempt(next),
            time_ms: Math.max(0, Date.now() - servedAtRef.current),
          },
        ])
      }
    },
    [resolution, puzzleIndex],
  )

  const handleContinue = useCallback(() => {
    if (resolution.status !== 'resolved' || !isComplete) return
    // Unreachable in practice: `resolution` only ever reaches 'resolved' via
    // the effect above, which requires `payload !== null` before it starts
    // fetching — this check exists purely so TS narrows `payload` for the
    // reads below.
    if (payload === null) return
    const nextIndex = puzzleIndex + 1
    if (nextIndex >= resolution.puzzles.length) {
      // Run complete. The comparison screen owns everything from here; the
      // complete-event fires on this exact transition — once, in the same
      // event handler that ends the run (the convention every other session
      // hook uses for its end-of-run telemetry, e.g. useRushSession's
      // trackRushRunEnd), not from a done-state effect that StrictMode could
      // double-invoke. A tie counts as not beating the challenger.
      // runCompleteRef guards against a second dispatch of this same
      // transition landing before setPuzzleIndex below has committed (see
      // the ref's own doc comment).
      if (runCompleteRef.current) return
      runCompleteRef.current = true
      trackChallengeLinkComplete({
        beat_challenger:
          resolveChallengeOutcome(
            {
              correct: results.filter((r) => r.correct).length,
              totalMs: results.reduce((sum, r) => sum + r.time_ms, 0),
            },
            { correct: payload.results.filter((r) => r.correct).length, totalMs: payload.totalMs },
          ) === 'won',
      })
      setPuzzleIndex(nextIndex)
      return
    }
    setPuzzleIndex(nextIndex)
    setCheckpointResults([])
    checkpointResultsRef.current = []
    servedAtRef.current = Date.now()
  }, [resolution, isComplete, puzzleIndex, payload, results])

  const status: ChallengeSessionStatus =
    resolution.status === 'loading'
      ? 'loading'
      : resolution.status === 'broken'
        ? 'broken'
        : puzzleIndex >= resolution.puzzles.length
          ? 'done'
          : 'playing'

  return {
    status,
    payload,
    puzzle: status === 'playing' ? currentPuzzle : null,
    puzzleIndex,
    checkpointResults,
    isComplete,
    solved,
    results,
    handleAnswered,
    handleCheckpointAnswered,
    handleContinue,
  }
}
