/**
 * Play Human's initiator-side session (Compete) — plays a locally-drawn,
 * fixed 5-puzzle id list in order and accumulates `ChallengeAttemptInput`
 * results, the same `servedAtRef`-based `time_ms` measurement convention
 * every other session hook uses (see useChallengeSession.ts's own module
 * doc comment). Deliberately thinner than useChallengeSession: no decode
 * step (ids are already known — drawn by the caller via
 * `widenedEligible`/`sampleDistinctIds`, src/challenge), no broken-link
 * concept (the ids came from the live pool this session drew them from, not
 * an external link), and no ghost bar (there is no opponent yet — the
 * initiator IS the one generating the times a future recipient will race).
 * Structurally unrated, same standard as every challenge-shaped surface: no
 * appendAttempt, no saveProfile, no rating math.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPuzzleBody } from '../../content'
import type { Puzzle } from '../../content'
import { scoreScrubberAttempt } from '../../engine'
import type { CheckpointResult } from '../../engine'
import type { ChallengeAttemptInput } from '../../challenge'
import { trackError } from '../../telemetry'
import type { CommitPayload } from '../practice/interactionTypes'

export type CompeteSessionStatus = 'loading' | 'playing' | 'done'

export interface CompeteSession {
  status: CompeteSessionStatus
  puzzle: Puzzle | null
  puzzleIndex: number
  totalPuzzles: number
  checkpointResults: readonly CheckpointResult[]
  isComplete: boolean
  solved: boolean | null
  results: readonly ChallengeAttemptInput[]
  handleAnswered: (payload: CommitPayload) => void
  handleCheckpointAnswered: (result: CheckpointResult) => void
  handleContinue: () => void
}

export function useCompeteSession(ids: readonly string[]): CompeteSession {
  // Stable string key for the effect below — `ids` is a fresh array
  // reference on every CompetePage render otherwise, which would re-trigger
  // body resolution on every unrelated re-render.
  const idsKey = ids.join(',')
  const [puzzles, setPuzzles] = useState<readonly Puzzle[] | null>(null)
  const runTokenRef = useRef(0)

  useEffect(() => {
    const token = ++runTokenRef.current
    void (async () => {
      // The loading reset lives here, as the first synchronous work inside
      // the async callback (not as the effect body's own first statement) —
      // same react-hooks/set-state-in-effect fix useChallengeSession.ts's
      // own analogous effect documents: this still runs synchronously, in
      // the same tick as everything else in this effect (JS runs an async
      // function's body up to its first `await` immediately), just at a
      // different syntactic position.
      setPuzzles(null)
      try {
        const resolved = await Promise.all(ids.map((id) => getPuzzleBody(id)))
        if (runTokenRef.current !== token) return
        const found = resolved.filter((puzzle): puzzle is Puzzle => puzzle !== undefined)
        setPuzzles(found)
      } catch (error) {
        if (runTokenRef.current !== token) return
        trackError(error, 'useCompeteSession: getPuzzleBody failed')
        setPuzzles([])
      }
    })()
    return () => {
      runTokenRef.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by idsKey (stable string), not the ids array's own identity; see comment above.
  }, [idsKey])

  const [puzzleIndex, setPuzzleIndex] = useState(0)
  const [results, setResults] = useState<ChallengeAttemptInput[]>([])
  const [checkpointResults, setCheckpointResults] = useState<CheckpointResult[]>([])
  const checkpointResultsRef = useRef<CheckpointResult[]>([])
  const servedAtRef = useRef(0)

  // Stamps the clock for puzzle 1 the instant bodies resolve — no intro
  // hero to wait for here (see this file's module doc comment), unlike
  // useChallengeSession's handleAccept.
  const stampedRef = useRef(false)
  useEffect(() => {
    if (puzzles !== null && puzzles.length > 0 && !stampedRef.current) {
      stampedRef.current = true
      servedAtRef.current = Date.now()
    }
  }, [puzzles])

  const currentPuzzle = puzzles?.[puzzleIndex] ?? null
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
      if (!currentPuzzle || currentPuzzle.interaction === 'scrubber' || currentAnswered) return
      setResults((prev) => [
        ...prev,
        {
          puzzleId: currentPuzzle.id,
          correct: commit.correct,
          time_ms: Math.max(0, Date.now() - servedAtRef.current),
        },
      ])
    },
    [currentPuzzle, currentAnswered],
  )

  const handleCheckpointAnswered = useCallback(
    (result: CheckpointResult) => {
      if (currentPuzzle?.interaction !== 'scrubber') return
      if (checkpointResultsRef.current.length >= currentPuzzle.checkpoints.length) return
      const next = [...checkpointResultsRef.current, result]
      checkpointResultsRef.current = next
      setCheckpointResults(next)
      if (next.length >= currentPuzzle.checkpoints.length) {
        setResults((prev) => [
          ...prev,
          {
            puzzleId: currentPuzzle.id,
            correct: scoreScrubberAttempt(next),
            time_ms: Math.max(0, Date.now() - servedAtRef.current),
          },
        ])
      }
    },
    [currentPuzzle],
  )

  const handleContinue = useCallback(() => {
    if (!isComplete || puzzles === null) return
    const nextIndex = puzzleIndex + 1
    if (nextIndex >= puzzles.length) {
      setPuzzleIndex(nextIndex)
      return
    }
    setPuzzleIndex(nextIndex)
    setCheckpointResults([])
    checkpointResultsRef.current = []
    servedAtRef.current = Date.now()
  }, [isComplete, puzzles, puzzleIndex])

  const status: CompeteSessionStatus =
    puzzles === null ? 'loading' : puzzleIndex >= puzzles.length ? 'done' : 'playing'

  return {
    status,
    puzzle: status === 'playing' ? currentPuzzle : null,
    puzzleIndex,
    totalPuzzles: puzzles?.length ?? ids.length,
    checkpointResults,
    isComplete,
    solved,
    results,
    handleAnswered,
    handleCheckpointAnswered,
    handleContinue,
  }
}
