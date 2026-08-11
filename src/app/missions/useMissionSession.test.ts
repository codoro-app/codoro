import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useMissionSession } from './useMissionSession'
import { MISSION_STAGE_DURATION_MS } from './missionStageClock'

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({
  trackError: vi.fn(),
  trackMissionStart: vi.fn(),
  trackMissionStageComplete: vi.fn(),
  trackMissionAbandoned: vi.fn(),
  trackMissionFinished: vi.fn(),
}))

const { loadProfile, saveProfile, createDefaultProfile } = await import('../../storage')
const {
  trackMissionStart,
  trackMissionStageComplete,
  trackMissionAbandoned,
  trackMissionFinished,
} = await import('../../telemetry')

async function mountReady() {
  const rendered = renderHook(() => useMissionSession())
  await waitFor(() => {
    expect(rendered.result.current.status).toBe('ready')
  })
  return rendered
}

beforeEach(() => {
  vi.mocked(loadProfile).mockReset()
  vi.mocked(saveProfile).mockReset().mockResolvedValue(undefined)
  vi.mocked(trackMissionStart).mockReset()
  vi.mocked(trackMissionStageComplete).mockReset()
  vi.mocked(trackMissionAbandoned).mockReset()
  vi.mocked(trackMissionFinished).mockReset()
})

