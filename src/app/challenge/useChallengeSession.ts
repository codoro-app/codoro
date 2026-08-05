/**
 * Orchestrates a `/challenge` run (v2 Phase 5c): decodes the payload from the
 * URL fragment (via src/challenge's codec), resolves every id against the full
 * `puzzlePool` (same full-union reasoning as `/puzzle/:id`), then sequences
 * the recipient through the same puzzles the challenger played, accumulating
 * per-puzzle correct/time results for the comparison screen and a
 * counter-challenge.
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
import { puzzlePool } from '../../content'
import type { Puzzle } from '../../content'
import { scoreScrubberAttempt } from '../../engine'
import type { CheckpointResult } from '../../engine'
import { decodeChallengePayload } from '../../challenge'
import type { ChallengeAttemptInput, ChallengePayload } from '../../challenge'
import { trackChallengeLinkComplete, trackChallengeLinkView } from '../../telemetry'
import { resolveChallengeOutcome } from './challengeOutcome'
import type { CommitPayload } from '../practice/interactionTypes'

export type ChallengeSessionStatus = 'broken' | 'playing' | 'done'

export interface ChallengeSession {
  status: ChallengeSessionStatus
  /** The decoded payload when the link resolved to a playable challenge; null when broken. */
  payload: ChallengePayload | null
  /** The puzzle currently on screen — null unless status === 'playing'. */
  puzzle: Puzzle | null
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

  // Resolve every id up front; any unresolvable id is the broken state, not
  // a partial run (reject-wholesale, mirroring the codec).
  const puzzles = useMemo<readonly Puzzle[] | null>(() => {
    if (!payload) return null
    const resolved: Puzzle[] = []
    for (const id of payload.ids) {
      const puzzle = puzzlePool.find((candidate) => candidate.id === id)
      if (!puzzle) return null
      resolved.push(puzzle)
    }
    return resolved
  }, [payload])

  // Defined as the disjunction of both null-cases (not just `puzzles ===
  // null`) so TS's const-alias narrowing carries `payload` through to
  // handleContinue's done branch too, where the complete-event telemetry
  // reads `payload.totalMs`/`payload.results`.
  const broken = payload === null || puzzles === null

  useEffect(() => {
    trackChallengeLinkView({ found: !broken })
    // ChallengePage keys this component by hash, so a change of hash remounts
    // it — a mount-only effect fires exactly once per page load. `broken` is
    // derived solely from `hash` (via payload → puzzles), so omitting it from
    // the deps is sound: it cannot change without a new mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  useEffect(() => {
    servedAtRef.current = Date.now()
    // Mount-only: the first puzzle is served synchronously (puzzlePool is
    // bundled — no async load like the other hooks'), so its timestamp is
    // stamped here rather than in a render-time initializer — Date.now() is
    // impure during render (react-hooks/purity), and every other hook's
    // servedAtRef starts at 0 for the same reason. (No reactive deps: the
    // effect only touches a ref.)
  }, [])

  const currentPuzzle = broken ? null : (puzzles[puzzleIndex] ?? null)
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
      if (broken || currentAnswered) return
      const puzzle = puzzles[puzzleIndex]
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
    [broken, currentAnswered, puzzles, puzzleIndex],
  )

  const handleCheckpointAnswered = useCallback(
    (result: CheckpointResult) => {
      if (broken) return
      const puzzle = puzzles[puzzleIndex]
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
    [broken, puzzles, puzzleIndex],
  )

  const handleContinue = useCallback(() => {
    if (broken || !isComplete) return
    const nextIndex = puzzleIndex + 1
    // `puzzles`/`payload` are narrowed to non-null here by the `broken`
    // guard above (const-alias narrowing — `broken` is `payload === null ||
    // puzzles === null`).
    if (nextIndex >= puzzles.length) {
      // Run complete. The comparison screen owns everything from here; the
      // complete-event fires on this exact transition — once, in the same
      // event handler that ends the run (the convention every other session
      // hook uses for its end-of-run telemetry, e.g. useRushSession's
      // trackRushRunEnd), not from a done-state effect that StrictMode could
      // double-invoke. A tie counts as not beating the challenger.
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
  }, [broken, isComplete, puzzleIndex, puzzles, payload, results])

  const status: ChallengeSessionStatus = broken
    ? 'broken'
    : // `puzzles` is narrowed to non-null in this branch, same const-alias
      // narrowing as handleContinue.
      puzzleIndex >= puzzles.length
      ? 'done'
      : 'playing'

  return {
    status,
    payload,
    puzzle: status === 'playing' ? currentPuzzle : null,
    checkpointResults,
    isComplete,
    solved,
    results,
    handleAnswered,
    handleCheckpointAnswered,
    handleContinue,
  }
}
