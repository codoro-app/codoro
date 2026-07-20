import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { updateRating, roundForDisplay, getDailyNumber, getDailyPuzzleIndex } from '../../engine'
import type { Puzzle } from '../../content'
import { useDailySession } from './useDailySession'

const { FIXTURE_POOL } = vi.hoisted(() => ({
  FIXTURE_POOL: Array.from({ length: 12 }, (_, i) => ({
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
  })) as unknown as Puzzle[],
}))

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL }
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

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')

function today(): string {
  const d = new Date()
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function expectedPuzzle(): Puzzle {
  const index = getDailyPuzzleIndex(today(), FIXTURE_POOL.length)
  const puzzle = FIXTURE_POOL[index]
  if (!puzzle) throw new Error(`expected FIXTURE_POOL[${String(index)}] to exist`)
  return puzzle
}

describe('useDailySession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves today's puzzle via the deterministic date hash and the correct day number", async () => {
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
})
