/**
 * Task 7 (v4 Phase 4.3): a scrubber-day's session must accumulate
 * per-checkpoint results and, once complete, commit through the exact same
 * rating/streak/persistence/telemetry path useDailySession.test.ts already
 * proves for a non-scrubber (mcq) Daily puzzle — see that file for the
 * baseline this mirrors. Kept as its own file (not folded into
 * useDailySession.test.ts's all-mcq fixture pool), same convention
 * TraceRunner's own `.pool.test.tsx`/`.od3.pool.test.tsx` split uses for a
 * distinctly-shaped fixture.
 *
 * Every calendar entry below resolves to the SAME scrubber puzzle id — this
 * sidesteps needing to know which day-of-year the suite happens to run on
 * (todayDateString() is real wall-clock time, not mocked) while still
 * exercising the real getDailyCalendarIndex/DAILY_CALENDAR resolution path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { updateRating, roundForDisplay } from '../../engine'
import type { Puzzle } from '../../content'
import { useDailySession } from './useDailySession'

const { FIXTURE_CALENDAR, FIXTURE_BODY_BY_ID, SCRUBBER_PUZZLE } = vi.hoisted(() => {
  const scrubberPuzzle = {
    id: 's-daily-1',
    pattern: 'off-by-one',
    difficulty_rating: 1200,
    explanation: 'x accumulates across two separate increments.',
    prompt: 'Trace the value of x.',
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
  } as unknown as Puzzle

  return {
    SCRUBBER_PUZZLE: scrubberPuzzle,
    // Every entry is the same id — see module doc comment for why.
    FIXTURE_CALENDAR: Array.from({ length: 5 }, () => scrubberPuzzle.id),
    FIXTURE_BODY_BY_ID: new Map([[scrubberPuzzle.id, scrubberPuzzle]]),
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    DAILY_CALENDAR: FIXTURE_CALENDAR,
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

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { trackAttempt } = await import('../../telemetry')
const { resetPuzzleBodyCacheForTests } = await import('../practice/puzzleBodyCache')

function today(): string {
  const d = new Date()
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('useDailySession — scrubber puzzle', () => {
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

  it("serves today's scrubber puzzle with empty checkpointResults, isComplete false, solved null", async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    expect(result.current.puzzle?.id).toBe(SCRUBBER_PUZZLE.id)
    expect(result.current.checkpointResults).toEqual([])
    expect(result.current.isComplete).toBe(false)
    expect(result.current.solved).toBeNull()
  })

  it('onCheckpointAnswered accumulates results one at a time, only completing on the final checkpoint', async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.onCheckpointAnswered({ correct: true, choiceIndex: 0 })
    })
    expect(result.current.checkpointResults).toEqual([{ correct: true, choiceIndex: 0 }])
    expect(result.current.isComplete).toBe(false)
    expect(result.current.solved).toBeNull()
    expect(appendAttempt).not.toHaveBeenCalled()

    act(() => {
      result.current.onCheckpointAnswered({ correct: true, choiceIndex: 1 })
    })
    expect(result.current.checkpointResults).toEqual([
      { correct: true, choiceIndex: 0 },
      { correct: true, choiceIndex: 1 },
    ])
    expect(result.current.isComplete).toBe(true)
    expect(result.current.solved).toBe(true)
    expect(appendAttempt).toHaveBeenCalledTimes(1)
  })

  it('completing a scrubber Daily puzzle rates, advances the streak, sets dailyCompletion, persists, and fires trackAttempt — same effects as a non-scrubber Daily puzzle', async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const before = result.current.profile
    if (!before) throw new Error('expected a profile to be loaded')

    const expectedNewRating = updateRating(
      before.rating,
      SCRUBBER_PUZZLE.difficulty_rating,
      true,
      before.ratedAttemptCount,
    )
    const expectedDelta = roundForDisplay(expectedNewRating) - roundForDisplay(before.rating)

    act(() => {
      result.current.onCheckpointAnswered({ correct: true, choiceIndex: 0 })
    })
    act(() => {
      result.current.onCheckpointAnswered({ correct: true, choiceIndex: 1 })
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
      expect.objectContaining({
        mode: 'daily',
        correct: true,
        choice_index: null,
        checkpoint_results: [
          { correct: true, choiceIndex: 0 },
          { correct: true, choiceIndex: 1 },
        ],
        userRatingAfter: expectedNewRating,
      }),
    )
    expect(trackAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        puzzle_id: SCRUBBER_PUZZLE.id,
        correct: true,
        mode: 'daily',
        interaction: 'scrubber',
        user_rating_before: before.rating,
        user_rating_after: expectedNewRating,
      }),
    )
  })

  it('any missed checkpoint fails the whole attempt (scoreScrubberAttempt semantics)', async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.onCheckpointAnswered({ correct: true, choiceIndex: 0 })
    })
    act(() => {
      result.current.onCheckpointAnswered({ correct: false, choiceIndex: 0 })
    })

    expect(result.current.isComplete).toBe(true)
    expect(result.current.solved).toBe(false)
    expect(result.current.profile?.dailyCompletion?.correct).toBe(false)
    expect(appendAttempt).toHaveBeenCalledWith(expect.objectContaining({ correct: false }))
  })

  it('handleRetry resets checkpointResults/isComplete/solved for a fresh (unrated) attempt at the same puzzle', async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.onCheckpointAnswered({ correct: true, choiceIndex: 0 })
    })
    act(() => {
      result.current.onCheckpointAnswered({ correct: true, choiceIndex: 1 })
    })
    expect(result.current.isComplete).toBe(true)

    act(() => {
      result.current.handleRetry()
    })
    expect(result.current.checkpointResults).toEqual([])
    expect(result.current.isComplete).toBe(false)
    expect(result.current.solved).toBeNull()
    expect(result.current.ratingDelta).toBeNull()
  })
})
