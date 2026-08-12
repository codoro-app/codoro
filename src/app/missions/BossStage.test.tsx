import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BOSS_STRIKE_LIMIT } from '../../engine'
import type { Puzzle } from '../../content'
import { createDefaultProfile } from '../../storage'
import type { BossSession } from '../boss/useBossSession'
import type { MissionSession } from './useMissionSession'

// Same direct-hook-mock pattern as SpeedStage.test.tsx / TraceRunner.test.tsx
// — BossStage's own orchestration logic is under test, not useBossSession
// itself (already covered by its own test suite).
const useBossSessionMock = vi.fn<() => BossSession>()
vi.mock('../boss/useBossSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../boss/useBossSession')>()
  return { ...actual, useBossSession: () => useBossSessionMock() }
})

const { BossStage } = await import('./BossStage')

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

function makeBossSession(overrides: Partial<BossSession> = {}): BossSession {
  return {
    status: 'ready',
    phase: 'playing',
    profile: createDefaultProfile(),
    puzzle,
    strikes: 0,
    position: 1,
    totalPuzzles: 10,
    runSummary: null,
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
    phase: 'boss',
    currentStage: 'boss',
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
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
}

describe('BossStage', () => {
  it('renders the active Boss puzzle', async () => {
    useBossSessionMock.mockReturnValue(makeBossSession())
    render(<BossStage missionSession={makeMissionSession()} />)
    expect(await screen.findByRole('button', { name: 'a' })).toBeInTheDocument()
  })

  it('advances within the stage — not the mission — when the clock has not expired and no native end is pending', async () => {
    const bossSession = makeBossSession({ strikes: 0, position: 3, totalPuzzles: 10 })
    useBossSessionMock.mockReturnValue(bossSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() + 60_000 })
    const user = userEvent.setup()
    render(<BossStage missionSession={missionSession} />)

    await answerAndContinue(user)

    expect(bossSession.handleContinue).toHaveBeenCalledTimes(1)
    expect(missionSession.handleStageComplete).not.toHaveBeenCalled()
  })

  it('ends the stage via the mission clock (timer) when the deadline has passed and no native end is pending — cleared is always false for a cutoff', async () => {
    const bossSession = makeBossSession({ strikes: 1, position: 4, totalPuzzles: 10 })
    useBossSessionMock.mockReturnValue(bossSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() - 1_000 })
    const user = userEvent.setup()
    render(<BossStage missionSession={missionSession} />)

    await answerAndContinue(user)

    expect(missionSession.handleStageComplete).toHaveBeenCalledWith(
      { stageId: 'boss', depthReached: 4, cleared: false },
      'timer',
    )
    expect(bossSession.handleContinue).not.toHaveBeenCalled()
  })

  it('a pending native strike-out wins over an already-expired mission clock', async () => {
    const bossSession = makeBossSession({
      strikes: BOSS_STRIKE_LIMIT,
      position: 5,
      totalPuzzles: 10,
    })
    useBossSessionMock.mockReturnValue(bossSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() - 1_000 })
    const user = userEvent.setup()
    render(<BossStage missionSession={missionSession} />)

    await answerAndContinue(user)

    expect(bossSession.handleContinue).toHaveBeenCalledTimes(1)
    expect(missionSession.handleStageComplete).not.toHaveBeenCalled()
  })

  it("reaching the active set's last puzzle also counts as a native end, even with zero strikes", async () => {
    const bossSession = makeBossSession({ strikes: 0, position: 10, totalPuzzles: 10 })
    useBossSessionMock.mockReturnValue(bossSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() - 1_000 })
    const user = userEvent.setup()
    render(<BossStage missionSession={missionSession} />)

    await answerAndContinue(user)

    expect(bossSession.handleContinue).toHaveBeenCalledTimes(1)
    expect(missionSession.handleStageComplete).not.toHaveBeenCalled()
  })

  it('forwards a native end into the mission exactly once, reading stats from runSummary', () => {
    const bossSession = makeBossSession({
      phase: 'ended',
      runSummary: {
        depthReached: 10,
        cleared: true,
        bestDepthEver: 10,
        isNewBestDepth: true,
        splits: [],
        previousBestSplits: null,
      },
    })
    useBossSessionMock.mockReturnValue(bossSession)
    const missionSession = makeMissionSession()
    const { rerender } = render(<BossStage missionSession={missionSession} />)
    rerender(<BossStage missionSession={missionSession} />)

    expect(missionSession.handleStageComplete).toHaveBeenCalledTimes(1)
    expect(missionSession.handleStageComplete).toHaveBeenCalledWith(
      { stageId: 'boss', depthReached: 10, cleared: true },
      'native',
    )
  })
})
