import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { TRACE_CHECKPOINT_TIME_LIMIT_MS, TraceRunner, TraceRunnerPuzzle } from './TraceRunner'
import type { ScrubberPuzzle } from '../../content'
import type { TraceSession } from './useTraceSession'
import type { CheckpointResult } from '../../engine'
import { createDefaultProfile } from '../../storage'

/**
 * Dispatches two raw native `click` events on `element` inside a single
 * `act()` call — see CheckpointPanel.test.tsx's identically-named helper
 * for the full rationale: two separate `fireEvent.click(...)` calls each
 * fully flush (including the `disabled` DOM attribute) before the next
 * runs, so they can't distinguish "the internal guard stopped the second
 * commit" from "the browser refused to dispatch a click on an already-
 * disabled button." This reproduces both events landing in the same React
 * batch, before either commit, which only `CheckpointPanel`'s own
 * `lockedRef` guard (not `disabled`, not yet live in the DOM) can stop.
 */
function dispatchTwoClicksInOneBatch(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const useTraceSessionMock = vi.fn<() => TraceSession>()
vi.mock('./useTraceSession', () => ({
  useTraceSession: () => useTraceSessionMock(),
}))

const hapticTickMock = vi.fn<() => void>()
vi.mock('../practice/haptics', () => ({
  hapticTick: () => {
    hapticTickMock()
  },
}))

/**
 * A 5-step trace with one checkpoint of each question type, in order:
 *  0: var-value  (afterStep 1, target "x", answer "1")
 *  1: output     (afterStep 2, answer "one")
 *  2: next-line  (afterStep 3, answer "4" — the line steps[4] executes)
 * "six" (steps[4].output) and "4"/line-4 content are deliberately unique
 * strings not reused anywhere earlier in the trace, so a leaked "steps[4]"
 * value is unambiguous to detect via `queryByText`.
 */
const puzzle: ScrubberPuzzle = {
  id: 'trace-001',
  pattern: 'off-by-one',
  difficulty_rating: 1200,
  explanation: 'x accumulates across two separate increments.',
  prompt: 'Trace the value of x.',
  language: 'javascript',
  snippet: 'let x = 0\nx = x + 1\nconsole.log(x)\nx = x + 5\nconsole.log(x)',
  interaction: 'scrubber',
  steps: [
    { line: 0, vars: { x: '0' } },
    { line: 1, vars: { x: '1' } },
    { line: 2, vars: { x: '1' }, output: 'one' },
    { line: 3, vars: { x: '6' } },
    { line: 4, vars: { x: '6' }, output: 'six' },
  ],
  checkpoints: [
    { afterStep: 1, question: 'var-value', target: 'x', choices: ['0', '1', '2'], correct: 1 },
    { afterStep: 2, question: 'output', choices: ['one', 'two', 'three'], correct: 0 },
    { afterStep: 3, question: 'next-line', choices: ['3', '4'], correct: 1 },
  ],
}

function makeSession(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    status: 'ready',
    profile: createDefaultProfile(),
    puzzle,
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

/** Clicks "Next step" `times` times. */
function clickNext(times: number) {
  for (let i = 0; i < times; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
  }
}

beforeEach(() => {
  useTraceSessionMock.mockReset()
  hapticTickMock.mockReset()
})

describe('TraceRunner status branches', () => {
  it('shows a loading message while the session is loading', () => {
    useTraceSessionMock.mockReturnValue(makeSession({ status: 'loading', profile: null }))
    render(<TraceRunner />)
    expect(screen.getByText(/Loading your trace session/)).toBeInTheDocument()
  })

  it('shows a retry control on error and calls retryLoad', () => {
    const retryLoad = vi.fn()
    useTraceSessionMock.mockReturnValue(
      makeSession({ status: 'error', profile: null, puzzle: null, retryLoad }),
    )
    render(<TraceRunner />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retryLoad).toHaveBeenCalledTimes(1)
  })

  it('shows an empty message when the pool has no puzzle to serve', () => {
    useTraceSessionMock.mockReturnValue(makeSession({ status: 'empty', puzzle: null }))
    render(<TraceRunner />)
    expect(screen.getByText(/No trace puzzles available/)).toBeInTheDocument()
  })
})

describe('TraceRunner checkpoint gating', () => {
  it('caps forward scrubbing at the next unanswered checkpoint’s afterStep', () => {
    useTraceSessionMock.mockReturnValue(makeSession())
    render(<TraceRunner />)

    // checkpoints[0].afterStep === 1 -> exactly one Next click is allowed.
    clickNext(1)
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled()

    const highlighted = document.querySelectorAll('.scrubber__code-line--current')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]?.textContent).toContain('x = x + 1')
  })
})

