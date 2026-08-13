import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createDefaultProfile } from '../../storage'
import type { MissionSession } from './useMissionSession'

const useMissionSessionMock = vi.fn<() => MissionSession>()
vi.mock('./useMissionSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useMissionSession')>()
  return { ...actual, useMissionSession: () => useMissionSessionMock() }
})

// Stubbed so MissionsPage's own phase-routing logic is under test, not the
// real stage components (each already has its own full test suite and its
// own further hook dependencies) — same isolation principle as
// SpeedStage.test.tsx mocking useRushSession rather than driving through
// real content/storage.
vi.mock('./TraceStage', () => ({ TraceStage: () => <div>TraceStage stub</div> }))
vi.mock('./SpeedStage', () => ({ SpeedStage: () => <div>SpeedStage stub</div> }))
vi.mock('./BossStage', () => ({ BossStage: () => <div>BossStage stub</div> }))

const { MissionsPage } = await import('./MissionsPage')

function makeMissionSession(overrides: Partial<MissionSession> = {}): MissionSession {
  return {
    status: 'ready',
    profile: createDefaultProfile(),
    phase: 'checkpoint',
    currentStage: 'trace',
    completedStages: [],
    stageDeadlineMs: null,
    remainingMs: 0,
    finishedStats: null,
    handleStartStage: vi.fn(),
    handleStageComplete: vi.fn(),
    handleAbandon: vi.fn(),
    handleRunItAgain: vi.fn(),
    retryLoad: vi.fn(),
    ...overrides,
  }
}

describe('MissionsPage status branching', () => {
  it('shows a loading message while the session is loading', () => {
    useMissionSessionMock.mockReturnValue(makeMissionSession({ status: 'loading' }))
    render(<MissionsPage />)
    expect(screen.getByText(/Loading Missions/)).toBeInTheDocument()
  })

  it('shows a retry control on error and calls retryLoad', () => {
    const retryLoad = vi.fn()
    useMissionSessionMock.mockReturnValue(makeMissionSession({ status: 'error', retryLoad }))
    render(<MissionsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retryLoad).toHaveBeenCalledTimes(1)
  })
})

describe('MissionsPage phase routing', () => {
  it('renders MissionCheckpoint for phase "checkpoint", previewing the next stage before any tap', () => {
    useMissionSessionMock.mockReturnValue(
      makeMissionSession({ phase: 'checkpoint', currentStage: 'trace' }),
    )
    render(<MissionsPage />)
    expect(screen.getByText('Trace')).toBeInTheDocument()
    expect(screen.getByText('60 seconds')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start mission' })).toBeInTheDocument()
  })

  // 2b.3: MissionCheckpoint used to be icon + label + duration only — a
  // first-time player had no way to know what a stage actually involves
  // before starting it. Every stage now frames what's about to happen.
  it('previews what each stage actually involves, not just its name', () => {
    useMissionSessionMock.mockReturnValue(
      makeMissionSession({ phase: 'checkpoint', currentStage: 'speed' }),
    )
    render(<MissionsPage />)
    expect(
      screen.getByText('Answer as many puzzles as you can before the clock runs out.'),
    ).toBeInTheDocument()
  })

  it('renders TraceStage for phase "trace"', () => {
    useMissionSessionMock.mockReturnValue(makeMissionSession({ phase: 'trace' }))
    render(<MissionsPage />)
    expect(screen.getByText('TraceStage stub')).toBeInTheDocument()
  })

  it('renders SpeedStage for phase "speed"', () => {
    useMissionSessionMock.mockReturnValue(makeMissionSession({ phase: 'speed' }))
    render(<MissionsPage />)
    expect(screen.getByText('SpeedStage stub')).toBeInTheDocument()
  })

  it('renders BossStage for phase "boss"', () => {
    useMissionSessionMock.mockReturnValue(makeMissionSession({ phase: 'boss' }))
    render(<MissionsPage />)
    expect(screen.getByText('BossStage stub')).toBeInTheDocument()
  })

  it('renders MissionComplete for phase "complete"', () => {
    useMissionSessionMock.mockReturnValue(
      makeMissionSession({
        phase: 'complete',
        completedStages: [
          {
            stats: { stageId: 'trace', puzzlesCompleted: 3, solvedCount: 2 },
            endedReason: 'timer',
            completedAt: '2026-08-11T18:00:00.000Z',
          },
        ],
        finishedStats: {
          completions: 1,
          lastRunAt: '2026-08-11T18:03:00.000Z',
          lastCompletedAt: '2026-08-11T18:03:00.000Z',
        },
      }),
    )
    render(<MissionsPage />)
    expect(screen.getByText('Mission complete')).toBeInTheDocument()
    expect(screen.getByText('2/3 solved')).toBeInTheDocument()
  })
})

describe('MissionCheckpoint exit-mission flow (via MissionsPage)', () => {
  it('shows no exit affordance on a fresh, never-started run', () => {
    useMissionSessionMock.mockReturnValue(makeMissionSession({ completedStages: [] }))
    render(<MissionsPage />)
    expect(screen.queryByRole('button', { name: 'Exit mission' })).not.toBeInTheDocument()
  })

  it('requires a two-step confirm before calling handleAbandon, once a stage has completed', () => {
    const handleAbandon = vi.fn()
    useMissionSessionMock.mockReturnValue(
      makeMissionSession({
        completedStages: [
          {
            stats: { stageId: 'trace', puzzlesCompleted: 1, solvedCount: 1 },
            endedReason: 'timer',
            completedAt: '2026-08-11T18:00:00.000Z',
          },
        ],
        handleAbandon,
      }),
    )
    render(<MissionsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Exit mission' }))
    expect(handleAbandon).not.toHaveBeenCalled()
    expect(screen.getByText(/Your progress in this run will be lost/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Your progress in this run will be lost/)).not.toBeInTheDocument()
    expect(handleAbandon).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Exit mission' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit mission' }))
    expect(handleAbandon).toHaveBeenCalledTimes(1)
  })
})

// Protects click-meaningfulness decision 4 directly: no rating/Elo number
// is ever displayed on the payoff screen. A rating delta always renders as
// a signed integer (see PuzzleCardShell's own feedback-panel__delta:
// `+${delta}` / `${delta}`) — this asserts no such token appears anywhere
// in MissionComplete's rendered text, not just that we didn't wire one up
// on purpose.
describe('MissionComplete: no rating/Elo number (decision 4)', () => {
  it('never renders a signed-integer rating-delta-shaped token', () => {
    useMissionSessionMock.mockReturnValue(
      makeMissionSession({
        phase: 'complete',
        completedStages: [
          {
            stats: { stageId: 'trace', puzzlesCompleted: 4, solvedCount: 3 },
            endedReason: 'timer',
            completedAt: '2026-08-11T18:00:00.000Z',
          },
          {
            stats: { stageId: 'speed', solvedCount: 5, bestStreakThisRun: 4 },
            endedReason: 'native',
            completedAt: '2026-08-11T18:01:00.000Z',
          },
          {
            stats: { stageId: 'boss', depthReached: 6, cleared: false },
            endedReason: 'timer',
            completedAt: '2026-08-11T18:02:00.000Z',
          },
        ],
        finishedStats: {
          completions: 3,
          lastRunAt: '2026-08-11T18:02:00.000Z',
          lastCompletedAt: '2026-08-11T18:02:00.000Z',
        },
      }),
    )
    const { container } = render(<MissionsPage />)
    const ratingDeltaShaped = /(^|\s)[+-]\d+(\s|$)/
    expect(container.textContent).not.toMatch(ratingDeltaShaped)
  })
})
