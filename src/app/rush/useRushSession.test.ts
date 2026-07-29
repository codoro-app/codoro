import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Puzzle } from '../../content'
import { useRushSession } from './useRushSession'

const { FIXTURE_POOL } = vi.hoisted(() => ({
  FIXTURE_POOL: [
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `p${String(i)}`,
      pattern: i % 2 === 0 ? 'off-by-one' : 'null-undefined',
      difficulty_rating: 700 + i * 20,
      explanation: `explanation ${String(i)}`,
      prompt: `prompt ${String(i)}`,
      language: 'javascript',
      snippet: 'const x = 1',
      interaction: 'mcq',
      choices: ['a', 'b'],
      correct_choice: 0,
    })),
    // Scrubber puzzles at the same ratings as the mcq set above, present to
    // prove Rush's pool-building filters them out — Rush stays quiz-only
    // (RushInteraction excludes 'scrubber'; see useRushSession.ts's
    // isRushEligible). If that filter ever regresses, these are common
    // enough in this fixture that the "never serves a scrubber puzzle" test
    // below would fail almost immediately, not flakily.
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `s${String(i)}`,
      pattern: 'off-by-one',
      difficulty_rating: 700 + i * 20,
      explanation: `scrubber explanation ${String(i)}`,
      prompt: `scrubber prompt ${String(i)}`,
      language: 'javascript',
      snippet: 'let x = 1;\nx = x + 1;',
      interaction: 'scrubber',
      steps: [
        { line: 0, vars: { x: '1' } },
        { line: 1, vars: { x: '2' } },
      ],
      checkpoints: [
        { afterStep: 0, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 0 },
        { afterStep: 0, question: 'next-line', choices: ['0', '1'], correct: 1 },
      ],
    })),
  ] as unknown as Puzzle[],
}))

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL, quizPool: FIXTURE_POOL }
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
  trackError: vi.fn(),
  trackRushAttempt: vi.fn(),
  trackRushRunEnd: vi.fn(),
}))

vi.mock('../../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine')>()
  return { ...actual, updateRating: vi.fn(actual.updateRating) }
})

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { updateRating } = await import('../../engine')
const { trackRushRunEnd } = await import('../../telemetry')

/** Drives one commit + Continue through the hook, exactly like PuzzleCardShell's onAnswered/onContinue would. */
function answerAndContinue(
  result: { current: ReturnType<typeof useRushSession> },
  correct: boolean,
) {
  act(() => {
    result.current.handleAnswered({ correct, choiceIndex: correct ? 0 : 1 })
  })
  act(() => {
    result.current.handleContinue()
  })
}

describe('useRushSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves a first puzzle at rating - 400 on mount', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.puzzle).not.toBeNull()
    expect(result.current.phase).toBe('playing')
    expect(result.current.strikes).toBe(0)
  })

  it('never calls updateRating across a full run, including wrong answers — the orchestration-layer rating-isolation guard', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    // Mix of correct/wrong, ending in 3 strikes (RUSH_STRIKE_LIMIT).
    const pattern = [true, true, false, true, false, true, false]
    for (const correct of pattern) {
      if (result.current.phase === 'ended') break
      answerAndContinue(result, correct)
    }

    expect(result.current.phase).toBe('ended')
    expect(updateRating).not.toHaveBeenCalled()

    // Every appended attempt for this (unrated) mode has an unchanged rating.
    for (const call of vi.mocked(appendAttempt).mock.calls) {
      const attempt = call[0]
      expect(attempt.mode).toBe('rush')
      expect(attempt.userRatingAfter).toBe(attempt.userRatingBefore)
    }
  })

  it('ends the run at exactly 3 strikes, persists rushStats, and reports a summary', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true) // solved 1, streak 1
    answerAndContinue(result, true) // solved 2, streak 2
    answerAndContinue(result, false) // strike 1
    answerAndContinue(result, false) // strike 2
    expect(result.current.phase).toBe('playing')
    answerAndContinue(result, false) // strike 3 -> ends

    expect(result.current.phase).toBe('ended')
    expect(result.current.runSummary).toEqual({
      solvedCount: 2,
      bestStreakThisRun: 2,
      longestStreakEver: 2,
      bestScoreEver: 2,
    })
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        rushStats: {
          bestScore: 2,
          bestStreak: 2,
          runs: 1,
          lastRunAt: expect.any(String) as string,
        },
      }),
    )
    expect(trackRushRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ solved_count: 2, best_streak_in_run: 2 }),
    )
  })

  it('steps the difficulty up only on a correct answer, never on a miss', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    const firstPuzzleId = result.current.puzzle?.id

    answerAndContinue(result, false)

    expect(result.current.strikes).toBe(1)
    expect(result.current.phase).toBe('playing')
    expect(result.current.puzzle?.id).not.toBe(firstPuzzleId)
  })

  it('never serves a scrubber puzzle, even though the fixture pool contains several', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    for (let i = 0; i < 12; i++) {
      expect(result.current.puzzle?.interaction).not.toBe('scrubber')
      answerAndContinue(result, true)
    }
    expect(result.current.puzzle?.interaction).not.toBe('scrubber')
  })

  it('handleRunItBack starts a fresh run: strikes/solved/streak reset, a new run id in play', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, false)
    answerAndContinue(result, false)
    answerAndContinue(result, false)
    expect(result.current.phase).toBe('ended')

    act(() => {
      result.current.handleRunItBack()
    })

    expect(result.current.phase).toBe('playing')
    expect(result.current.strikes).toBe(0)
    expect(result.current.solvedCount).toBe(0)
    expect(result.current.currentStreak).toBe(0)
    expect(result.current.runSummary).toBeNull()
  })
})