describe('TraceRunner masking (var-value)', () => {
  it('renders the masked value, not the real value, at the var-value checkpoint pause', () => {
    useTraceSessionMock.mockReturnValue(makeSession())
    render(<TraceRunner />)
    clickNext(1) // -> stepIndex 1, the var-value checkpoint's afterStep

    expect(screen.getByText('?', { selector: '.scrubber__vars-value' })).toBeInTheDocument()
    // The single most important assertion in this suite: the real answer
    // ("1") must be genuinely absent from the rendered tree, not merely
    // styled out of view.
    expect(screen.queryByText('1', { selector: '.scrubber__vars-value' })).not.toBeInTheDocument()
  })

  it('reveals the real value and records the result once answered', () => {
    const handleCheckpointAnswered = vi.fn()
    useTraceSessionMock.mockReturnValue(makeSession({ handleCheckpointAnswered }))
    render(<TraceRunner />)
    clickNext(1)

    fireEvent.click(screen.getByRole('button', { name: '0' }))
    expect(handleCheckpointAnswered).toHaveBeenCalledTimes(1)
    expect(hapticTickMock).toHaveBeenCalledTimes(1)

    const recorded = handleCheckpointAnswered.mock.calls[0]?.[0] as CheckpointResult
    const correctChoiceIndex = 1

    // Simulate useTraceSession re-rendering with this checkpoint now answered.
    useTraceSessionMock.mockReturnValue(
      makeSession({ checkpointResults: [recorded], handleCheckpointAnswered }),
    )
    render(<TraceRunner />)
    expect(recorded.correct).toBe(recorded.choiceIndex === correctChoiceIndex)
  })
})

describe('TraceRunner masking (output)', () => {
  it('renders the masked output, not the real text, at the output checkpoint pause', () => {
    useTraceSessionMock.mockReturnValue(
      makeSession({ checkpointResults: [{ correct: true, choiceIndex: 1 }] }),
    )
    render(<TraceRunner />)
    clickNext(2) // checkpoints[1].afterStep === 2

    expect(document.querySelector('.scrubber__output-value')?.textContent).toBe('?')
    expect(
      screen.queryByText('one', { selector: '.scrubber__output-value' }),
    ).not.toBeInTheDocument()
  })
})

describe('TraceRunner next-line pause: no pre-advance / no leaked step content', () => {
  it('does not render steps[afterStep + 1]’s content before the checkpoint is answered', () => {
    useTraceSessionMock.mockReturnValue(
      makeSession({
        checkpointResults: [
          { correct: true, choiceIndex: 1 },
          { correct: true, choiceIndex: 0 },
        ],
      }),
    )
    render(<TraceRunner />)
    clickNext(3) // checkpoints[2].afterStep === 3

    // Forward scrubbing must stop exactly here — steps[4] is unreachable.
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled()

    const highlighted = document.querySelectorAll('.scrubber__code-line--current')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]?.textContent).toContain('x = x + 5')

    // steps[4].output ("six") is a unique token in this fixture — its
    // presence anywhere would mean steps[4] leaked before the answer.
    expect(screen.queryByText('six')).not.toBeInTheDocument()
  })
})

