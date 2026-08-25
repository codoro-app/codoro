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
      // Narrows the pool to exactly two puzzles (s0, s1) — see the "does not
      // re-fetch" test below for the full rationale of this technique.
      // Needed here too (fix-round finding #4): `answerAllCheckpoints` fires
      // `handleCheckpointAnswered`'s own post-answer prefetch, which — over
      // the full 12-puzzle pool — competes with the real `handleContinue`
      // fetch for whichever `getPuzzleBody` call `mockImplementationOnce`
      // happens to intercept next; the original version of this test
      // installed that once-mock BEFORE `answerAllCheckpoints`, so it was
      // very likely consumed by a SPECULATIVE draw's fetch instead of the
      // real one, and only "passed" because no `await` intervened to flush
      // microtasks — not because SWR actually held the real fetch pending.
      // Keying the mock by id (s1 specifically) instead of by call order
      // means it doesn't matter whether the prefetch or the real selection
      // requests s1 first — the shared cache means there's only ever ONE
      // real fetch for it either way, and this test controls exactly that
      // one.
      const originalMeta = [...FIXTURE_PUZZLE_META]
      const s0 = originalMeta[0]
      const s1 = originalMeta[1]
      if (!s0 || !s1) throw new Error('expected at least two fixture puzzleMeta entries')
      FIXTURE_PUZZLE_META.length = 0
      FIXTURE_PUZZLE_META.push(s0, s1)

      try {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

        let resolveS1: (() => void) | undefined
        const pendingS1 = new Promise<Puzzle | undefined>((resolve) => {
          resolveS1 = () => {
            resolve(FIXTURE_BODY_BY_ID.get(s1.id))
          }
        })
        vi.mocked(getPuzzleBody).mockImplementation((id: string) =>
          id === s1.id ? pendingS1 : Promise.resolve(FIXTURE_BODY_BY_ID.get(id)),
        )

        const { result } = renderHook(() => useTraceSession())
        await waitFor(() => {
          expect(result.current.status).toBe('ready')
        })
        // rng=0 -> index 0 of the 2-item pool on the first (cold-boot) draw,
        // where nothing is excluded yet.
        expect(result.current.puzzle?.id).toBe(s0.id)

        // Answering s0 fires the post-answer prefetch, which — with only s1
        // left once s0 is excluded via recentIds — requests s1's body
        // (held pending by the id-keyed mock above).
        answerAllCheckpoints(result, true)
        act(() => {
          result.current.handleContinue()
        })

        // The real selection also lands on s1 (the only eligible-not-recent
        // candidate — deterministic regardless of rng once only one
        // candidate remains) and shares the SAME held-pending promise via
        // the cache, so it hasn't resolved either.
        expect(result.current.puzzle?.id).toBe(s0.id)
        expect(result.current.status).toBe('ready')

        resolveS1?.()
        await waitFor(() => {
          expect(result.current.puzzle?.id).toBe(s1.id)
        })
        expect(result.current.status).toBe('ready')

        randomSpy.mockRestore()
      } finally {
        FIXTURE_PUZZLE_META.length = 0
        FIXTURE_PUZZLE_META.push(...originalMeta)
        // Restores the module-wide default implementation — the
        // `mockImplementation` override above (not `mockImplementationOnce`)
        // would otherwise persist into later tests in this file, where a
        // cold-boot selection landing on this test's own `s1.id` (a real id
        // from the shared 12-puzzle fixture) would hang forever on the
        // never-resolved `pendingS1` promise instead of resolving normally.
        vi.mocked(getPuzzleBody).mockImplementation((id: string) =>
          Promise.resolve(FIXTURE_BODY_BY_ID.get(id)),
        )
      }
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
      // Narrows the pool to exactly two puzzles (s0, s1) — fix-round finding
      // #3: a single-entry pool made this test vacuous, because the
      // "prefetched" id and the "already displayed/cached" id were
      // necessarily the SAME one (there was nothing else to prefetch), so 0
      // real getPuzzleBody calls satisfied `toBeLessThanOrEqual(1)` just as
      // well as 1 did — it couldn't tell "dedup worked" apart from
      // "prefetch never ran." With two entries, s0 is served (and cached)
      // first; s1 is a genuinely distinct, not-yet-cached candidate that
      // recentIds deterministically excludes s0 in favour of (both for the
      // prefetch AND the subsequent real selectNext call, once s0 is
      // recent) — see traceRecentIdsWindow(2) === 1.
      const originalMeta = [...FIXTURE_PUZZLE_META]
      const s0 = originalMeta[0]
      const s1 = originalMeta[1]
      if (!s0 || !s1) throw new Error('expected at least two fixture puzzleMeta entries')
      FIXTURE_PUZZLE_META.length = 0
      FIXTURE_PUZZLE_META.push(s0, s1)

      try {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

        const { result } = renderHook(() => useTraceSession())
        await waitFor(() => {
          expect(result.current.status).toBe('ready')
        })
        expect(result.current.puzzle?.id).toBe(s0.id)
        randomSpy.mockRestore()

        vi.mocked(getPuzzleBody).mockClear()

        answerAllCheckpoints(result, true)
        // The prefetch fires against s1 — the one candidate NOT already
        // displayed/cached — exactly once, regardless of how many of the 3
        // speculative draws land on it.
        expect(vi.mocked(getPuzzleBody).mock.calls.length).toBe(1)
        expect(getPuzzleBody).toHaveBeenCalledWith(s1.id)

        act(() => {
          result.current.handleContinue()
        })

        // The real selection deterministically lands on s1 too (the only
        // eligible-not-recent candidate) — getPuzzleBody must not have been
        // called again for it.
        expect(vi.mocked(getPuzzleBody).mock.calls.length).toBe(1)

        await waitFor(() => {
          expect(result.current.puzzle?.id).toBe(s1.id)
        })
      } finally {
        FIXTURE_PUZZLE_META.length = 0
        FIXTURE_PUZZLE_META.push(...originalMeta)
      }
    })
  })

  describe('content-metadata-lazy-load Task 5 fix round: cold-boot body-fetch failure + empty-pool token ordering', () => {
    it('a rejected getPuzzleBody on cold boot transitions to error (not a stuck skeleton), reports via trackError, and retryLoad recovers', async () => {
      vi.mocked(getPuzzleBody).mockRejectedValueOnce(new Error('dynamic import failed'))

      const { result } = renderHook(() => useTraceSession())

      expect(result.current.status).toBe('loading')
      await waitFor(() => {
        expect(result.current.status).toBe('error')
      })
      expect(trackError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('serveNext body fetch failed'),
      )
      expect(result.current.puzzle).toBeNull()

      act(() => {
        result.current.retryLoad()
      })
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      expect(result.current.puzzle).not.toBeNull()
    })

    it('getPuzzleBody resolving undefined (unknown id) on cold boot also transitions to error, not a stuck skeleton', async () => {
      vi.mocked(getPuzzleBody).mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useTraceSession())
      await waitFor(() => {
        expect(result.current.status).toBe('error')
      })
      expect(trackError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('serveNext body lookup miss'),
      )
      expect(result.current.puzzle).toBeNull()
    })

    it('a mid-session getPuzzleBody rejection keeps the stale puzzle displayed instead of clearing it (SWR survives a failed refresh)', async () => {
      // Narrows the pool to exactly two puzzles and rejects by id, not by
      // call order — same reasoning as this file's SWR test above (a
      // `mockRejectedValueOnce` here was consumed by
      // `handleCheckpointAnswered`'s own post-answer prefetch fetch instead
      // of the real `handleContinue` fetch it was meant to fail, so the
      // real fetch quietly succeeded on the default mock and the
      // `trackError` wait below timed out — the prefetch's own rejection
      // handler swallows it silently, by design).
      const originalMeta = [...FIXTURE_PUZZLE_META]
      const s0 = originalMeta[0]
      const s1 = originalMeta[1]
      if (!s0 || !s1) throw new Error('expected at least two fixture puzzleMeta entries')
      FIXTURE_PUZZLE_META.length = 0
      FIXTURE_PUZZLE_META.push(s0, s1)

      try {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

        const { result } = renderHook(() => useTraceSession())
        await waitFor(() => {
          expect(result.current.status).toBe('ready')
        })
        expect(result.current.puzzle?.id).toBe(s0.id)
        randomSpy.mockRestore()

        const rejectionError = new Error('offline')
        vi.mocked(getPuzzleBody).mockImplementation((id: string) =>
          id === s1.id
            ? Promise.reject(rejectionError)
            : Promise.resolve(FIXTURE_BODY_BY_ID.get(id)),
        )

        answerAllCheckpoints(result, true)
        act(() => {
          result.current.handleContinue()
        })

        await waitFor(() => {
          expect(trackError).toHaveBeenCalledWith(
            rejectionError,
            expect.stringContaining('serveNext body fetch failed'),
          )
        })
        expect(result.current.puzzle?.id).toBe(s0.id)
        expect(result.current.status).toBe('ready')
      } finally {
        FIXTURE_PUZZLE_META.length = 0
        FIXTURE_PUZZLE_META.push(...originalMeta)
        vi.mocked(getPuzzleBody).mockImplementation((id: string) =>
          Promise.resolve(FIXTURE_BODY_BY_ID.get(id)),
        )
      }
    })

    it('an empty-pool result wins over a still-in-flight earlier fetch (selection token bumped before the early return)', async () => {
      // Fix-round finding #2 — see usePracticeSession.test.ts's identical
      // test for the full rationale. Trace has no filter setters, so the
      // "second serveNext call with an empty pool" here is driven by
      // emptying the shared FIXTURE_PUZZLE_META array and calling
      // `retryLoad` a second time while the first (cold-boot) fetch is
      // still pending — `retryLoad` has no guard against being called while
      // already loading.
      let resolveFirstBody: (() => void) | undefined
      vi.mocked(getPuzzleBody).mockImplementationOnce(
        (id: string) =>
          new Promise((resolve) => {
            resolveFirstBody = () => {
              resolve(FIXTURE_BODY_BY_ID.get(id))
            }
          }),
      )

      const { result } = renderHook(() => useTraceSession())
      await waitFor(() => {
        expect(result.current.profile).not.toBeNull()
      })
      expect(result.current.status).toBe('loading')

      const originalMeta = [...FIXTURE_PUZZLE_META]
      FIXTURE_PUZZLE_META.length = 0
      try {
        act(() => {
          result.current.retryLoad()
        })
        await waitFor(() => {
          expect(result.current.status).toBe('empty')
        })
        expect(result.current.puzzle).toBeNull()

        // Resolving the now-superseded first fetch must be a no-op.
        resolveFirstBody?.()
        await act(async () => {
          await Promise.resolve()
          await Promise.resolve()
        })

        expect(result.current.status).toBe('empty')
        expect(result.current.puzzle).toBeNull()
      } finally {
        FIXTURE_PUZZLE_META.length = 0
        FIXTURE_PUZZLE_META.push(...originalMeta)
      }
    })
  })
})
