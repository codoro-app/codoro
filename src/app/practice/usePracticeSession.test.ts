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
  FIXTURE_TAP_ID,
  FIXTURE_TAP_ID_2,
  FIXTURE_POOL_WITH_MIXED_INTERACTIONS,
  FIXTURE_PUZZLE_META,
  FIXTURE_BODY_BY_ID,
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
    correct_verdict: 'bug',
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
  // A second tap-line puzzle — fix-round finding #3: the "no duplicate
  // fetch" test needs a candidate that is NEITHER the currently-displayed
  // puzzle NOR already cached before the assertion window, which a
  // single-tap-line-fixture pool can't provide (narrowing to it makes the
  // "prefetched" id and the "already displayed" id the same one, so the
  // dupe-avoidance assertion passes on 0 real fetches just as well as on 1).
  // With two tap-line fixtures, narrowing to `interaction: 'tap-line'`
  // yields exactly one OTHER candidate once the currently-displayed one is
  // excluded via recentIds — deterministic without controlling the
  // speculative draws' internal rng.
  const tapId2 = 'p-tap-1'
  const tapLineFixture2 = {
    id: tapId2,
    pattern: 'null-undefined',
    difficulty_rating: 2310,
    explanation: 'explanation tap 2',
    prompt: 'prompt tap 2',
    language: 'javascript',
    snippet: 'let i = 1',
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
    FIXTURE_TAP_ID: tapId,
    FIXTURE_TAP_ID_2: tapId2,
    // Prepended, not appended: with rng mocked to 0 (see the test below),
    // selection.ts's sample() picks index 0 of the eligible/not-recent
    // candidate list, which preserves pool order — so if the source under
    // test reads `puzzlePool` (this array) instead of `quizPool` (`pool`,
    // scrubber-free), it deterministically serves the scrubber puzzle on
    // the very first draw, every run. An appended scrubber entry would
    // never be picked at index 0 regardless of which pool is read, making
    // the assertion vacuous.
    FIXTURE_POOL_WITH_SCRUBBER: [scrubberPuzzle, ...pool],
    FIXTURE_POOL_WITH_MIXED_INTERACTIONS: [
      ...pool,
      swipeBinaryFixture,
      tapLineFixture,
      tapLineFixture2,
    ],
    // content-metadata-lazy-load Task 5: usePracticeSession now selects from
    // `puzzleMeta` (metadata for the WHOLE catalog, scrubber included — its
    // own internal filter is what excludes scrubber, not a separate
    // scrubber-free export) and loads bodies via `getPuzzleBody`. This is
    // the metadata-only projection of every fixture puzzle across this
    // file — scrubber kept at index 0, same placement/reasoning as the old
    // FIXTURE_POOL_WITH_SCRUBBER above, so the P0 regression test below is
    // still a hard deterministic catch (rng mocked to 0) if the hook's own
    // `interaction !== 'scrubber'` filter were ever dropped.
    FIXTURE_PUZZLE_META: [
      scrubberPuzzle,
      ...pool,
      swipeBinaryFixture,
      tapLineFixture,
      tapLineFixture2,
    ].map((p) => ({
      id: p.id,
      pattern: p.pattern,
      difficulty_rating: p.difficulty_rating,
      interaction: p.interaction,
    })),
    FIXTURE_BODY_BY_ID: new Map(
      [scrubberPuzzle, ...pool, swipeBinaryFixture, tapLineFixture, tapLineFixture2].map((p) => [
        p.id,
        p,
      ]),
    ),
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
    // The two the hook actually reads now (content-metadata-lazy-load Task
    // 5) — selection runs over `puzzleMeta`, bodies resolve via
    // `getPuzzleBody`. `puzzlePool`/`quizPool` above are left mocked too
    // (harmless, unread by the hook itself) so any other module transitively
    // importing this same mocked '../../content' isn't left half-real.
    puzzleMeta: FIXTURE_PUZZLE_META,
    // Derived exports must be re-derived from the SAME fixture, not left
    // real: the hook selects from `quizMeta`, so an un-mocked one would hand
    // it real puzzle ids that FIXTURE_BODY_BY_ID below can't resolve.
    quizMeta: FIXTURE_PUZZLE_META.filter((meta) => meta.interaction !== 'scrubber'),
    scrubberMeta: FIXTURE_PUZZLE_META.filter((meta) => meta.interaction === 'scrubber'),
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
    listAttempts: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({
  trackPracticeAttempt: vi.fn(),
  trackComboShieldUsed: vi.fn(),
  trackStreakPause: vi.fn(),
  trackError: vi.fn(),
}))