describe('useMissionSession', () => {
  it('starts a brand-new run at the checkpoint screen, stage trace, no completed stages', async () => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    const { result } = await mountReady()

    expect(result.current.phase).toBe('checkpoint')
    expect(result.current.currentStage).toBe('trace')
    expect(result.current.completedStages).toEqual([])
    expect(result.current.stageDeadlineMs).toBeNull()
  })

  it('handleStartStage persists missionProgress and fires trackMissionStart exactly once for a brand-new run', async () => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    const { result } = await mountReady()

    act(() => {
      result.current.handleStartStage()
    })

    expect(result.current.phase).toBe('trace')
    expect(result.current.stageDeadlineMs).not.toBeNull()
    expect(result.current.remainingMs).toBe(MISSION_STAGE_DURATION_MS)
    expect(trackMissionStart).toHaveBeenCalledTimes(1)
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        missionProgress: expect.objectContaining({
          currentStage: 'trace',
          completedStages: [],
        }) as unknown,
      }),
    )
  })

  it('handleStageComplete advances to the next stage checkpoint and persists the updated missionProgress', async () => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    const { result } = await mountReady()

    act(() => {
      result.current.handleStartStage()
    })
    act(() => {
      result.current.handleStageComplete(
        { stageId: 'trace', puzzlesCompleted: 4, solvedCount: 3 },
        'timer',
      )
    })

    expect(result.current.phase).toBe('checkpoint')
    expect(result.current.currentStage).toBe('speed')
    expect(result.current.completedStages).toEqual([
      expect.objectContaining({
        stats: { stageId: 'trace', puzzlesCompleted: 4, solvedCount: 3 },
        endedReason: 'timer',
      }) as unknown,
    ])
    expect(result.current.stageDeadlineMs).toBeNull()
    expect(trackMissionStageComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'trace',
        ended_reason: 'timer',
        stats: { stage_id: 'trace', puzzles_completed: 4, solved_count: 3 },
      }),
    )
  })

  it('completing all three stages ends the mission: phase complete, missionProgress cleared, missionStats incremented, trackMissionFinished fired', async () => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    const { result } = await mountReady()

    act(() => {
      result.current.handleStartStage()
    })
    act(() => {
      result.current.handleStageComplete(
        { stageId: 'trace', puzzlesCompleted: 2, solvedCount: 2 },
        'timer',
      )
    })
    act(() => {
      result.current.handleStartStage()
    })
    act(() => {
      result.current.handleStageComplete(
        { stageId: 'speed', solvedCount: 5, bestStreakThisRun: 4 },
        'native',
      )
    })
    act(() => {
      result.current.handleStartStage()
    })
    act(() => {
      result.current.handleStageComplete(
        { stageId: 'boss', depthReached: 6, cleared: false },
        'timer',
      )
    })

    expect(result.current.phase).toBe('complete')
    expect(result.current.completedStages).toHaveLength(3)
    expect(result.current.finishedStats).toEqual({
      completions: 1,
      lastRunAt: expect.any(String) as unknown,
      lastCompletedAt: expect.any(String) as unknown,
    })
    expect(trackMissionFinished).toHaveBeenCalledWith(expect.objectContaining({ completions: 1 }))
    expect(saveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        missionProgress: null,
        missionStats: expect.objectContaining({ completions: 1 }) as unknown,
      }),
    )
  })

  it('increments completions from prior missionStats rather than resetting to 1', async () => {
    vi.mocked(loadProfile).mockResolvedValue({
      ...createDefaultProfile(),
      missionStats: {
        completions: 4,
        lastRunAt: '2026-08-10T12:00:00.000Z',
        lastCompletedAt: '2026-08-10T12:00:00.000Z',
      },
    })
    const { result } = await mountReady()

    const allStats = [
      { stageId: 'trace' as const, puzzlesCompleted: 1, solvedCount: 1 },
      { stageId: 'speed' as const, solvedCount: 1, bestStreakThisRun: 1 },
      { stageId: 'boss' as const, depthReached: 1, cleared: false },
    ]
    for (const stats of allStats) {
      act(() => {
        result.current.handleStartStage()
      })
      act(() => {
        result.current.handleStageComplete(stats, 'timer')
      })
    }

    expect(result.current.finishedStats?.completions).toBe(5)
  })

  it('resumes mid-arc from a persisted missionProgress: correct stage, prior completed stages kept, fresh clock', async () => {
    vi.mocked(loadProfile).mockResolvedValue({
      ...createDefaultProfile(),
      missionProgress: {
        runId: 'existing-run',
        currentStage: 'boss',
        completedStages: [
          {
            stats: { stageId: 'trace', puzzlesCompleted: 3, solvedCount: 2 },
            endedReason: 'timer',
            completedAt: '2026-08-11T18:00:00.000Z',
          },
          {
            stats: { stageId: 'speed', solvedCount: 4, bestStreakThisRun: 3 },
            endedReason: 'native',
            completedAt: '2026-08-11T18:01:00.000Z',
          },
        ],
        startedAt: '2026-08-11T17:58:00.000Z',
      },
    })
    const { result } = await mountReady()

    expect(result.current.phase).toBe('checkpoint')
    expect(result.current.currentStage).toBe('boss')
    expect(result.current.completedStages).toHaveLength(2)
    expect(result.current.stageDeadlineMs).toBeNull()

    // Resuming must not re-persist/re-fire trackMissionStart — this run
    // already started; only a genuinely fresh run does that (see the next
    // test). Starting the resumed stage gives it a FRESH clock, not one
    // continuing from wherever it was (Decision 6: no paused-countdown
    // serialization).
    act(() => {
      result.current.handleStartStage()
    })
    expect(trackMissionStart).not.toHaveBeenCalled()
    expect(result.current.remainingMs).toBe(MISSION_STAGE_DURATION_MS)
  })

  it('handleAbandon clears missionProgress, fires trackMissionAbandoned, and resets to a fresh checkpoint at stage trace', async () => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    const { result } = await mountReady()

    act(() => {
      result.current.handleStartStage()
    })
    act(() => {
      result.current.handleStageComplete(
        { stageId: 'trace', puzzlesCompleted: 2, solvedCount: 1 },
        'timer',
      )
    })
    act(() => {
      result.current.handleStartStage()
    }) // now mid-speed-stage

    act(() => {
      result.current.handleAbandon()
    })

    expect(trackMissionAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'speed', completed_stage_count: 1 }),
    )
    expect(result.current.phase).toBe('checkpoint')
    expect(result.current.currentStage).toBe('trace')
    expect(result.current.completedStages).toEqual([])
    expect(saveProfile).toHaveBeenLastCalledWith(expect.objectContaining({ missionProgress: null }))

    // A fresh run after abandon must persist + fire trackMissionStart again
    // (the boundary-write guard correctly sees this as a new run, not the
    // already-persisted one it just cleared).
    vi.mocked(trackMissionStart).mockClear()
    act(() => {
      result.current.handleStartStage()
    })
    expect(trackMissionStart).toHaveBeenCalledTimes(1)
  })

  it('handleRunItAgain from the complete phase starts a fresh run without touching missionStats', async () => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    const { result } = await mountReady()

    const allStats = [
      { stageId: 'trace' as const, puzzlesCompleted: 1, solvedCount: 1 },
      { stageId: 'speed' as const, solvedCount: 1, bestStreakThisRun: 1 },
      { stageId: 'boss' as const, depthReached: 1, cleared: false },
    ]
    for (const stats of allStats) {
      act(() => {
        result.current.handleStartStage()
      })
      act(() => {
        result.current.handleStageComplete(stats, 'timer')
      })
    }
    expect(result.current.phase).toBe('complete')
    const statsAfterFirstRun = result.current.finishedStats

    act(() => {
      result.current.handleRunItAgain()
    })

    expect(result.current.phase).toBe('checkpoint')
    expect(result.current.currentStage).toBe('trace')
    expect(result.current.completedStages).toEqual([])
    expect(result.current.finishedStats).toBeNull()
    // handleRunItAgain itself doesn't touch storage — the next
    // handleStartStage's boundary write does, exactly like any fresh run.
    expect(statsAfterFirstRun?.completions).toBe(1)
  })

  it('surfaces a load failure as status error and retryLoad recovers', async () => {
    vi.mocked(loadProfile).mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useMissionSession())
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    act(() => {
      result.current.retryLoad()
    })
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
  })
})

describe('useMissionSession: stage clock ticking', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('remainingMs ticks down after a stage starts and reaches 0 at the deadline', async () => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    const { result } = renderHook(() => useMissionSession())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('ready')

    act(() => {
      result.current.handleStartStage()
    })
    expect(result.current.remainingMs).toBe(MISSION_STAGE_DURATION_MS)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(result.current.remainingMs).toBeLessThanOrEqual(30_000)
    expect(result.current.remainingMs).toBeGreaterThan(0)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(result.current.remainingMs).toBe(0)
  })
})
