import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { updateRating, roundForDisplay, getDailyNumber, getDailyCalendarIndex } from '../../engine'
import type { Puzzle } from '../../content'
import { useDailySession } from './useDailySession'

const { FIXTURE_POOL, FIXTURE_CALENDAR, FIXTURE_BODY_BY_ID } = vi.hoisted(() => {
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

  // The fixture calendar deliberately reorders pool ids (rather than mirroring
  // pool order 1:1) so a test bug that indexes straight into puzzlePool
  // instead of resolving through DAILY_CALENDAR would be caught.
  return {
    FIXTURE_POOL: pool,
    FIXTURE_CALENDAR: [...pool].reverse().map((p) => p.id),
    FIXTURE_BODY_BY_ID: new Map(pool.map((p) => [p.id, p])),
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL,
    quizPool: FIXTURE_POOL,
    DAILY_CALENDAR: FIXTURE_CALENDAR,
    // content-metadata-lazy-load Task 5b: useDailySession now resolves
    // today's id from DAILY_CALENDAR (unchanged) but loads its BODY via
    // getPuzzleBody (through the shared puzzleBodyCache), not a synchronous
    // quizPool.find.
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

vi.mock('../../telemetry', () => ({ trackAttempt: vi.fn(), trackError: vi.fn() }))

// Real implementations by default (`resolveDailyStubPuzzle` needs the real
// DEV_STUB_PUZZLES to return a genuine puzzle) — only `isDevPuzzleModeEnabled`
// is overridden per-test, to exercise the dev-puzzle-mode branch without
// touching localStorage.
vi.mock('../devTools/devPuzzleMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../devTools/devPuzzleMode')>()
  return { ...actual, isDevPuzzleModeEnabled: vi.fn(actual.isDevPuzzleModeEnabled) }
})

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { getPuzzleBody } = await import('../../content')
const { trackError } = await import('../../telemetry')
const { isDevPuzzleModeEnabled } = await import('../devTools/devPuzzleMode')
const { resetPuzzleBodyCacheForTests } = await import('../practice/puzzleBodyCache')

function today(): string {
  const d = new Date()
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function expectedPuzzle(): Puzzle {
  const index = getDailyCalendarIndex(today(), FIXTURE_CALENDAR.length)
  const id = FIXTURE_CALENDAR[index]
  const puzzle = FIXTURE_POOL.find((p) => p.id === id)
  if (!puzzle) throw new Error(`expected a pool puzzle matching calendar entry "${String(id)}"`)
  return puzzle
}

describe('useDailySession', () => {
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

  it("resolves today's puzzle via the curated daily calendar and the correct day number", async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    expect(result.current.puzzle?.id).toBe(expectedPuzzle().id)
    expect(result.current.dayNumber).toBe(getDailyNumber(today()))
    expect(result.current.completedToday).toBe(false)
  })

  it('a first-of-day attempt rates, advances the streak, and sets dailyCompletion', async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const puzzle = expectedPuzzle()
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
    expect(result.current.profile?.rating).toBe(expectedNewRating)
    expect(result.current.profile?.ratedAttemptCount).toBe(1)
    expect(result.current.profile?.streak.currentStreak).toBe(1)
    expect(result.current.profile?.dailyCompletion?.date).toBe(today())
    expect(result.current.profile?.dailyCompletion?.correct).toBe(true)
    expect(result.current.completedToday).toBe(true)
    expect(result.current.challengeAttempt?.puzzleId).toBe(puzzle.id)
    expect(result.current.challengeAttempt?.correct).toBe(true)

    expect(saveProfile).toHaveBeenCalledTimes(1)
    expect(appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'daily', correct: true, userRatingAfter: expectedNewRating }),
    )
  })

  it('a same-day retry after completion does not rate, does not touch the streak, and does not overwrite dailyCompletion', async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    const afterFirst = result.current.profile
    if (!afterFirst) throw new Error('expected a profile after the first attempt')

    act(() => {
      result.current.handleRetry()
    })
    act(() => {
      // Retry answered incorrectly this time — must not flip dailyCompletion.correct.
      result.current.handleAnswered({ correct: false, choiceIndex: 1 })
    })

    expect(result.current.ratingDelta).toBeNull()
    expect(result.current.profile?.rating).toBe(afterFirst.rating)
    expect(result.current.profile?.ratedAttemptCount).toBe(afterFirst.ratedAttemptCount)
    expect(result.current.profile?.streak).toEqual(afterFirst.streak)
    expect(result.current.profile?.dailyCompletion).toEqual(afterFirst.dailyCompletion)
    // The challenge link stays the day's first attempt — a retry never re-seeds it.
    expect(result.current.challengeAttempt?.correct).toBe(true)

    // Both attempts still get appended for telemetry/history purposes.
    expect(appendAttempt).toHaveBeenCalledTimes(2)
    expect(appendAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'daily', correct: false }),
    )
  })

  it('a new calendar day (stale dailyCompletion date) is treated as first-of-day again', async () => {
    const staleProfile = {
      ...createDefaultProfile(),
      dailyCompletion: { date: '2000-01-01', attemptId: 'old', correct: true },
    }
    vi.mocked(loadProfile).mockResolvedValue(staleProfile)

    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.completedToday).toBe(false)

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })

    expect(result.current.ratingDelta).not.toBeNull()
    expect(result.current.profile?.dailyCompletion?.date).toBe(today())
    expect(result.current.profile?.ratedAttemptCount).toBe(1)
  })

  describe('content-metadata-lazy-load Task 5b: async body load + dev-puzzle-mode', () => {
    it("stays 'loading' (cold-boot RouteSkeleton) until today's puzzle body resolves, then flips to ready", async () => {
      let resolveBody: (() => void) | undefined
      vi.mocked(getPuzzleBody).mockImplementationOnce(
        (id: string) =>
          new Promise((resolve) => {
            resolveBody = () => {
              resolve(FIXTURE_BODY_BY_ID.get(id))
            }
          }),
      )

      const { result } = renderHook(() => useDailySession())
      await waitFor(() => {
        expect(result.current.profile).not.toBeNull()
      })
      // The profile has loaded but the body fetch is still pending — Daily
      // has no stale puzzle to fall back on for its one-and-only puzzle, so
      // status must stay 'loading' (DailyPage.tsx renders RouteSkeleton for
      // this, not a bespoke "Loading…" message).
      expect(result.current.status).toBe('loading')
      expect(result.current.puzzle).toBeNull()

      resolveBody?.()
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      expect(result.current.puzzle?.id).toBe(expectedPuzzle().id)
    })

    it('a rejected getPuzzleBody transitions to error and reports via trackError', async () => {
      vi.mocked(getPuzzleBody).mockRejectedValueOnce(new Error('dynamic import failed'))

      const { result } = renderHook(() => useDailySession())
      await waitFor(() => {
        expect(result.current.status).toBe('error')
      })
      expect(trackError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('puzzle body fetch failed'),
      )
      expect(result.current.puzzle).toBeNull()
    })

    it('after a rejected getPuzzleBody, retryLoad() evicts the cache and attempts a fresh fetch', async () => {
      // With the cache eviction fix (content-metadata-lazy-load Task 5), a
      // rejected promise IS evicted, so retryLoad can successfully retry for
      // the same id that previously failed. This test verifies that behavior.
      vi.mocked(getPuzzleBody).mockRejectedValueOnce(new Error('dynamic import failed'))

      const { result } = renderHook(() => useDailySession())
      await waitFor(() => {
        expect(result.current.status).toBe('error')
      })
      expect(result.current.puzzle).toBeNull()

      // Mock a successful response for the retry.
      vi.mocked(getPuzzleBody).mockResolvedValueOnce(expectedPuzzle())

      act(() => {
        result.current.retryLoad()
      })
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      // After successful retry, the puzzle should be loaded and ready.
      expect(result.current.puzzle?.id).toBe(expectedPuzzle().id)
      // Verify getPuzzleBody was called twice (first rejection, then successful retry).
      expect(vi.mocked(getPuzzleBody)).toHaveBeenCalledTimes(2)
    })

    it('getPuzzleBody resolving undefined (unknown id) also transitions to error, not a stuck skeleton', async () => {
      vi.mocked(getPuzzleBody).mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useDailySession())
      await waitFor(() => {
        expect(result.current.status).toBe('error')
      })
      expect(trackError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('puzzle body lookup miss'),
      )
      expect(result.current.puzzle).toBeNull()
    })

    it('DEV puzzle-mode serves a stub puzzle directly (synchronously, no getPuzzleBody call) instead of the calendar id', async () => {
      vi.mocked(isDevPuzzleModeEnabled).mockReturnValue(true)

      const { result } = renderHook(() => useDailySession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      expect(result.current.puzzle).not.toBeNull()
      // Stub ids are never part of the (mocked) real calendar/pool.
      expect(FIXTURE_CALENDAR.includes(result.current.puzzle?.id ?? '')).toBe(false)
      // Dev-stub puzzles aren't real content — resolving one must never go
      // through getPuzzleBody (it would only ever resolve `undefined` for a
      // stub id).
      expect(getPuzzleBody).not.toHaveBeenCalled()
    })
  })
})
