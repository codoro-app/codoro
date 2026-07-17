import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PuzzleCardShell } from './PuzzleCardShell'
import type { McqPuzzle, SwipeBinaryPuzzle, TapLinePuzzle } from '../../content'
import { nth } from '../../test/nth'

const mcqPuzzle: McqPuzzle = {
  id: 'cf-001',
  pattern: 'control-flow',
  difficulty_rating: 1100,
  explanation: 'Missing break causes fall-through into the silver case.',
  prompt: "What's the bug in this discount calculator?",
  language: 'javascript',
  snippet: "switch (tier) {\n  case 'gold':\n    discount = 20;\n}",
  interaction: 'mcq',
  choices: ['Missing break after gold', 'Wrong order', 'Should use const', 'Should use if/else'],
  correct_choice: 0,
}

const swipePuzzle: SwipeBinaryPuzzle = {
  id: 'con-001',
  pattern: 'concurrency',
  difficulty_rating: 2000,
  explanation: 'count++ is not atomic.',
  prompt: 'Is this safe?',
  language: 'java',
  snippet: 'count++;',
  interaction: 'swipe-binary',
  left_label: 'Thread-safe',
  right_label: 'Race condition',
  correct_direction: 'right',
}

const tapLinePuzzle: TapLinePuzzle = {
  id: 'cf-002',
  pattern: 'control-flow',
  difficulty_rating: 1600,
  explanation: 'The break only exits the inner loop.',
  prompt: 'Tap the line responsible for the bug.',
  language: 'javascript',
  snippet: 'for (let i = 0; i < 3; i++) {\n  console.log(i)\n  break\n}',
  interaction: 'tap-line',
  correct_line: 2,
}

describe('PuzzleCardShell', () => {
  it('renders the prompt and a static syntax-highlighted snippet for mcq puzzles', () => {
    const { container } = render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.getByText(mcqPuzzle.prompt)).toBeInTheDocument()
    // Static snippet view: line content present (split across highlight
    // token spans, so check textContent rather than a single text node),
    // and not rendered as tap targets.
    expect(container.querySelector('.code-snippet')?.textContent).toContain("case 'gold':")
    expect(screen.queryAllByRole('button', { name: /^Line \d/ })).toHaveLength(0)
  })

  it('does not render a feedback panel before commit', () => {
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={5}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('mcq: commit -> calls onAnswered once, shows feedback with delta + explanation, Continue calls onContinue', async () => {
    const onAnswered = vi.fn()
    const onContinue = vi.fn()
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={12}
        onAnswered={onAnswered}
        onContinue={onContinue}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))

    expect(onAnswered).toHaveBeenCalledTimes(1)
    expect(onAnswered).toHaveBeenCalledWith({ correct: true, choiceIndex: 0 })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Nice — correct')).toBeInTheDocument()
    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText(mcqPuzzle.explanation)).toBeInTheDocument()

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    await user.click(continueButton)
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('mcq: wrong answer shows "Not quite" and a negative delta', async () => {
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={-9}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Wrong order' }))

    expect(screen.getByText('Not quite')).toBeInTheDocument()
    expect(screen.getByText('-9')).toBeInTheDocument()
  })

  it('renders no delta text when ratingDelta is null', async () => {
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/^[+-]\d+$/)).not.toBeInTheDocument()
  })

  it('swipe-binary: renders the fallback buttons and commits through to feedback', async () => {
    const onAnswered = vi.fn()
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={swipePuzzle}
        ratingDelta={7}
        onAnswered={onAnswered}
        onContinue={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Race condition' }))

    expect(onAnswered).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    expect(screen.getByText('Nice — correct')).toBeInTheDocument()
  })

  it('tap-line: renders the snippet as tap targets (no separate static snippet) and commits on line tap', async () => {
    const onAnswered = vi.fn()
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={tapLinePuzzle}
        ratingDelta={3}
        onAnswered={onAnswered}
        onContinue={vi.fn()}
      />,
    )

    const lineButtons = screen.getAllByRole('button')
    expect(lineButtons).toHaveLength(4)

    await user.click(nth(lineButtons, 2))

    expect(onAnswered).toHaveBeenCalledWith({ correct: true, choiceIndex: 2 })
    expect(screen.getByText('Nice — correct')).toBeInTheDocument()
  })

  it('resets committed state when the puzzle prop changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={12}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))
    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(
      <PuzzleCardShell
        puzzle={swipePuzzle}
        ratingDelta={7}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thread-safe' })).toBeInTheDocument()
  })

  it('ignores a second onAnswered-triggering commit once already committed', async () => {
    const onAnswered = vi.fn()
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={12}
        onAnswered={onAnswered}
        onContinue={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))
    expect(onAnswered).toHaveBeenCalledTimes(1)
    // Choices are disabled post-commit; nothing left to click that would
    // re-trigger onCommit, confirming the shell's guard + the body's own
    // disabled state agree.
    for (const button of screen.getAllByRole('button', { name: /break|order|const|if\/else/ })) {
      expect(button).toBeDisabled()
    }
  })
})
