import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TraceRunner } from './TraceRunner'
import { scrubberPool } from '../../content'
import type { TraceSession } from './useTraceSession'
import type { CheckpointResult } from '../../engine'
import { createDefaultProfile } from '../../storage'

/**
 * OD-3 (docs/v2-build-plan.md, "Known open defects"; Phase 4 locked decision
 * 1): the Phase 3 corrective's co-valued-row mask (TraceRunner.pool.test.tsx)
 * only covers the exact step a checkpoint's `afterStep` sits on. Backward
 * scrubbing is unbounded — a player can always tap "Previous step" back
 * toward step 0 — so a sibling row (or the output line) can hold a pending
 * checkpoint's answer several steps *before* the pause, fully unmasked.
 * Confirmed live on `tc-009`: checkpoint 1's answer ("3") sits in sibling
 * row `v` as early as step 12, four steps before its afterStep (16) pause.
 *
 * This test drives the REAL `scrubberPool` through the REAL `TraceRunner`
 * (only `useTraceSession` mocked, same convention as TraceRunner.pool.test.tsx)
 * and, for every var-value/output checkpoint, scrubs backward one step at a
 * time from the pause all the way to step 0 — not just the pause step
 * itself — asserting the answer is masked at every one of those steps.
 * Delete the range-mask branch in TraceRunner.tsx (revert to masking only
 * when stepIndex === pendingCheckpoint.afterStep) and this test goes red on
 * tc-009 checkpoints 0 and 1, the two cases the sweep confirmed leak.
 */

const useTraceSessionMock = vi.fn<() => TraceSession>()
vi.mock('./useTraceSession', () => ({
  useTraceSession: () => useTraceSessionMock(),
}))

vi.mock('../practice/haptics', () => ({
  hapticTick: () => undefined,
}))

function makeSession(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    status: 'ready',
    profile: createDefaultProfile(),
    puzzle: null,
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

function clickNext(times: number) {
  for (let i = 0; i < times; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
  }
}

function clickPrevious() {
  fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))
}

function assertAnswerNotVisible(correctAnswer: string) {
  const varValues = Array.from(document.querySelectorAll('.scrubber__vars-value')).map(
    (el) => el.textContent,
  )
  const outputValue = document.querySelector('.scrubber__output-value')?.textContent
  expect(varValues).not.toContain(correctAnswer)
  expect(outputValue).not.toBe(correctAnswer)
}

beforeEach(() => {
  useTraceSessionMock.mockReset()
})

describe('Trace masking across the full reachable range while a checkpoint is pending (OD-3)', () => {
  for (const puzzle of scrubberPool) {
    puzzle.checkpoints.forEach((checkpoint, index) => {
      if (checkpoint.question !== 'var-value' && checkpoint.question !== 'output') return
      if (checkpoint.afterStep === 0) return // nothing earlier to scrub back to

      it(`${puzzle.id} checkpoint ${String(index)} (${checkpoint.question}) stays masked at every step scrubbed backward from the pause, not just the pause itself`, () => {
        const priorResults: CheckpointResult[] = Array.from({ length: index }, () => ({
          correct: true,
          choiceIndex: 0,
        }))
        useTraceSessionMock.mockReturnValue(
          makeSession({ puzzle, checkpointResults: priorResults }),
        )
        render(<TraceRunner />)
        clickNext(checkpoint.afterStep)
        expect(document.querySelector('.checkpoint-panel')).toBeInTheDocument()

        const correctAnswer = checkpoint.choices[checkpoint.correct]
        expect(correctAnswer).toBeDefined()
        if (correctAnswer === undefined) return

        // The pause step itself is already covered by TraceRunner.pool.test.tsx
        // (Phase 3 corrective) — this test's job is everything BEFORE it.
        for (let stepsBack = 0; stepsBack < checkpoint.afterStep; stepsBack++) {
          clickPrevious()
          assertAnswerNotVisible(correctAnswer)
        }
      })
    })
  }
})
