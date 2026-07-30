import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CheckpointPanel } from './CheckpointPanel'
import type { ScrubberPuzzle } from '../../content'

/**
 * Dispatches two raw native `click` events on `element` inside a *single*
 * `act()` call, with no intervening flush between them — unlike two
 * separate `fireEvent.click(...)` calls (each of which is individually
 * wrapped in its own `act()` by testing-library and so fully commits,
 * including the `disabled` DOM attribute, before the next one runs), this
 * reproduces two click events landing in the same React batch before any
 * re-render. That's the only way to prove `CheckpointPanel`'s internal
 * `lockedRef` guard (not the `disabled` attribute, which isn't live yet at
 * the moment the second event is dispatched) is what stops the second
 * commit — confirmed by probing this exact harness against the production
 * component with the guard temporarily removed, which raises the resulting
 * call count from 1 to 2.
 */
function dispatchTwoClicksInOneBatch(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const steps: ScrubberPuzzle['steps'] = [
  { line: 0, vars: { x: '0' } },
  { line: 1, vars: { x: '1' } },
  { line: 2, vars: { x: '1' }, output: 'one' },
  { line: 3, vars: { x: '6' } },
  { line: 4, vars: { x: '6' }, output: 'six' },
]

const varValueCheckpoint: ScrubberPuzzle['checkpoints'][number] = {
  afterStep: 1,
  question: 'var-value',
  target: 'x',
  choices: ['0', '1', '2'],
  correct: 1,
}

const outputCheckpoint: ScrubberPuzzle['checkpoints'][number] = {
  afterStep: 2,
  question: 'output',
  choices: ['one', 'two', 'three'],
  correct: 0,
}

const nextLineCheckpoint: ScrubberPuzzle['checkpoints'][number] = {
  afterStep: 3,
  question: 'next-line',
  choices: ['3', '4'],
  correct: 1,
}

describe('CheckpointPanel — unanswered', () => {
  it('renders one button per choice, none disabled, no diff shown', () => {
    render(
      <CheckpointPanel
        checkpoint={varValueCheckpoint}
        steps={steps}
        result={undefined}
        onAnswer={vi.fn()}
      />,
    )
    for (const choice of varValueCheckpoint.choices) {
      expect(screen.getByRole('button', { name: choice })).not.toBeDisabled()
    }
    expect(document.querySelector('.checkpoint-diff')).not.toBeInTheDocument()
  })

  it('commits with the choice’s original index (not its shuffled position) and correctness', () => {
    const onAnswer = vi.fn()
    render(
      <CheckpointPanel
        checkpoint={varValueCheckpoint}
        steps={steps}
        result={undefined}
        onAnswer={onAnswer}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    expect(onAnswer).toHaveBeenCalledWith({ correct: true, choiceIndex: 1 })
  })

  it('two click events on the same choice, dispatched synchronously in one batch (no yield, no intervening render), only commit once', () => {
    const onAnswer = vi.fn()
    render(
      <CheckpointPanel
        checkpoint={varValueCheckpoint}
        steps={steps}
        result={undefined}
        onAnswer={onAnswer}
      />,
    )
    const button = screen.getByRole('button', { name: '0' })

    // Both events are dispatched before React has committed the first
    // click's `disabled` update to the DOM, so the browser cannot suppress
    // the second dispatch the way it would for two ordinary, separately
    // flushed clicks — only CheckpointPanel's own internal guard can stop
    // the second `onAnswer` call here. See `dispatchTwoClicksInOneBatch`'s
    // doc comment for how this was verified against the guard's removal.
    dispatchTwoClicksInOneBatch(button)

    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith({ correct: false, choiceIndex: 0 })
  })

  it('a click on a different choice after commit (once `disabled` has flushed) does not commit again', () => {
    const onAnswer = vi.fn()
    render(
      <CheckpointPanel
        checkpoint={varValueCheckpoint}
        steps={steps}
        result={undefined}
        onAnswer={onAnswer}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    expect(onAnswer).toHaveBeenCalledTimes(1)

    // `result` is still undefined here (this test's parent never updates
    // it, unlike the real session) — every choice, including ones never
    // clicked before, is disabled and unclickable regardless.
    for (const choice of varValueCheckpoint.choices) {
      fireEvent.click(screen.getByRole('button', { name: choice }))
    }
    expect(onAnswer).toHaveBeenCalledTimes(1)
  })
})

describe('CheckpointPanel — answered (reveal)', () => {
  it('var-value: colors the chosen-wrong/correct choices and shows the previous -> new value diff', () => {
    render(
      <CheckpointPanel
        checkpoint={varValueCheckpoint}
        steps={steps}
        result={{ correct: false, choiceIndex: 0 }}
        onAnswer={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '0' })).toHaveClass('checkpoint-choice--wrong')
    expect(screen.getByRole('button', { name: '1' })).toHaveClass(
      'checkpoint-choice--reveal-correct',
    )
    for (const choice of varValueCheckpoint.choices) {
      expect(screen.getByRole('button', { name: choice })).toBeDisabled()
    }

    const diff = document.querySelector('.checkpoint-diff')
    expect(diff?.textContent).toContain('0')
    expect(diff?.textContent).toContain('1')
  })

  it('output: shows the produced output text in the diff', () => {
    render(
      <CheckpointPanel
        checkpoint={outputCheckpoint}
        steps={steps}
        result={{ correct: true, choiceIndex: 0 }}
        onAnswer={vi.fn()}
      />,
    )
    expect(document.querySelector('.checkpoint-diff')?.textContent).toContain('one')
  })

  it('next-line: shows the resulting next line in the diff', () => {
    render(
      <CheckpointPanel
        checkpoint={nextLineCheckpoint}
        steps={steps}
        result={{ correct: true, choiceIndex: 1 }}
        onAnswer={vi.fn()}
      />,
    )
    // steps[4].line === 4 -> displayed 1-based as "Line 5".
    expect(document.querySelector('.checkpoint-diff')?.textContent).toContain('Line 5')
  })
})
