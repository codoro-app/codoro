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

// resolveActiveBossSet must be mocked too, not just BOSS_SETS: its default
// `sets` parameter closes over the real bossRun.ts module-scope BOSS_SETS
// (the real puzzle ids), independent of what this mock re-exports as
// content's BOSS_SETS — mocking only the constant would leave useBossSession
// resolving real ids that don't exist in FIXTURE_POOL. This stub ignores
// runsCompleted (rotation-specific coverage lives in its own describe block
// below) and always returns the single fixture set, preserving every
// existing test's "serves position 1 first" assumption for a fresh profile.
vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL,
    quizPool: FIXTURE_POOL,
    BOSS_SETS: [BOSS_RUN_IDS],
    resolveActiveBossSet: () => BOSS_RUN_IDS,
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
      expect.objectContaining({
        depth_reached: 3,
        cleared: false,
        ended_reason: 'strikes',
        is_new_best_depth: true,
      }),
    )
  })

  it('ends the run after the 10th puzzle with cleared: true when the run was never struck out', async () => {
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
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ cleared: true, ended_reason: 'completed' }),
    )
  })

  // Plan-flagged edge case: reaching the 10th puzzle and losing the 3rd
  // strike there is a loss, not a clear — depth alone (10) can't tell this
  // apart from a clean finish; only `cleared`/`ended_reason` can.
  it('reports cleared: false when the 3rd strike lands exactly on the 10th puzzle', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, false) // strike 1, puzzle 1 -> 2
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    for (let i = 0; i < 7; i++) {
      answerAndContinue(result, true) // puzzles 2-8, correct
      await waitFor(() => {
        expect(result.current.position).toBe(i + 3)
      })
    }
    answerAndContinue(result, false) // strike 2, puzzle 9 -> 10
    await waitFor(() => {
      expect(result.current.position).toBe(10)
    })
    answerAndContinue(result, false) // strike 3, on puzzle 10 itself — the run ends here

    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })
    expect(result.current.runSummary).toEqual({
      depthReached: 10,
      cleared: false,
      bestDepthEver: 10,
      isNewBestDepth: true,
    })
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ depth_reached: 10, cleared: false, ended_reason: 'strikes' }),
    )
  })

  // A wrong answer on the 10th puzzle that is NOT the 3rd strike still
  // counts as clearing the run — the player was never eliminated.
  it('reports cleared: true when the 10th puzzle is answered wrong but it is not the 3rd strike', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, false) // strike 1, puzzle 1 -> 2
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    for (let i = 0; i < 8; i++) {
      answerAndContinue(result, true) // puzzles 2-9, correct
      await waitFor(() => {
        expect(result.current.position).toBe(i + 3)
      })
    }
    answerAndContinue(result, false) // strike 2, on puzzle 10 — not the 3rd strike

    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })
    expect(result.current.runSummary).toEqual({
      depthReached: 10,
      cleared: true,
      bestDepthEver: 10,
      isNewBestDepth: true,
    })
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ depth_reached: 10, cleared: true, ended_reason: 'completed' }),
    )
  })

  it('accumulates onto prior bossStats and reports isNewBestDepth: false when the run does not beat the stored best', async () => {
    vi.mocked(loadProfile).mockResolvedValue({
      ...createDefaultProfile(),
      bossStats: {
        bestDepth: 8,
        clears: 2,
        runs: 5,
        lastRunAt: '2026-08-01T00:00:00.000Z',
        bestRunSplits: [1000, 2200, 3400, 4800, 6100, 7300, 8500, 9900],
      },
    })

    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    // 3 strikes at depth 3 — well short of the stored bestDepth of 8.
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
      bestDepthEver: 8,
      isNewBestDepth: false,
    })
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        bossStats: {
          bestDepth: 8,
          clears: 2,
          runs: 6,
          lastRunAt: expect.any(String) as string,
          bestRunSplits: [1000, 2200, 3400, 4800, 6100, 7300, 8500, 9900],
        },
      }),
    )
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ is_new_best_depth: false }),
    )
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
