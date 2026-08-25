import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  scrubberActualScore,
  updateRating,
  roundForDisplay,
  TRACE_K_MULTIPLIER,
} from '../../engine'
import type { Puzzle } from '../../content'
import { useTraceSession } from './useTraceSession'

const { FIXTURE_SCRUBBER_POOL, FIXTURE_PUZZLE_META, FIXTURE_BODY_BY_ID } = vi.hoisted(() => {
  const pool = Array.from({ length: 12 }, (_, i) => ({
    id: `s${String(i)}`,
    pattern: i % 2 === 0 ? 'off-by-one' : 'null-undefined',
    difficulty_rating: 1150 + i * 10,
    explanation: `explanation ${String(i)}`,
    prompt: `prompt ${String(i)}`,
    language: 'javascript',
    snippet: 'let x = 0;\nx = x + 1;\nconsole.log(x);',
    interaction: 'scrubber',
    steps: [
      { line: 0, vars: { x: '0' } },
      { line: 1, vars: { x: '1' } },
      { line: 2, vars: { x: '1' }, output: '1' },
    ],
    checkpoints: [
      { afterStep: 0, question: 'var-value', target: 'x', choices: ['0', '1'], correct: 0 },
      { afterStep: 1, question: 'next-line', choices: ['1', '2'], correct: 1 },
    ],
  })) as unknown as Puzzle[]
  return {
    FIXTURE_SCRUBBER_POOL: pool,
    // content-metadata-lazy-load Task 5: useTraceSession now selects from
    // `puzzleMeta` (filtered to interaction === 'scrubber' internally) and
    // loads bodies via `getPuzzleBody`, not `scrubberPool` directly.
    FIXTURE_PUZZLE_META: pool.map((p) => ({
      id: p.id,
      pattern: p.pattern,
      difficulty_rating: p.difficulty_rating,
      interaction: p.interaction,
    })),
    FIXTURE_BODY_BY_ID: new Map(pool.map((p) => [p.id, p])),
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_SCRUBBER_POOL,
    scrubberPool: FIXTURE_SCRUBBER_POOL,
    puzzleMeta: FIXTURE_PUZZLE_META,
    getPuzzleBody: vi.fn((id: string) => Promise.resolve(FIXTURE_BODY_BY_ID.get(id))),
  }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
    appendAttempt: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({
  trackTraceAttempt: vi.fn(),
  trackStreakPause: vi.fn(),
  trackError: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { trackTraceAttempt, trackStreakPause, trackError } = await import('../../telemetry')
const { getPuzzleBody } = await import('../../content')
const { resetPuzzleBodyCacheForTests } = await import('../practice/puzzleBodyCache')

/** Answers every checkpoint on the currently-served puzzle, in order. */
function answerAllCheckpoints(
  result: { current: ReturnType<typeof useTraceSession> },
  correct: boolean,
) {
  const puzzle = result.current.puzzle
  if (!puzzle) throw new Error('expected a puzzle to be served')
  act(() => {
    puzzle.checkpoints.forEach(() => {
      result.current.handleCheckpointAnswered({ correct, choiceIndex: correct ? 0 : 1 })
    })
  })
}

/** Solves the current puzzle fully correctly, then advances to the next one. */
function solveAndContinue(result: { current: ReturnType<typeof useTraceSession> }) {
  answerAllCheckpoints(result, true)
  act(() => {
    result.current.handleContinue()
  })
}

describe('useTraceSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    resetPuzzleBodyCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the profile and serves a first scrubber puzzle from scrubberPool on mount', async () => {
    const { result } = renderHook(() => useTraceSession())

    expect(result.current.status).toBe('loading')
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    expect(loadProfile).toHaveBeenCalledTimes(1)
    expect(result.current.puzzle).not.toBeNull()
    expect(FIXTURE_SCRUBBER_POOL.some((p) => p.id === result.current.puzzle?.id)).toBe(true)
    expect(result.current.checkpointResults).toEqual([])
    expect(result.current.isComplete).toBe(false)
    expect(result.current.solved).toBeNull()
    expect(result.current.ratingDelta).toBeNull()
  })

  it('accumulates checkpoint results one at a time and only completes on the final checkpoint', async () => {
    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const puzzle = result.current.puzzle
    if (!puzzle) throw new Error('expected a puzzle to be served')
    expect(puzzle.checkpoints.length).toBe(2)

    act(() => {
      result.current.handleCheckpointAnswered({ correct: true, choiceIndex: 0 })
    })
    expect(result.current.checkpointResults).toEqual([{ correct: true, choiceIndex: 0 }])
    expect(result.current.isComplete).toBe(false)
    expect(appendAttempt).not.toHaveBeenCalled()

    act(() => {
      result.current.handleCheckpointAnswered({ correct: true, choiceIndex: 1 })
    })
    expect(result.current.checkpointResults).toEqual([
      { correct: true, choiceIndex: 0 },
      { correct: true, choiceIndex: 1 },
    ])
    expect(result.current.isComplete).toBe(true)
    expect(appendAttempt).toHaveBeenCalledTimes(1)
  })

  it('a fully-correct attempt scores solved via scoreScrubberAttempt, rates via engine updateRating, persists mode "practice" with non-null checkpoint_results, and fires trackTraceAttempt', async () => {
    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const puzzle = result.current.puzzle
    if (!puzzle) throw new Error('expected a puzzle to be served')
    const before = result.current.profile
    if (!before) throw new Error('expected a profile to be loaded')

    const expectedNewRating = updateRating(
      before.rating,
      puzzle.difficulty_rating,
      1, // fractional actual-score: both checkpoints correct = 1.0
      before.ratedAttemptCount,
      TRACE_K_MULTIPLIER,
    )
    const expectedDelta = roundForDisplay(expectedNewRating) - roundForDisplay(before.rating)

    answerAllCheckpoints(result, true)

    expect(result.current.isComplete).toBe(true)
    expect(result.current.solved).toBe(true)
    expect(result.current.ratingDelta).toBe(expectedDelta)
    expect(result.current.profile?.rating).toBe(expectedNewRating)
    expect(result.current.profile?.ratedAttemptCount).toBe(1)

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ rating: expectedNewRating, ratedAttemptCount: 1 }),
    )

    // Reviewer focus: this must fail if the hook ever stamps a wrong mode
    // or a null checkpoint_results.
    expect(appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        puzzleId: puzzle.id,
        correct: true,
        mode: 'practice',
        choice_index: null,
        checkpoint_results: [
          { correct: true, choiceIndex: 0 },
          { correct: true, choiceIndex: 0 },
        ],
        userRatingBefore: before.rating,
        userRatingAfter: expectedNewRating,
      }),
    )
    const persistedAttempt = vi.mocked(appendAttempt).mock.calls[0]?.[0]
    expect(persistedAttempt?.mode).not.toBe('rush')
    expect(persistedAttempt?.mode).not.toBe('daily')
    expect(persistedAttempt?.checkpoint_results).not.toBeNull()
    expect(persistedAttempt?.checkpoint_results).toHaveLength(2)

    expect(trackTraceAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        puzzle_id: puzzle.id,
        correct: true,
        mode: 'practice',
        interaction: 'scrubber',
        user_rating_before: before.rating,
        user_rating_after: expectedNewRating,
        checkpoint_results: [
          { correct: true, choice_index: 0, timed_out: false },
          { correct: true, choice_index: 0, timed_out: false },
        ],
      }),
    )
    // trackTraceAttempt fires once per completed puzzle, not once per checkpoint.
    expect(trackTraceAttempt).toHaveBeenCalledTimes(1)
  })

  it('any missed checkpoint fails the whole attempt (scoreScrubberAttempt semantics) and records a requeue miss', async () => {
    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const puzzle = result.current.puzzle
    if (!puzzle) throw new Error('expected a puzzle to be served')

    act(() => {
      result.current.handleCheckpointAnswered({ correct: true, choiceIndex: 0 })
    })
    act(() => {
      result.current.handleCheckpointAnswered({ correct: false, choiceIndex: 1 })
    })

    expect(result.current.solved).toBe(false)
    expect(result.current.profile?.requeueState).toEqual([
      { puzzleId: puzzle.id, stage: 0, served: 0 },
    ])
    expect(appendAttempt).toHaveBeenCalledWith(expect.objectContaining({ correct: false }))
  })

  it('a partially-correct attempt exactly at the guess floor (1 of 2, both checkpoints binary) rates the same as a flat miss', async () => {
    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const puzzle = result.current.puzzle
    if (!puzzle) throw new Error('expected a puzzle to be served')
    const before = result.current.profile
    if (!before) throw new Error('expected a profile to be loaded')

    // Both of this fixture's checkpoints offer 2 choices, so "1 of 2
    // correct" is exactly what pure guessing would produce on average — the
    // guess-floor correction (scrubberActualScore) rescales that down to 0,
    // no different from a flat miss. Computed via the real engine function
    // against this puzzle's actual checkpoints, not hardcoded, so this
    // tracks useTraceSession's own choiceCounts wiring rather than
    // restating the formula. This is the fix for the rating-inflation bug:
    // before it, this same attempt rated as 0.5 actual — real, unearned
    // credit for a coin-flip guess.
    const choiceCounts = puzzle.checkpoints.map((checkpoint) => checkpoint.choices.length)
    const actualScore = scrubberActualScore(
      [
        { correct: true, choiceIndex: 0 },
        { correct: false, choiceIndex: 1 },
      ],
      choiceCounts,
    )
    expect(actualScore).toBe(0)

    const expectedNewRating = updateRating(
      before.rating,
      puzzle.difficulty_rating,
      actualScore,
      before.ratedAttemptCount,
      TRACE_K_MULTIPLIER,
    )
    const flatMissRating = updateRating(
      before.rating,
      puzzle.difficulty_rating,
      false,
      before.ratedAttemptCount,
      TRACE_K_MULTIPLIER,
    )
    expect(expectedNewRating).toBe(flatMissRating)

    act(() => {
      result.current.handleCheckpointAnswered({ correct: true, choiceIndex: 0 })
    })
    act(() => {
      result.current.handleCheckpointAnswered({ correct: false, choiceIndex: 1 })
    })

    expect(result.current.solved).toBe(false)
    expect(result.current.profile?.rating).toBe(expectedNewRating)
    expect(result.current.profile?.rating).toBe(flatMissRating)
  })

  it('a missed puzzle resurfaces via requeue after 3 continues (stage-0 ladder interval)', async () => {
    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const missedId = result.current.puzzle?.id
    if (!missedId) throw new Error('expected a puzzle to be served')

    answerAllCheckpoints(result, false)
    expect(result.current.isComplete).toBe(true)

    act(() => {
      result.current.handleContinue()
    })
    answerAllCheckpoints(result, true)
    act(() => {
      result.current.handleContinue()
    })
    answerAllCheckpoints(result, true)
    act(() => {
      result.current.handleContinue()
    })

    expect(result.current.puzzle?.id).toBe(missedId)
  })

  it('handleContinue no-ops until the current puzzle is complete', async () => {
    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const onScreenId = result.current.puzzle?.id
    act(() => {
      result.current.handleCheckpointAnswered({ correct: true, choiceIndex: 0 })
    })
    act(() => {
      result.current.handleContinue()
    })

    expect(result.current.puzzle?.id).toBe(onScreenId)
    expect(result.current.isComplete).toBe(false)
    expect(appendAttempt).not.toHaveBeenCalled()
  })

  it('extra handleCheckpointAnswered calls past isComplete are ignored', async () => {
    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAllCheckpoints(result, true)
    expect(result.current.isComplete).toBe(true)
    expect(appendAttempt).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.handleCheckpointAnswered({ correct: false, choiceIndex: 1 })
    })

    expect(appendAttempt).toHaveBeenCalledTimes(1)
    expect(result.current.checkpointResults).toHaveLength(2)
  })

  it('a rejected loadProfile() on mount transitions to an error status, reports via trackError, and retryLoad recovers', async () => {
    vi.mocked(loadProfile).mockRejectedValueOnce(new Error('IndexedDB blocked'))

    const { result } = renderHook(() => useTraceSession())

    expect(result.current.status).toBe('loading')
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    expect(trackError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.stringContaining('loadProfile'),
    )
    expect(result.current.puzzle).toBeNull()

    vi.mocked(loadProfile).mockResolvedValueOnce(createDefaultProfile())

    act(() => {
      result.current.retryLoad()
    })

    expect(result.current.status).toBe('loading')
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.puzzle).not.toBeNull()
    expect(loadProfile).toHaveBeenCalledTimes(2)
  })

  it('appendAttempt/saveProfile failures are reported via trackError without blocking completion state', async () => {
    vi.mocked(appendAttempt).mockRejectedValueOnce(new Error('quota exceeded'))
    vi.mocked(saveProfile).mockRejectedValueOnce(new Error('quota exceeded'))

    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAllCheckpoints(result, true)

    expect(result.current.isComplete).toBe(true)
    expect(result.current.solved).toBe(true)

    await waitFor(() => {
      expect(trackError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('appendAttempt'),
      )
    })
    await waitFor(() => {
      expect(trackError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('saveProfile'),
      )
    })
  })

  describe('streak-pause (Phase 5b Item 7/8)', () => {
    it('fires at the 5th solved puzzle in a row, marks isNewBest, and persists bestRunStreak', async () => {
      const { result } = renderHook(() => useTraceSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      expect(result.current.streakPause).toBeNull()
      expect(result.current.streak).toBe(0)

      for (let i = 0; i < 4; i++) {
        solveAndContinue(result)
      }
      expect(result.current.streakPause).toBeNull() // not yet — only 4 solved in a row

      answerAllCheckpoints(result, true) // 5th solve

      expect(result.current.streak).toBe(5)
      expect(result.current.streakPause).toEqual({ streak: 5, isNewBest: true })
      expect(trackStreakPause).toHaveBeenCalledWith({
        mode: 'trace',
        streak: 5,
        is_new_best: true,
      })
      expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ bestRunStreak: 5 }))
    })

    it('a missed checkpoint resets the streak, so it never fires from 4 solved + 1 missed + 4 solved', async () => {
      const { result } = renderHook(() => useTraceSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      for (let i = 0; i < 4; i++) {
        solveAndContinue(result)
      }
      answerAllCheckpoints(result, false) // missed — streak resets to 0
      act(() => {
        result.current.handleContinue()
      })
      for (let i = 0; i < 4; i++) {
        solveAndContinue(result)
      }

      expect(result.current.streakPause).toBeNull()
      expect(trackStreakPause).not.toHaveBeenCalled()
    })

    it('handleStreakPauseKeepGoing dismisses the pause and serves the next puzzle', async () => {
      const { result } = renderHook(() => useTraceSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      for (let i = 0; i < 4; i++) {
        solveAndContinue(result)
      }
      answerAllCheckpoints(result, true)
      expect(result.current.streakPause).not.toBeNull()

      act(() => {
        result.current.handleStreakPauseKeepGoing()
      })

      expect(result.current.streakPause).toBeNull()
      expect(result.current.puzzle).not.toBeNull()
      expect(result.current.checkpointResults).toEqual([]) // a fresh puzzle was served
    })

    it('handleStreakPauseDoneForNow only dismisses the pause — the completed puzzle stays on screen', async () => {
      const { result } = renderHook(() => useTraceSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      for (let i = 0; i < 4; i++) {
        solveAndContinue(result)
      }
      answerAllCheckpoints(result, true)
      const puzzleAtPause = result.current.puzzle?.id
      expect(result.current.streakPause).not.toBeNull()

      act(() => {
        result.current.handleStreakPauseDoneForNow()
      })

      expect(result.current.streakPause).toBeNull()
      expect(result.current.puzzle?.id).toBe(puzzleAtPause)
      expect(result.current.isComplete).toBe(true) // still showing the solved puzzle's own solve panel
    })
  })

  describe('content-metadata-lazy-load Task 5: stale-while-revalidate + speculative prefetch', () => {
    it("keeps the previous puzzle displayed while the next selection's body is still loading (SWR), and never flips status back to loading mid-session", async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

      const { result } = renderHook(() => useTraceSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      const firstPuzzleId = result.current.puzzle?.id
      if (!firstPuzzleId) throw new Error('expected a puzzle to be served')

      // Intercepts exactly the next getPuzzleBody call (the one serveNext's
      // real selection triggers below) with a promise this test controls.
      let resolveBody: (() => void) | undefined
      vi.mocked(getPuzzleBody).mockImplementationOnce(
        (id: string) =>
          new Promise((resolve) => {
            resolveBody = () => {
              resolve(FIXTURE_BODY_BY_ID.get(id))
            }
          }),
      )

      answerAllCheckpoints(result, true)
      act(() => {
        result.current.handleContinue()
      })

      // Selection is synchronous — a new id was picked — but the body
      // hasn't resolved, so the DISPLAYED puzzle is still the previous one.
      expect(result.current.puzzle?.id).toBe(firstPuzzleId)
      expect(result.current.status).toBe('ready')

      resolveBody?.()
      await waitFor(() => {
        expect(result.current.puzzle?.id).not.toBe(firstPuzzleId)
      })
      expect(result.current.status).toBe('ready')

      randomSpy.mockRestore()
    })

    it('handleCheckpointAnswered speculatively prefetches candidate body/bodies for the likely next puzzle, once the final checkpoint lands', async () => {
      const { result } = renderHook(() => useTraceSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      const callsBefore = vi.mocked(getPuzzleBody).mock.calls.length
      answerAllCheckpoints(result, true)

      // No handleContinue call anywhere above — the prefetch fires purely
      // off the puzzle's final checkpoint landing.
      expect(vi.mocked(getPuzzleBody).mock.calls.length).toBeGreaterThan(callsBefore)
    })

    it('does not re-fetch a body that was already prefetched, once that same id becomes the real next selection', async () => {
      // Narrows the pool to exactly one puzzle — with only one eligible
      // candidate, every speculative draw AND the real next selectNext call
      // are guaranteed to land on that same id (selection.ts's own
      // no-repeat-within-window soft-preference falls back to the full
      // eligible set once it would otherwise go empty), making this
      // deterministic without controlling the speculative draws' internal
      // throwaway rng directly. Restored in `finally` so later tests in
      // this file (if any ran after, and re-runs of this same suite) still
      // see the full 12-puzzle fixture.
      const originalMeta = [...FIXTURE_PUZZLE_META]
      const onlyEntry = originalMeta[0]
      if (!onlyEntry) throw new Error('expected at least one fixture puzzleMeta entry')
      FIXTURE_PUZZLE_META.length = 0
      FIXTURE_PUZZLE_META.push(onlyEntry)

      try {
        const { result } = renderHook(() => useTraceSession())
        await waitFor(() => {
          expect(result.current.status).toBe('ready')
        })
        expect(result.current.puzzle?.id).toBe(onlyEntry.id)

        vi.mocked(getPuzzleBody).mockClear()

        answerAllCheckpoints(result, true)
        // The prefetch may internally call loadPuzzleBody(onlyEntry.id) more
        // than once (3 speculative draws, all landing on the same sole
        // candidate) — the shared cache is what collapses those into at
        // most one real getPuzzleBody call.
        expect(vi.mocked(getPuzzleBody).mock.calls.length).toBeLessThanOrEqual(1)
        const callsAfterPrefetch = vi.mocked(getPuzzleBody).mock.calls.length

        act(() => {
          result.current.handleContinue()
        })

        // The real selection landed on the exact id already prefetched —
        // getPuzzleBody must not have been called again.
        expect(vi.mocked(getPuzzleBody).mock.calls.length).toBe(callsAfterPrefetch)

        await waitFor(() => {
          expect(result.current.puzzle?.id).toBe(onlyEntry.id)
        })
      } finally {
        FIXTURE_PUZZLE_META.length = 0
        FIXTURE_PUZZLE_META.push(...originalMeta)
      }
    })
  })
})
