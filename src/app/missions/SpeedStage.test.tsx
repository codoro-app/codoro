import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RUSH_STRIKE_LIMIT } from '../../engine'
import type { Puzzle } from '../../content'
import { createDefaultProfile } from '../../storage'
import type { RushSession } from '../rush/useRushSession'
import type { MissionSession } from './useMissionSession'

// Mocks the underlying session hook directly (same pattern as
// TraceRunner.test.tsx's useTraceSession mock) rather than driving
// through real content/storage/telemetry — SpeedStage's own orchestration
// logic (the native-vs-timer branch) is what's under test here, not
// useRushSession itself, which already has its own full test suite.
const useRushSessionMock = vi.fn<() => RushSession>()
vi.mock('../rush/useRushSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rush/useRushSession')>()
  return { ...actual, useRushSession: () => useRushSessionMock() }
})

const { SpeedStage } = await import('./SpeedStage')

const puzzle = {
  id: 'p1',
  pattern: 'off-by-one',
  difficulty_rating: 1000,
  explanation: 'exp',
  prompt: 'prompt',
  language: 'javascript',
  snippet: 'const x = 1',
  interaction: 'mcq',
  choices: ['a', 'b'],
  correct_choice: 0,
} as unknown as Puzzle

function makeRushSession(overrides: Partial<RushSession> = {}): RushSession {
  return {
    status: 'ready',
    phase: 'playing',
    profile: createDefaultProfile(),
    puzzle,
    strikes: 0,
    solvedCount: 0,
    currentStreak: 0,
    bestStreakThisRun: 0,
    runSummary: null,
    remainingMs: 15_000,
    forcedCommit: undefined,
    runAttempts: [],
    willEndOnContinue: false,
    handleAnswered: vi.fn(),
    handleContinue: vi.fn(),
    handleRunItBack: vi.fn(),
    retryLoad: vi.fn(),
    ...overrides,
  }
}

function makeMissionSession(overrides: Partial<MissionSession> = {}): MissionSession {
  return {
    status: 'ready',
    profile: null,
    phase: 'speed',
    currentStage: 'speed',
    completedStages: [],
    stageDeadlineMs: Date.now() + 60_000,
    remainingMs: 60_000,
    finishedStats: null,
    handleStartStage: vi.fn(),
    handleStageComplete: vi.fn(),
    handleAbandon: vi.fn(),
    handleRunItAgain: vi.fn(),
    retryLoad: vi.fn(),
    ...overrides,
  }
}

async function answerAndContinue(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'b' }))
  await user.click(await screen.findByRole('button', { name: /next puzzle|see results/i }))
}

describe('SpeedStage', () => {
  it('renders the active Rush puzzle', async () => {
    useRushSessionMock.mockReturnValue(makeRushSession())
    render(<SpeedStage missionSession={makeMissionSession()} />)
    expect(await screen.findByRole('button', { name: 'a' })).toBeInTheDocument()
  })

  it('advances within the stage — not the mission — when the clock has not expired and no strike is pending', async () => {
    const rushSession = makeRushSession({ strikes: 0 })
    useRushSessionMock.mockReturnValue(rushSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() + 60_000 })
    const user = userEvent.setup()
    render(<SpeedStage missionSession={missionSession} />)

    await answerAndContinue(user)

    expect(rushSession.handleContinue).toHaveBeenCalledTimes(1)
    expect(missionSession.handleStageComplete).not.toHaveBeenCalled()
  })

  it('ends the stage via the mission clock (timer) when the deadline has passed and no strike is pending', async () => {
    const rushSession = makeRushSession({ strikes: 1, solvedCount: 2, bestStreakThisRun: 2 })
    useRushSessionMock.mockReturnValue(rushSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() - 1_000 })
    const user = userEvent.setup()
    render(<SpeedStage missionSession={missionSession} />)

    await answerAndContinue(user)

    expect(missionSession.handleStageComplete).toHaveBeenCalledWith(
      { stageId: 'speed', solvedCount: 2, bestStreakThisRun: 2 },
      'timer',
    )
    expect(rushSession.handleContinue).not.toHaveBeenCalled()
  })

  it("a pending native strike-out wins over an already-expired mission clock — defers to Rush's own handleContinue rather than ending the stage directly", async () => {
    const rushSession = makeRushSession({ strikes: RUSH_STRIKE_LIMIT })
    useRushSessionMock.mockReturnValue(rushSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() - 1_000 })
    const user = userEvent.setup()
    render(<SpeedStage missionSession={missionSession} />)

    await answerAndContinue(user)

    expect(rushSession.handleContinue).toHaveBeenCalledTimes(1)
    // The native end hasn't actually landed yet (handleContinue is a bare
    // mock here, it doesn't flip phase/runSummary) — handleStageComplete is
    // only ever called reactively once useRushSession's own endRun lands,
    // covered by the next test.
    expect(missionSession.handleStageComplete).not.toHaveBeenCalled()
  })

  it('forwards a native end into the mission exactly once, reading stats from runSummary', () => {
    const rushSession = makeRushSession({
      phase: 'ended',
      runSummary: {
        solvedCount: 5,
        bestStreakThisRun: 4,
        longestStreakEver: 6,
        bestScoreEver: 5,
        isNewBestScore: false,
      },
    })
    useRushSessionMock.mockReturnValue(rushSession)
    const missionSession = makeMissionSession()
    const { rerender } = render(<SpeedStage missionSession={missionSession} />)
    rerender(<SpeedStage missionSession={missionSession} />)

    expect(missionSession.handleStageComplete).toHaveBeenCalledTimes(1)
    expect(missionSession.handleStageComplete).toHaveBeenCalledWith(
      { stageId: 'speed', solvedCount: 5, bestStreakThisRun: 4 },
      'native',
    )
  })
})