// Imported after the mocks above so we get the mocked bindings.
const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { trackPracticeAttempt, trackComboShieldUsed, trackStreakPause, trackError } =
  await import('../../telemetry')
const { getPuzzleBody } = await import('../../content')
const { resetPuzzleBodyCacheForTests } = await import('./puzzleBodyCache')

describe('usePracticeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    // The shared puzzleBodyCache is a module-level singleton — Vitest
    // isolates modules per test FILE, not per `it()` within one, so without
    // this a call-count assertion in one test could be silently satisfied by
    // a promise this same cache resolved during an earlier test.
    resetPuzzleBodyCacheForTests()
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
    expect(trackPracticeAttempt).toHaveBeenCalledWith(
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

  it('accumulates correct answers into streakAttempts and clears them on a miss', async () => {
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    const firstPuzzleId = result.current.puzzle?.id
    if (!firstPuzzleId) throw new Error('expected a puzzle to be served')

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    expect(result.current.streakAttempts).toHaveLength(1)
    expect(result.current.streakAttempts[0]).toEqual({
      puzzleId: firstPuzzleId,
      correct: true,
      time_ms: expect.any(Number) as number,
    })

    act(() => {
      result.current.handleContinue()
    })
    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    expect(result.current.streakAttempts).toHaveLength(2)

    // A miss clears the live streak's attempts — the challenge link always
    // encodes the current streak, never a broken one.
    act(() => {
      result.current.handleContinue()
    })
    act(() => {
      result.current.handleAnswered({ correct: false, choiceIndex: 1 })
    })
    expect(result.current.streakAttempts).toHaveLength(0)
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

    // The puzzle body for this final selection resolves asynchronously
    // (content-metadata-lazy-load Task 5) — stale-while-revalidate keeps
    // showing whatever was displayed before until it does.
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe(missedId)
    })
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
    // Body resolves asynchronously — SWR keeps the old puzzle displayed
    // until it does.
    await waitFor(() => {
      expect(result.current.puzzle?.pattern).toBe('null-undefined')
    })
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

    await waitFor(() => {
      expect(result.current.puzzle?.id).not.toBe(onScreenPuzzle.id)
    })

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
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe(FIXTURE_SWIPE_ID)
    })
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

    await waitFor(() => {
      expect(result.current.puzzle?.id).not.toBe(onScreenPuzzle.id)
    })

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
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe(FIXTURE_SWIPE_ID)
    })
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

    await waitFor(() => {
      expect(result.current.puzzle?.id).not.toBe(onScreenPuzzle.id)
    })

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
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe(FIXTURE_SWIPE_ID)
    })

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

  describe('combo/shield economy (feel.ts)', () => {
    it('a correct answer increments combo and shields stay at 0 below the first surge', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      expect(result.current.combo).toBe(1)
      expect(result.current.shields).toBe(0)
      expect(result.current.lastOutcome).toMatchObject({ kind: 'correct', newCombo: 1 })
    })

    it('a surge crossing (novice, combo step 3) banks a shield and fires streak_pause with tier + shields_banked', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      act(() => {
        result.current.handleContinue()
      })
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      act(() => {
        result.current.handleContinue()
      })
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 }) // combo -> 3, novice surge
      })

      expect(result.current.combo).toBe(3)
      expect(result.current.shields).toBe(1)
      expect(trackStreakPause).toHaveBeenCalledWith({
        mode: 'practice',
        streak: 3,
        is_new_best: true,
        tier: 'novice',
        shields_banked: 1,
      })
      expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ bestRunStreak: 3 }))
    })

    it('a wrong answer with a banked shield is shielded: combo holds, streakAttempts is untouched, a shield is spent', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      // Bank one shield first (3 correct in a row, novice).
      for (let i = 0; i < 3; i++) {
        act(() => {
          result.current.handleAnswered({ correct: true, choiceIndex: 0 })
        })
        if (i < 2) {
          act(() => {
            result.current.handleContinue()
          })
        }
      }
      expect(result.current.shields).toBe(1)
      const streakAttemptsBeforeMiss = result.current.streakAttempts

      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 })
      })

      expect(result.current.combo).toBe(3) // held, not reset
      expect(result.current.shields).toBe(0) // spent
      expect(result.current.streakAttempts).toEqual(streakAttemptsBeforeMiss) // untouched
      expect(result.current.lastOutcome).toMatchObject({
        kind: 'shielded',
        newCombo: 3,
        newShields: 0,
      })
      expect(trackComboShieldUsed).toHaveBeenCalledWith({
        tier: 'novice',
        combo: 3,
        shields_remaining: 0,
      })
    })

    it('a wrong answer with no shield resets combo, shields, and streakAttempts', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 })
      })

      expect(result.current.combo).toBe(0)
      expect(result.current.shields).toBe(0)
      expect(result.current.streakAttempts).toHaveLength(0)
      expect(result.current.lastOutcome).toMatchObject({ kind: 'wrong' })
    })
  })

  describe('content-metadata-lazy-load Task 5: stale-while-revalidate + speculative prefetch', () => {
    it("keeps the previous puzzle displayed while the next selection's body is still loading (stale-while-revalidate), and never flips status back to loading mid-session", async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      const firstPuzzleId = result.current.puzzle?.id
      if (!firstPuzzleId) throw new Error('expected a puzzle to be served')

      // Intercepts exactly the next getPuzzleBody call (the one serveNext's
      // real selection triggers below) with a promise this test controls —
      // proves the old puzzle stays on screen for as long as that promise
      // stays pending, not just "eventually."
      let resolveBody: (() => void) | undefined
      vi.mocked(getPuzzleBody).mockImplementationOnce(
        (id: string) =>
          new Promise((resolve) => {
            resolveBody = () => {
              resolve(FIXTURE_BODY_BY_ID.get(id))
            }
          }),
      )

      act(() => {
        result.current.handleContinue()
      })

      // Selection itself is synchronous — a new id was picked and the
      // requeue ladder already advanced — but the body hasn't resolved, so
      // the DISPLAYED puzzle is still the previous one.
      expect(result.current.puzzle?.id).toBe(firstPuzzleId)
      expect(result.current.status).toBe('ready')

      resolveBody?.()
      await waitFor(() => {
        expect(result.current.puzzle?.id).not.toBe(firstPuzzleId)
      })
      expect(result.current.status).toBe('ready')

      randomSpy.mockRestore()
    })

    it('handleAnswered speculatively prefetches candidate body/bodies for the likely next puzzle, before Continue is ever pressed', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      const callsBeforeAnswer = vi.mocked(getPuzzleBody).mock.calls.length

      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })

      // No handleContinue call anywhere above — the prefetch fires purely
      // off the answer itself.
      expect(vi.mocked(getPuzzleBody).mock.calls.length).toBeGreaterThan(callsBeforeAnswer)
    })

    it('does not re-fetch a body that was already prefetched, once that same id becomes the real next selection', async () => {
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      // Narrows the pool to exactly the two tap-line fixtures — with the
      // filter switch itself already landing on FIXTURE_TAP_ID (below), the
      // ONLY other eligible-and-not-recent candidate for both the
      // speculative prefetch and the subsequent real selectNext call is
      // FIXTURE_TAP_ID_2 (selection.ts's no-repeat-within-window exclusion —
      // see pickFromWindow's doc comment). Fix-round finding #3: a
      // single-candidate pool made this test vacuous — the "prefetched" id
      // and the "already displayed/cached" id were the same one, so 0 real
      // getPuzzleBody calls satisfied `toBeLessThanOrEqual(1)` just as well
      // as 1 did, and couldn't distinguish "dedup worked" from "prefetch
      // never ran." With a genuinely distinct second candidate, the
      // assertions below are exact (`toBe(1)`/`toBe(0)`), not permissive.
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
      act(() => {
        result.current.setInteractionFilter('tap-line')
      })
      await waitFor(() => {
        expect(result.current.puzzle?.id).toBe(FIXTURE_TAP_ID)
      })
      randomSpy.mockRestore()

      vi.mocked(getPuzzleBody).mockClear()

      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      // The prefetch fires against FIXTURE_TAP_ID_2 — the one candidate NOT
      // already displayed/cached — exactly once, regardless of how many of
      // the 3 speculative draws land on it (the shared cache collapses
      // repeats into a single real fetch).
      expect(vi.mocked(getPuzzleBody).mock.calls.length).toBe(1)
      expect(getPuzzleBody).toHaveBeenCalledWith(FIXTURE_TAP_ID_2)

      act(() => {
        result.current.handleContinue()
      })

      // The real selection deterministically lands on FIXTURE_TAP_ID_2 too
      // (the only eligible-not-recent candidate) — getPuzzleBody must not
      // have been called again for it.
      expect(vi.mocked(getPuzzleBody).mock.calls.length).toBe(1)

      await waitFor(() => {
        expect(result.current.puzzle?.id).toBe(FIXTURE_TAP_ID_2)
      })
    })
  })

  describe('content-metadata-lazy-load Task 5 fix round: cold-boot body-fetch failure + empty-pool token ordering', () => {
    it('a rejected getPuzzleBody on cold boot transitions to error (not a stuck skeleton), reports via trackError, and retryLoad recovers', async () => {
      vi.mocked(getPuzzleBody).mockRejectedValueOnce(new Error('dynamic import failed'))

      const { result } = renderHook(() => usePracticeSession())

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

      const { result } = renderHook(() => usePracticeSession())
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
      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      const staleId = result.current.puzzle?.id
      if (!staleId) throw new Error('expected a puzzle to be served')

      vi.mocked(getPuzzleBody).mockRejectedValueOnce(new Error('offline'))

      act(() => {
        result.current.handleContinue()
      })

      await waitFor(() => {
        expect(trackError).toHaveBeenCalledWith(
          expect.any(Error),
          expect.stringContaining('serveNext body fetch failed'),
        )
      })
      expect(result.current.puzzle?.id).toBe(staleId)
      expect(result.current.status).toBe('ready')
    })

    it('an empty-pool result wins over a still-in-flight earlier fetch (selection token bumped before the early return)', async () => {
      // Fix-round finding #2: without bumping selectionTokenRef before the
      // `result === null` early return, a still-pending fetch from an
      // EARLIER selection kept a token that still matched, so resolving it
      // after this empty result would silently overwrite 'empty' with a
      // stale puzzle + 'ready'.
      let resolveFirstBody: (() => void) | undefined
      vi.mocked(getPuzzleBody).mockImplementationOnce(
        (id: string) =>
          new Promise((resolve) => {
            resolveFirstBody = () => {
              resolve(FIXTURE_BODY_BY_ID.get(id))
            }
          }),
      )

      const { result } = renderHook(() => usePracticeSession())
      await waitFor(() => {
        expect(result.current.profile).not.toBeNull()
      })
      // The cold-boot body fetch above is still pending — status hasn't
      // resolved to 'ready' yet.
      expect(result.current.status).toBe('loading')

      // A pattern+interaction combination with zero matches in the fixture
      // pool — a real, reachable path (PracticePage applies
      // ?pattern=&interaction= from the URL as soon as profile is available,
      // which can race an in-flight cold-boot fetch exactly like this).
      act(() => {
        result.current.setFilters('resource-management', 'drag-order')
      })
      expect(result.current.status).toBe('empty')
      expect(result.current.puzzle).toBeNull()

      // Resolving the now-superseded first fetch must be a no-op.
      resolveFirstBody?.()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.current.status).toBe('empty')
      expect(result.current.puzzle).toBeNull()
    })
  })
})
