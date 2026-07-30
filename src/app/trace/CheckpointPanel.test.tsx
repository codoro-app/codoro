import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CheckpointPanel } from './CheckpointPanel'
import type { ScrubberPuzzle } from '../../content'

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

  it('a second click on any choice before `result` updates does not commit again (synchronous lock)', () => {
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
    // it) — exactly the window between commit and the real session's
    // re-render this lock exists to cover.
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