describe('TraceRunner: no retry path once a checkpoint is committed', () => {
  it('two click events on the same choice, dispatched synchronously in one batch, only record the result once', () => {
    const handleCheckpointAnswered = vi.fn()
    useTraceSessionMock.mockReturnValue(makeSession({ handleCheckpointAnswered }))
    render(<TraceRunner />)
    clickNext(1) // var-value checkpoint pause, correct index is 1 ("1")

    // choices ['0', '1', '2'], correct index 1 ("1") — "0" is wrong. Both
    // events are dispatched before React commits the first click's
    // `disabled` update, so only CheckpointPanel's internal guard (not the
    // browser refusing a click on an already-disabled button) can be what
    // stops the second commit here.
    const wrongButton = screen.getByRole('button', { name: '0' })
    dispatchTwoClicksInOneBatch(wrongButton)

    expect(handleCheckpointAnswered).toHaveBeenCalledTimes(1)
    expect(handleCheckpointAnswered).toHaveBeenCalledWith(
      expect.objectContaining({ correct: false }),
    )
  })

  it('answering incorrectly then attempting to answer again (once disabled has flushed) does not change the recorded result', () => {
    const handleCheckpointAnswered = vi.fn()
    useTraceSessionMock.mockReturnValue(makeSession({ handleCheckpointAnswered }))
    render(<TraceRunner />)
    clickNext(1) // var-value checkpoint pause, correct index is 1 ("1")

    // choices ['0', '1', '2'], correct index 1 ("1") — "0" is wrong.
    const wrongButton = screen.getByRole('button', { name: '0' })

    fireEvent.click(wrongButton)
    expect(handleCheckpointAnswered).toHaveBeenCalledTimes(1)
    expect(handleCheckpointAnswered).toHaveBeenCalledWith(
      expect.objectContaining({ correct: false }),
    )
    expect(wrongButton).toBeDisabled()

    // Attempt to "retry" by clicking the same (now-disabled) choice again,
    // and every other rendered choice too — none of them may fire a second
    // commit, so the first (failing) result stands as the only recorded one.
    for (const button of document.querySelectorAll<HTMLButtonElement>('.checkpoint-choice')) {
      fireEvent.click(button)
    }

    expect(handleCheckpointAnswered).toHaveBeenCalledTimes(1)
    expect(handleCheckpointAnswered).toHaveBeenCalledWith(
      expect.objectContaining({ correct: false }),
    )
  })
})

