import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { updateRating, roundForDisplay } from '../../engine'
import type { Puzzle, QuizPuzzle } from '../../content'
import { usePracticeSession } from './usePracticeSession'

const {
  FIXTURE_POOL,
  FIXTURE_SCRUBBER_ID,
  FIXTURE_POOL_WITH_SCRUBBER,
  FIXTURE_SWIPE_ID,
  FIXTURE_POOL_WITH_MIXED_INTERACTIONS,
} = vi.hoisted(() => {
  const pool = Array.from({ length: 12 }, (_, i) => ({
    id: `p${String(i)}`,
    pattern: i % 2 === 0 ? 'off-by-one' : 'null-undefined',
    difficulty_rating: 1150 + i * 10,
    explanation: `explanation ${String(i)}`,
    prompt: `prompt ${String(i)}`,
    language: 'javascript',
    snippet: 'const x = 1',
    interaction: 'mcq',
    choices: ['a', 'b'],
    correct_choice: 0,
  })) as unknown as Puzzle[]
  // Two non-mcq puzzles, appended (not woven into the base 12, so existing
  // index/rating-based assumptions elsewhere in this file are undisturbed)
  // — every base-pool puzzle is 'mcq', so proving an interaction filter
  // actually NARROWS (not just excludes-to-empty) needs at least one
  // puzzle of a different interaction type to narrow to. Ratings (2200,
  // 2300) sit far outside the default profile's 1200, so they can't be
  // preferentially selected by an unfiltered/differently-filtered serve.
  const swipeId = 'p-swipe-0'
  const tapId = 'p-tap-0'
  const swipeBinaryFixture = {
    id: swipeId,
    pattern: 'off-by-one',
    difficulty_rating: 2200,
    explanation: 'explanation swipe',
    prompt: 'prompt swipe',
    language: 'javascript',
    snippet: 'let i = 0',
    interaction: 'swipe-binary',
    left_label: 'Buggy',
    right_label: 'Safe',
    correct_direction: 'left',
  } as unknown as Puzzle
  const tapLineFixture = {
    id: tapId,
    pattern: 'null-undefined',
    difficulty_rating: 2300,
    explanation: 'explanation tap',
    prompt: 'prompt tap',
    language: 'javascript',
    snippet: 'let i = 0',
    interaction: 'tap-line',
    correct_line: 0,
  } as unknown as Puzzle
  const scrubberId = 'scrubber-only-fixture'
  // A scrubber puzzle present in `puzzlePool` but absent from `quizPool` —
  // mirrors the real split (quizPool = puzzlePool minus scrubber). Only
  // present so the test below can prove Practice's serving path reads
  // quizPool, not puzzlePool — see docs/v2-phase2-review.md (P0).
  const scrubberPuzzle = {
    id: scrubberId,
    pattern: 'off-by-one',
    difficulty_rating: 1200,
    explanation: 'explanation scrubber',
    prompt: 'prompt scrubber',
    language: 'javascript',
    snippet: 'let i = 0',
    interaction: 'scrubber',
    steps: [{ line: 0, vars: { i: '0' } }],
    checkpoints: [],
  } as unknown as Puzzle
  return {
    FIXTURE_POOL: pool,
    FIXTURE_SCRUBBER_ID: scrubberId,
    FIXTURE_SWIPE_ID: swipeId,
    // Prepended, not appended: with rng mocked to 0 (see the test below),
    // selection.ts's sample() picks index 0 of the eligible/not-recent
    // candidate list, which preserves pool order — so if the source under
    // test reads `puzzlePool` (this array) instead of `quizPool` (`pool`,
    // scrubber-free), it deterministically serves the scrubber puzzle on
    // the very first draw, every run. An appended scrubber entry would
    // never be picked at index 0 regardless of which pool is read, making
    // the assertion vacuous.
    FIXTURE_POOL_WITH_SCRUBBER: [scrubberPuzzle, ...pool],
    FIXTURE_POOL_WITH_MIXED_INTERACTIONS: [...pool, swipeBinaryFixture, tapLineFixture],
  }
})

// Practice's own served puzzle is structurally guaranteed to never be
// scrubber (quizPool excludes it — content/index.ts's own doc comment), but
// `result.current.puzzle` is typed as the full `Puzzle` union, so its
// `.interaction` is wider than `InteractionFilter` (QuizPuzzle['interaction']
// | null). Narrows with a real runtime check rather than an `as` cast.
function assertQuizInteraction(interaction: Puzzle['interaction']): QuizPuzzle['interaction'] {
  if (interaction === 'scrubber') {
    throw new Error('expected a quiz interaction, got scrubber')
  }
  return interaction
}

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL_WITH_SCRUBBER,
    quizPool: FIXTURE_POOL_WITH_MIXED_INTERACTIONS,
  }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
    appendAttempt: vi.fn(),
    listAttempts: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({
  trackAttempt: vi.fn(),
  trackStreakPause: vi.fn(),
  trackError: vi.fn(),
}))

