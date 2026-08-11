import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Puzzle } from '../../content'
import { useBossSession } from './useBossSession'

const { FIXTURE_POOL, BOSS_RUN_IDS } = vi.hoisted(() => {
  const ids = Array.from({ length: 10 }, (_, i) => `b${String(i)}`)
  return {
    BOSS_RUN_IDS: ids,
    FIXTURE_POOL: ids.map((id, i) => ({
      id,
      pattern: 'off-by-one',
      difficulty_rating: 900 + i * 100,
      explanation: `explanation ${id}`,
      prompt: `prompt ${id}`,
      language: 'javascript',
      snippet: 'const x = 1',
      interaction: 'mcq',
      choices: ['a', 'b'],
      correct_choice: 0,
    })) as unknown as Puzzle[],
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL, quizPool: FIXTURE_POOL, BOSS_RUN: BOSS_RUN_IDS }
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
  trackBossAttempt: vi.fn(),
  trackBossRunEnd: vi.fn(),
}))

vi.mock('../../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine')>()
  return { ...actual, updateRating: vi.fn(actual.updateRating) }
})

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { updateRating } = await import('../../engine')
const { trackBossAttempt, trackBossRunEnd } = await import('../../telemetry')

function answerAndContinue(
  result: { current: ReturnType<typeof useBossSession> },
  correct: boolean,
) {
  act(() => {
    result.current.handleAnswered({ correct, choiceIndex: correct ? 0 : 1 })
  })
  act(() => {
    result.current.handleContinue()
  })
}

describe('useBossSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves BOSS_RUN[0] first, at position 1', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.puzzle?.id).toBe('b0')
    expect(result.current.position).toBe(1)
    expect(result.current.strikes).toBe(0)
  })

  it('serves BOSS_RUN in fixed order on correct answers', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe('b1')
    })
    expect(result.current.position).toBe(2)

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe('b2')
    })
    expect(result.current.position).toBe(3)
  })

  it('increments strikes on a wrong answer but keeps serving the next puzzle', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.strikes).toBe(1)
    })
    expect(result.current.phase).toBe('playing')
    expect(result.current.puzzle?.id).toBe('b1')
  })

  it('ends the run on the 3rd strike, reporting depthReached and cleared: false', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.position).toBe(3)
    })
    answerAndContinue(result, false)

    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })
    expect(result.current.runSummary).toEqual({
      depthReached: 3,
      cleared: false,
      bestDepthEver: 3,
      isNewBestDepth: true,
    })
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ depth_reached: 3, cleared: false, is_new_best_depth: true }),
    )
  })

  it('ends the run after the 10th puzzle with cleared: true', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    for (let i = 0; i < 9; i++) {
      answerAndContinue(result, true)
      await waitFor(() => {
        expect(result.current.position).toBe(i + 2)
      })
    }
    answerAndContinue(result, true)

    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })
    expect(result.current.runSummary).toEqual({
      depthReached: 10,
      cleared: true,
      bestDepthEver: 10,
      isNewBestDepth: true,
    })
  })

  it('never rates — updateRating is never called across a full run including wrong answers', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.strikes).toBe(1)
    })

    expect(updateRating).not.toHaveBeenCalled()
  })

  it('records every attempt with mode "boss" and the correct run-level telemetry context', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })

    expect(appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'boss', puzzleId: 'b0' }),
    )
    expect(trackBossAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'boss', puzzle_id: 'b0', position_in_run: 1 }),
    )
  })

  it('"Run it back" starts a fresh run from position 1 with strikes reset', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    for (let i = 0; i < 3; i++) {
      answerAndContinue(result, false)
      await waitFor(() => {
        expect(result.current.strikes).toBe(i + 1)
      })
    }
    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })

    act(() => {
      result.current.handleRunItBack()
    })

    await waitFor(() => {
      expect(result.current.phase).toBe('playing')
    })
    expect(result.current.puzzle?.id).toBe('b0')
    expect(result.current.position).toBe(1)
    expect(result.current.strikes).toBe(0)
  })
})
