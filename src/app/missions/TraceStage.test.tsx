import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ScrubberPuzzle } from '../../content'
import { createDefaultProfile } from '../../storage'
import type { TraceSession } from '../trace/useTraceSession'
import type { MissionSession } from './useMissionSession'

// Same direct-hook-mock pattern as TraceRunner.test.tsx's own useTraceSession
// mock — TraceStage's own orchestration logic (the soft-cutoff interception,
// both continue paths) is under test here, not useTraceSession itself.
const useTraceSessionMock = vi.fn<() => TraceSession>()
vi.mock('../trace/useTraceSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../trace/useTraceSession')>()
  return { ...actual, useTraceSession: () => useTraceSessionMock() }
})

vi.mock('../practice/haptics', () => ({ hapticTick: vi.fn() }))

const { TraceStage } = await import('./TraceStage')

const puzzle: ScrubberPuzzle = {
  id: 'trace-001',
  pattern: 'off-by-one',
  difficulty_rating: 1200,
  explanation: 'x accumulates.',
  prompt: 'Trace the value of x.',
  language: 'javascript',
  snippet: 'let x = 0\nx = x + 1\nconsole.log(x)',
  interaction: 'scrubber',
  steps: [
    { line: 0, vars: { x: '0' } },
    { line: 1, vars: { x: '1' } },
    { line: 2, vars: { x: '1' }, output: 'one' },
  ],
  checkpoints: [
    { afterStep: 1, question: 'var-value', target: 'x', choices: ['0', '1'], correct: 1 },
  ],
}

function makeTraceSession(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    status: 'ready',
    profile: createDefaultProfile(),
    puzzle,
    checkpointResults: [],
    isComplete: false,
    solved: null,
    ratingDelta: null,
    attemptVersion: 0,
    streak: 0,
    streakPause: null,
    handleStreakPauseKeepGoing: vi.fn(),
    handleStreakPauseDoneForNow: vi.fn(),
    handleCheckpointAnswered: vi.fn(),
    handleContinue: vi.fn(),
    retryLoad: vi.fn(),
    ...overrides,
  }
}

function makeMissionSession(overrides: Partial<MissionSession> = {}): MissionSession {
  return {
    status: 'ready',
    profile: null,
    phase: 'trace',
    currentStage: 'trace',
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

describe('TraceStage', () => {
  it('renders the active trace puzzle', () => {
    useTraceSessionMock.mockReturnValue(makeTraceSession())
    render(<TraceStage missionSession={makeMissionSession()} />)
    expect(screen.getByText('Trace the value of x.')).toBeInTheDocument()
  })

  it('advances within the stage — not the mission — when the clock has not expired', () => {
    const traceSession = makeTraceSession({ isComplete: true, solved: true })
    useTraceSessionMock.mockReturnValue(traceSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() + 60_000 })
    render(<TraceStage missionSession={missionSession} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(traceSession.handleContinue).toHaveBeenCalledTimes(1)
    expect(missionSession.handleStageComplete).not.toHaveBeenCalled()
  })

  it('ends the stage via the mission clock when the deadline has passed — the just-finished puzzle counts (soft cutoff)', () => {
    const traceSession = makeTraceSession({ isComplete: true, solved: true })
    useTraceSessionMock.mockReturnValue(traceSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() - 1_000 })
    render(<TraceStage missionSession={missionSession} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(missionSession.handleStageComplete).toHaveBeenCalledWith(
      { stageId: 'trace', puzzlesCompleted: 1, solvedCount: 1 },
      'timer',
    )
    expect(traceSession.handleContinue).not.toHaveBeenCalled()
  })

  it('an unsolved final puzzle is still counted as completed but not solved', () => {
    const traceSession = makeTraceSession({ isComplete: true, solved: false })
    useTraceSessionMock.mockReturnValue(traceSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() - 1_000 })
    render(<TraceStage missionSession={missionSession} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(missionSession.handleStageComplete).toHaveBeenCalledWith(
      { stageId: 'trace', puzzlesCompleted: 1, solvedCount: 0 },
      'timer',
    )
  })

  it('streak-pause "Keep going" routes through the same cutoff check, not a raw session continue', () => {
    const traceSession = makeTraceSession({
      isComplete: true,
      solved: true,
      streakPause: { streak: 5, isNewBest: false },
    })
    useTraceSessionMock.mockReturnValue(traceSession)
    const missionSession = makeMissionSession({ stageDeadlineMs: Date.now() - 1_000 })
    render(<TraceStage missionSession={missionSession} />)

    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }))

    expect(traceSession.handleStreakPauseDoneForNow).toHaveBeenCalledTimes(1)
    // Not the session's own bypassing handleStreakPauseKeepGoing — that
    // would skip the mission's cutoff check entirely (this file's own doc
    // comment).
    expect(traceSession.handleStreakPauseKeepGoing).not.toHaveBeenCalled()
    expect(traceSession.handleContinue).not.toHaveBeenCalled()
    expect(missionSession.handleStageComplete).toHaveBeenCalledWith(
      { stageId: 'trace', puzzlesCompleted: 1, solvedCount: 1 },
      'timer',
    )
  })
})
