import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TraceRunner } from './TraceRunner'
import { scrubberPool } from '../../content/pools'
import type { TraceSession } from './useTraceSession'
import type { CheckpointResult } from '../../engine'
import { createDefaultProfile } from '../../storage'

/**
 * OD-4 (docs/v2-build-plan.md, "Known open defects"; Phase 8): the OD-3 fix
 * (TraceRunner.od3.pool.test.tsx) masks a co-valued cell only when its value
 * *equals* the pending checkpoint's answer. A cell can also leak the answer
 * by *containment* — an `output` checkpoint's answer is often a printed
 * line like `"initial window sum:" 9` that embeds a bare value (`9`) a
 * sibling `windowSum` row displays verbatim, and `"9" === '"initial window
 * sum:" 9'` is false, so the equality-only mask never fires for it. Same
 * shape for a `var-value` checkpoint whose answer is itself compound (an
 * array like `[6, 14]` embedding a sibling row's bare `6`).
 *
 * Confirmed live on `oob-011` checkpoint 1 (`afterStep: 10`, `output`,
 * answer `"initial window sum:" 9`): `windowSum` and `maxSum` both display
 * `9` at that step. A full-pool sweep (Phase 8, independent of
 * TraceRunner.tsx's own logic — this test recomputes the leak from raw
 * puzzle content, the same way TraceRunner.od3.pool.test.tsx derives its
 * expected answer from `checkpoint.choices`) found the same shape on 44
 * further checkpoints across 20 other puzzles, e.g. `oob-011` checkpoint 3
 * itself (`"max sum:" 10` embedding `windowSum`/`maxSum` = `10`) — a second,
 * previously-undocumented case in the very puzzle OD-4 was filed against.
 *
 * This test drives the REAL `scrubberPool` through the REAL `TraceRunner`
 * (only `useTraceSession` mocked, same convention as the OD-3 test) and,
 * for every checkpoint where the sweep below finds at least one
 * containment-only leak, scrubs from the pause back to step 0 asserting
 * every flagged cell is masked. Revert `valueLeaksAnswer` in TraceRunner.tsx
 * to an equality-only check and this test goes red on `oob-011` and the
 * other 20 affected puzzles.
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

function varCellText(name: string): string | null | undefined {
  const rows = Array.from(document.querySelectorAll('.scrubber__vars-row'))
  const row = rows.find((r) => r.querySelector('.scrubber__vars-name')?.textContent === name)
  return row?.querySelector('.scrubber__vars-value')?.textContent
}

function outputCellText(): string | null | undefined {
  return document.querySelector('.scrubber__output-value')?.textContent
}

/** Independent oracle, deliberately not imported from TraceRunner.tsx — see this file's doc comment. */
const TOKEN_CHAR = /[A-Za-z0-9_]/
function containsAsToken(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false
  let from = 0
  for (;;) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) return false
    const before = haystack.charAt(idx - 1)
    const after = haystack.charAt(idx + needle.length)
    if (!TOKEN_CHAR.test(before) && !TOKEN_CHAR.test(after)) return true
    from = idx + 1
  }
}

interface LeakCase {
  stepIndex: number
  varNames: string[]
  output: boolean
}

/** Every step in [0, checkpoint.afterStep] with at least one containment-only (non-equal) leaking cell. */
function findContainmentLeaks(
  puzzle: (typeof scrubberPool)[number],
  checkpoint: (typeof scrubberPool)[number]['checkpoints'][number],
): LeakCase[] {
  const answerStep = puzzle.steps[checkpoint.afterStep]
  if (!answerStep) return []
  const answerValue =
    checkpoint.question === 'var-value' && checkpoint.target
      ? answerStep.vars[checkpoint.target]
      : checkpoint.question === 'output'
        ? answerStep.output
        : undefined
  if (answerValue === undefined) return []

  const cases: LeakCase[] = []
  for (let stepIndex = 0; stepIndex <= checkpoint.afterStep; stepIndex++) {
    const step = puzzle.steps[stepIndex]
    if (!step) continue
    const varNames = Object.entries(step.vars)
      .filter(([, value]) => value !== answerValue && containsAsToken(answerValue, value))
      .map(([name]) => name)
    const output =
      step.output !== undefined &&
      step.output !== answerValue &&
      containsAsToken(answerValue, step.output)
    if (varNames.length > 0 || output) cases.push({ stepIndex, varNames, output })
  }
  return cases
}

beforeEach(() => {
  useTraceSessionMock.mockReset()
})

describe('Trace masking closes the containment leak, not just the equality one (OD-4)', () => {
  for (const puzzle of scrubberPool) {
    puzzle.checkpoints.forEach((checkpoint, index) => {
      if (checkpoint.question !== 'var-value' && checkpoint.question !== 'output') return

      const leaks = findContainmentLeaks(puzzle, checkpoint)
      if (leaks.length === 0) return

      it(`${puzzle.id} checkpoint ${String(index)} (${checkpoint.question}) masks every cell whose value is contained in the answer, not just cells equal to it`, () => {
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

        // Walk backward from the pause to step 0, same traversal order as
        // TraceRunner.od3.pool.test.tsx, checking each flagged step as we
        // pass through it.
        const byStep = new Map(leaks.map((l) => [l.stepIndex, l]))
        for (let stepIndex = checkpoint.afterStep; stepIndex >= 0; stepIndex--) {
          const leak = byStep.get(stepIndex)
          if (leak) {
            const step = puzzle.steps[stepIndex]
            for (const name of leak.varNames) {
              expect(varCellText(name)).not.toBe(step?.vars[name])
            }
            if (leak.output) {
              expect(outputCellText()).not.toBe(step?.output)
            }
          }
          if (stepIndex > 0) clickPrevious()
        }
      })
    })
  }
})