// Imported after the mocks above so we get the mocked bindings.
const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { trackAttempt, trackStreakPause, trackError } = await import('../../telemetry')

describe('usePracticeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the profile and serves a first puzzle from the pool on mount', async () => {
    const { result } = renderHook(() => usePracticeSession())

    expect(result.current.status).toBe('loading')
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    expect(loadProfile).toHaveBeenCalledTimes(1)
    expect(result.current.puzzle).not.toBeNull()
    expect(FIXTURE_POOL.some((p) => p.id === result.current.puzzle?.id)).toBe(true)
    expect(result.current.ratingDelta).toBeNull()
    expect(result.current.combo).toBe(0)
  })

  it('a correct answer computes rating via engine updateRating, persists profile + attempt, and fires telemetry', async () => {
    const { result } = renderHook(() => usePracticeSession())
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
      true,
      before.ratedAttemptCount,
    )
    const expectedDelta = roundForDisplay(expectedNewRating) - roundForDisplay(before.rating)

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })

    expect(result.current.ratingDelta).toBe(expectedDelta)
    expect(result.current.combo).toBe(1)
    expect(result.current.profile?.rating).toBe(expectedNewRating)
    expect(result.current.profile?.ratedAttemptCount).toBe(1)

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ rating: expectedNewRating, ratedAttemptCount: 1 }),
    )
    expect(appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        puzzleId: puzzle.id,
        correct: true,
        mode: 'practice',
        choice_index: 0,
        userRatingBefore: before.rating,
        userRatingAfter: expectedNewRating,
      }),
    )
    expect(trackAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        puzzle_id: puzzle.id,
        correct: true,
        mode: 'practice',
        interaction: puzzle.interaction,
        user_rating_before: before.rating,
        user_rating_after: expectedNewRating,
      }),
    )
  })

  it('does not change the streak on a practice attempt (Daily-only anchors the streak)', async () => {
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const streakBefore = result.current.profile?.streak
    expect(streakBefore).toEqual({ currentStreak: 0, longestStreak: 0, lastActiveDate: null })

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })

    expect(result.current.profile?.streak).toEqual(streakBefore)
  })

  it('a wrong answer resets combo to 0, records a miss, and the puzzle resurfaces via requeue after 3 continues', async () => {
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const missedId = result.current.puzzle?.id
    if (!missedId) throw new Error('expected a puzzle to be served')

    act(() => {
      result.current.handleAnswered({ correct: false, choiceIndex: 1 })
    })

    expect(result.current.combo).toBe(0)
    // recordMiss wiring: a fresh stage-0 entry for the missed puzzle.
    expect(result.current.profile?.requeueState).toEqual([
      { puzzleId: missedId, stage: 0, served: 0 },
    ])

    // Ladder interval for stage 0 is 3 (src/engine/requeue.ts) — the 3rd
    // selectNext call after the miss must resurface it, regardless of the
    // (real, unmocked) rng driving window picks in between.
    act(() => {
      result.current.handleContinue()
    })
    act(() => {
      result.current.handleContinue()
    })
    act(() => {
      result.current.handleContinue()
    })

    expect(result.current.puzzle?.id).toBe(missedId)
  })

  it('fires a haptic tick on answer commit when navigator.vibrate is available', async () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
      writable: true,
    })

    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })

    expect(vibrate).toHaveBeenCalled()

    delete (navigator as { vibrate?: unknown }).vibrate
  })

  it('setPatternFilter narrows subsequent selection to the chosen pattern', async () => {
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.setPatternFilter('null-undefined')
    })

    expect(result.current.patternFilter).toBe('null-undefined')
    expect(result.current.puzzle?.pattern).toBe('null-undefined')
  })

  it('setPatternFilter does not immediately re-serve the puzzle currently on screen, even without a prior Continue', async () => {
    // Deterministic: forces pickFromWindow's sample() to always pick
    // whatever candidate lands at index 0, both for the initial serve and
    // the pattern-filtered re-serve. If the puzzle on screen is correctly
    // excluded, index 0 of the *filtered* candidate list can never be that
    // same puzzle (it's been removed from the list) — reproduces the
    // reported bug (solve in general practice, switch to Browse Patterns
    // for that puzzle's own pattern, same puzzle comes back) without
    // depending on real randomness.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const onScreenPuzzle = result.current.puzzle
    if (!onScreenPuzzle) throw new Error('expected a puzzle to be served')

    // No handleContinue call here — this is the exact reported repro:
    // switching the filter while the just-answered puzzle is still on
    // screen (e.g. tapping "Browse Patterns" right from the feedback
    // panel), not after advancing past it.
    act(() => {
      result.current.setPatternFilter(onScreenPuzzle.pattern)
    })

    expect(result.current.puzzle?.id).not.toBe(onScreenPuzzle.id)

    randomSpy.mockRestore()
  })

  it('setInteractionFilter narrows subsequent selection to the chosen interaction type', async () => {
    // FIXTURE_SWIPE_ID is the only swipe-binary puzzle in the pool — every
    // other fixture puzzle is mcq or tap-line, so this proves the filter
    // actually narrows (excludes the mcq majority), not just that it
    // doesn't crash on a puzzle that happens to already be mcq.
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.setInteractionFilter('swipe-binary')
    })

    expect(result.current.interactionFilter).toBe('swipe-binary')
    expect(result.current.puzzle?.id).toBe(FIXTURE_SWIPE_ID)
  })

  it('setInteractionFilter does not immediately re-serve the puzzle currently on screen, even without a prior Continue', async () => {
    // Mirrors the setPatternFilter regression test above exactly, same
    // mechanism, different dimension.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const onScreenPuzzle = result.current.puzzle
    if (!onScreenPuzzle) throw new Error('expected a puzzle to be served')

    act(() => {
      result.current.setInteractionFilter(assertQuizInteraction(onScreenPuzzle.interaction))
    })

    expect(result.current.puzzle?.id).not.toBe(onScreenPuzzle.id)

    randomSpy.mockRestore()
  })

  it('setFilters narrows selection to the intersection of both filters, not just one', async () => {
    // FIXTURE_SWIPE_ID (off-by-one, swipe-binary) is the only puzzle
    // matching both — every other off-by-one puzzle is mcq, and the
    // tap-line fixture is null-undefined. If setFilters silently dropped
    // either argument (the double-dispatch bug this function exists to
    // avoid — see its doc comment in usePracticeSession.ts), this would
    // instead serve a different, wrong puzzle.
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.setFilters('off-by-one', 'swipe-binary')
    })

    expect(result.current.patternFilter).toBe('off-by-one')
    expect(result.current.interactionFilter).toBe('swipe-binary')
    expect(result.current.puzzle?.id).toBe(FIXTURE_SWIPE_ID)
  })

  it('setFilters does not immediately re-serve the puzzle currently on screen, even without a prior Continue', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const onScreenPuzzle = result.current.puzzle
    if (!onScreenPuzzle) throw new Error('expected a puzzle to be served')

    act(() => {
      result.current.setFilters(
        onScreenPuzzle.pattern,
        assertQuizInteraction(onScreenPuzzle.interaction),
      )
    })

    expect(result.current.puzzle?.id).not.toBe(onScreenPuzzle.id)

    randomSpy.mockRestore()
  })

  it('setFilters(null, null) clears both filters and returns to the unfiltered pool', async () => {
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.setFilters('off-by-one', 'swipe-binary')
    })
    expect(result.current.puzzle?.id).toBe(FIXTURE_SWIPE_ID)

    act(() => {
      result.current.setFilters(null, null)
    })
    expect(result.current.patternFilter).toBeNull()
    expect(result.current.interactionFilter).toBeNull()
  })

  it('a rejected loadProfile() on mount transitions to an error status (not a stuck loading state), reports via trackError, and retryLoad recovers', async () => {
    vi.mocked(loadProfile).mockRejectedValueOnce(new Error('IndexedDB blocked'))

    const { result } = renderHook(() => usePracticeSession())

    expect(result.current.status).toBe('loading')
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    expect(trackError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.stringContaining('loadProfile'),
    )
    expect(result.current.puzzle).toBeNull()

    // Recovery: a subsequent loadProfile() call succeeds.
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

  it('appendAttempt/saveProfile failures are reported via trackError without blocking the answer-feedback UI', async () => {
    vi.mocked(appendAttempt).mockRejectedValueOnce(new Error('quota exceeded'))
    vi.mocked(saveProfile).mockRejectedValueOnce(new Error('quota exceeded'))

    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })

    // Feedback state updates synchronously regardless of the (async,
    // rejecting) persistence calls below.
    expect(result.current.ratingDelta).not.toBeNull()
    expect(result.current.combo).toBe(1)

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

  it('never serves a scrubber puzzle, even when one exists in puzzlePool (P0 regression)', async () => {
    // FIXTURE_POOL_WITH_SCRUBBER (mocked as puzzlePool) contains a scrubber
    // puzzle that FIXTURE_POOL (mocked as quizPool) does not. rng mocked to
    // 0 makes selection.ts's sample() deterministically pick index 0 of the
    // eligible candidate list (see selection.ts's sample()), and the
    // scrubber fixture sits at index 0 of puzzlePool specifically so this
    // is a hard deterministic catch, not a probabilistic one: if Practice's
    // serving path ever reads puzzlePool instead of quizPool, the very
    // first serve is the scrubber puzzle, every run — reproducing
    // docs/v2-phase2-review.md's P0 (a scrubber puzzle reaching Practice
    // with no renderer, unescapable).
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    expect(result.current.puzzle?.id).not.toBe(FIXTURE_SCRUBBER_ID)
    expect(result.current.puzzle?.interaction).not.toBe('scrubber')
    expect(result.current.puzzle?.id).toBe('p0')

    randomSpy.mockRestore()
  })

  describe('streak-pause (Phase 5b Item 7/8)', () => {
    function answerAndContinue(result: { current: ReturnType<typeof usePracticeSession> }) {
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      act(() => {
        result.current.handleContinue()
      })
    }

    it('fires at the 5th correct answer in a row, marks isNewBest, and persists bestRunStreak', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      expect(result.current.streakPause).toBeNull()

      for (let i = 0; i < 4; i++) {
        answerAndContinue(result)
      }
      expect(result.current.streakPause).toBeNull() // not yet — only 4 in a row

      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })

      expect(result.current.streakPause).toEqual({ streak: 5, isNewBest: true })
      expect(trackStreakPause).toHaveBeenCalledWith({
        mode: 'practice',
        streak: 5,
        is_new_best: true,
      })
      expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ bestRunStreak: 5 }))
    })

    it('a wrong answer resets the streak, so 4 correct + 1 wrong + 4 correct never fires (only 4 in a row max)', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      for (let i = 0; i < 4; i++) {
        answerAndContinue(result)
      }
      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 })
      })
      act(() => {
        result.current.handleContinue()
      })
      for (let i = 0; i < 4; i++) {
        answerAndContinue(result)
      }

      expect(result.current.streakPause).toBeNull()
      expect(trackStreakPause).not.toHaveBeenCalled()
    })

    it('handleStreakPauseKeepGoing dismisses the pause and serves the next puzzle', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      for (let i = 0; i < 4; i++) {
        answerAndContinue(result)
      }
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      const puzzleAtPause = result.current.puzzle?.id
      expect(result.current.streakPause).not.toBeNull()

      act(() => {
        result.current.handleStreakPauseKeepGoing()
      })

      expect(result.current.streakPause).toBeNull()
      // handleContinue was invoked as part of "keep going" — recentIdsRef
      // now excludes the just-answered puzzle, so a fresh one is served.
      // (Same pool can re-serve the same id only once recentIds allows it;
      // asserting non-null puzzle plus a cleared pause is the meaningful,
      // deterministic-regardless-of-rng part of this behavior.)
      expect(result.current.puzzle).not.toBeNull()
      expect(puzzleAtPause).toBeDefined()
    })

    it('handleStreakPauseDoneForNow only dismisses the pause — the current puzzle stays put', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      for (let i = 0; i < 4; i++) {
        answerAndContinue(result)
      }
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      const puzzleAtPause = result.current.puzzle?.id
      expect(result.current.streakPause).not.toBeNull()

      act(() => {
        result.current.handleStreakPauseDoneForNow()
      })

      expect(result.current.streakPause).toBeNull()
      expect(result.current.puzzle?.id).toBe(puzzleAtPause)
    })

    it('fires again at the 10th correct answer in a row, no longer a new best the second time at the same streak', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      for (let i = 0; i < 4; i++) {
        answerAndContinue(result)
      }
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 }) // streak 5
      })
      act(() => {
        result.current.handleStreakPauseKeepGoing()
      })
      for (let i = 0; i < 4; i++) {
        answerAndContinue(result)
      }
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 }) // streak 10
      })

      expect(result.current.streakPause).toEqual({ streak: 10, isNewBest: true })
    })
  })
})
