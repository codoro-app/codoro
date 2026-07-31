import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TraceRunner } from './TraceRunner'
import { scrubberPool } from '../../content'
import type { TraceSession } from './useTraceSession'
import type { CheckpointResult } from '../../engine'
import { createDefaultProfile } from '../../storage'

/**
 * Phase 3 corrective (co-valued checkpoint masking, docs/prompts/
 * claude_code_prompt_v2_phase3_corrective.md): drives the REAL
 * `scrubberPool` content through the REAL `TraceRunner`/`TraceRunnerPuzzle`
 * masking computation — only `useTraceSession` itself is mocked, the same
 * "drive the real UI, fake only what sits below the hook" convention
 * `TraceRunner.test.tsx` already uses — and asserts a pending checkpoint's
 * correct-answer string never appears anywhere else in the rendered state
 * panel or output line while that checkpoint is still unanswered.
 *
 * Every `var-value`/`output` checkpoint in every scrubber puzzle in the
 * pool is exercised, not just the motivating cases, but these three are
 * exactly what this corrective was written to catch a regression of:
 *   - mut-009 checkpoint 1 (var-value, target "original", co-valued with "cart")
 *   - tc-009 checkpoint 0  (var-value, target "count", co-valued with "v")
 *   - tc-009 checkpoint 1  (output, co-valued with "count" and "v")
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
    handleCheckpointAnswered: vi.fn(),
    handleContinue: vi.fn(),
    retryLoad: vi.fn(),
    ...overrides,
  }
}

/** Clicks "Next step" `times` times — same helper as TraceRunner.test.tsx. */
function clickNext(times: number) {
  for (let i = 0; i < times; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
  }
}

beforeEach(() => {
  useTraceSessionMock.mockReset()
})

describe('Trace masking across the real scrubberPool (Phase 3 corrective)', () => {
  for (const puzzle of scrubberPool) {
    puzzle.checkpoints.forEach((checkpoint, index) => {
      if (checkpoint.question !== 'var-value' && checkpoint.question !== 'output') return

      it(`${puzzle.id} checkpoint ${String(index)} (${checkpoint.question}) never leaks its answer into an unmasked row`, () => {
        // Simulate "player has scrubbed here and this is the next
        // unanswered checkpoint": checkpointResults is pre-filled up to
        // (but not including) this checkpoint, so answeredCount === index
        // and maxAllowedIndex allows scrubbing straight to its afterStep.
        const priorResults: CheckpointResult[] = Array.from({ length: index }, () => ({
          correct: true,
          choiceIndex: 0,
        }))
        useTraceSessionMock.mockReturnValue(
          makeSession({ puzzle, checkpointResults: priorResults }),
        )
        render(<TraceRunner />)
        clickNext(checkpoint.afterStep)

        // Confirm the pause was actually reached before asserting anything
        // is masked there — otherwise a future gating regression that stops
        // `clickNext` short could leave this test sitting on an earlier,
        // unrelated step and pass vacuously.
        expect(document.querySelector('.checkpoint-panel')).toBeInTheDocument()

        const correctAnswer = checkpoint.choices[checkpoint.correct]
        expect(correctAnswer).toBeDefined()

        const varValues = Array.from(document.querySelectorAll('.scrubber__vars-value')).map(
          (el) => el.textContent,
        )
        const outputValue = document.querySelector('.scrubber__output-value')?.textContent

        expect(varValues).not.toContain(correctAnswer)
        expect(outputValue).not.toBe(correctAnswer)
      })
    })
  }
})