describe('TraceRunner solve screen', () => {
  it('shows the correct feedback panel and calls handleContinue', () => {
    const handleContinue = vi.fn()
    useTraceSessionMock.mockReturnValue(
      makeSession({
        checkpointResults: [
          { correct: true, choiceIndex: 1 },
          { correct: true, choiceIndex: 0 },
          { correct: true, choiceIndex: 1 },
        ],
        isComplete: true,
        solved: true,
        ratingDelta: 15,
        handleContinue,
      }),
    )
    render(<TraceRunner />)

    expect(screen.getByText(/Nice/)).toBeInTheDocument()
    expect(screen.getByText('+15')).toBeInTheDocument()
    expect(screen.getByText(puzzle.explanation)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(handleContinue).toHaveBeenCalledTimes(1)
  })

  it('shows the wrong-verdict feedback panel when the attempt was not fully correct', () => {
    useTraceSessionMock.mockReturnValue(
      makeSession({
        checkpointResults: [
          { correct: false, choiceIndex: 0 },
          { correct: true, choiceIndex: 0 },
          { correct: true, choiceIndex: 1 },
        ],
        isComplete: true,
        solved: false,
        ratingDelta: -8,
      }),
    )
    render(<TraceRunner />)

    expect(screen.getByText('Not quite')).toBeInTheDocument()
    expect(screen.getByText('-8')).toBeInTheDocument()
  })
})

describe('TraceRunnerPuzzle: per-checkpoint clock (Phase 5b Item 6)', () => {
  // Checkpoint 0 sits at afterStep 1, not 0 — so stepIndex 0 exists as a
  // real place to scrub back to (pausing the clock) before returning to
  // stepIndex 1 (resuming it), which the pause/resume tests below exercise
  // for real via the actual Previous/Next step buttons rather than only
  // through props.
  const timerPuzzle: ScrubberPuzzle = {
    id: 'trace-timer-001',
    pattern: 'off-by-one',
    difficulty_rating: 1200,
    explanation: 'n/a',
    prompt: 'n/a',
    language: 'javascript',
    snippet: 'let x = 0\nx = x + 1\nx = x + 1',
    interaction: 'scrubber',
    steps: [
      { line: 0, vars: { x: '0' } },
      { line: 1, vars: { x: '1' } },
      { line: 2, vars: { x: '2' } },
    ],
    checkpoints: [
      { afterStep: 1, question: 'var-value', target: 'x', choices: ['0', '1'], correct: 1 },
    ],
  }

  function renderTimerPuzzle(
    onCheckpointAnswered: (result: CheckpointResult) => void,
    timed = true,
  ) {
    return render(
      <TraceRunnerPuzzle
        puzzle={timerPuzzle}
        checkpointResults={[]}
        isComplete={false}
        solved={null}
        ratingDelta={null}
        onCheckpointAnswered={onCheckpointAnswered}
        onContinue={vi.fn()}
        timed={timed}
      />,
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reaching the clock reports a normal CheckpointResult with choiceIndex null — no third state', () => {
    const onCheckpointAnswered = vi.fn()
    renderTimerPuzzle(onCheckpointAnswered)

    // Reach the pending checkpoint (afterStep 1) first — it isn't active
    // at mount (stepIndex 0).
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))

    act(() => {
      vi.advanceTimersByTime(TRACE_CHECKPOINT_TIME_LIMIT_MS)
    })

    expect(onCheckpointAnswered).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
  })

  it('passing timed={false} (the /puzzle/:id shared-link case) never fires a timeout, however long it sits unanswered', () => {
    const onCheckpointAnswered = vi.fn()
    renderTimerPuzzle(onCheckpointAnswered, false)

    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    act(() => {
      vi.advanceTimersByTime(TRACE_CHECKPOINT_TIME_LIMIT_MS * 10)
    })

    expect(onCheckpointAnswered).not.toHaveBeenCalled()
  })

  it('is not active at all before the checkpoint is reached — no timeout however long stepIndex 0 sits', () => {
    const onCheckpointAnswered = vi.fn()
    renderTimerPuzzle(onCheckpointAnswered)

    // Never navigates to the checkpoint's step — the clock has nothing to
    // run yet.
    act(() => {
      vi.advanceTimersByTime(TRACE_CHECKPOINT_TIME_LIMIT_MS * 10)
    })

    expect(onCheckpointAnswered).not.toHaveBeenCalled()
  })

  it('scrubbing away from the pending checkpoint pauses its clock — no timeout even well past the limit while away', () => {
    const onCheckpointAnswered = vi.fn()
    renderTimerPuzzle(onCheckpointAnswered)

    fireEvent.click(screen.getByRole('button', { name: 'Next step' })) // -> stepIndex 1, checkpoint active
    act(() => {
      vi.advanceTimersByTime(TRACE_CHECKPOINT_TIME_LIMIT_MS / 2) // half the budget spent
    })
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' })) // -> stepIndex 0, paused

    act(() => {
      vi.advanceTimersByTime(TRACE_CHECKPOINT_TIME_LIMIT_MS * 5) // well past the limit while away
    })

    expect(onCheckpointAnswered).not.toHaveBeenCalled()
  })

  it('resuming the same still-pending checkpoint does not grant a fresh clock — only the elapsed ACTIVE time carries over', () => {
    const onCheckpointAnswered = vi.fn()
    renderTimerPuzzle(onCheckpointAnswered)

    fireEvent.click(screen.getByRole('button', { name: 'Next step' })) // -> stepIndex 1, checkpoint active
    act(() => {
      vi.advanceTimersByTime(TRACE_CHECKPOINT_TIME_LIMIT_MS - 500) // ~500ms left
    })
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' })) // paused, away for a long time
    act(() => {
      vi.advanceTimersByTime(TRACE_CHECKPOINT_TIME_LIMIT_MS * 3)
    })
    expect(onCheckpointAnswered).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Next step' })) // resume — should have ~500ms left, not a fresh 30s
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onCheckpointAnswered).not.toHaveBeenCalled() // not yet — only 200 of the ~500ms remaining spent

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onCheckpointAnswered).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
  })
})
