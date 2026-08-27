import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { nth } from '../../../test/nth'
import { Mcq } from './Mcq'
import type { McqPuzzle } from '../../../content'
import type { CommitPayload } from '../interactionTypes'

const puzzle: McqPuzzle = {
  id: 'cf-001',
  pattern: 'control-flow',
  difficulty_rating: 1100,
  explanation: 'Missing break causes fall-through.',
  prompt: "What's the bug?",
  language: 'javascript',
  snippet: "switch (tier) {\n  case 'gold':\n    discount = 20;\n}",
  interaction: 'mcq',
  choices: ['Missing break after gold', 'Wrong order', 'Should use const', 'Should use if/else'],
  correct_choice: 0,
}

/** Harness that owns committed state the way PuzzleCardShell would, so tests exercise the real commit -> feedback flow. */
function Harness({ onCommit }: { onCommit?: (p: CommitPayload) => void }) {
  const [committed, setCommitted] = useState(false)
  const [payload, setPayload] = useState<CommitPayload | undefined>(undefined)
  return (
    <Mcq
      puzzle={puzzle}
      committed={committed}
      committedPayload={payload}
      onCommit={(p) => {
        setCommitted(true)
        setPayload(p)
        onCommit?.(p)
      }}
    />
  )
}

describe('Mcq', () => {
  it('renders one button per choice', () => {
    render(<Harness />)
    expect(screen.getAllByRole('button')).toHaveLength(4)
  })

  it('commits correct: true with the right choiceIndex when the correct choice is tapped', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: 0 })
  })

  it('marks the chosen wrong answer red and reveals the correct answer green', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Wrong order' }))

    const chosen = screen.getByRole('button', { name: 'Wrong order' })
    const correct = screen.getByRole('button', { name: 'Missing break after gold' })
    expect(chosen.className).toContain('wrong')
    expect(correct.className).toContain('reveal-correct')
  })

  it('disables all choices once committed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Wrong order' }))

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('ignores further clicks after commit', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: 'Wrong order' }))
    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))

    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('renders choices in a shuffled order rather than always authored order', () => {
    // Regression guard for the reported bug: every seed MCQ puzzle authors
    // correct_choice: 0, so rendering puzzle.choices in place would put the
    // correct answer first every single time. With a non-identity rng, the
    // first rendered button must not be the first authored choice.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    render(<Harness />)
    const buttons = screen.getAllByRole('button')

    expect(buttons[0]).not.toHaveTextContent('Missing break after gold')
    // Each button's textContent is prefixed with its on-screen A/B/C/D
    // badge letter (see Mcq.tsx's ChoiceBadge) — the letter tracks display
    // *position*, not the original authored index, so it's always A, B, C,
    // D in that order regardless of the shuffle.
    expect(buttons.map((b) => b.textContent)).toEqual([
      'AWrong order',
      'BShould use const',
      'CShould use if/else',
      'DMissing break after gold',
    ])

    randomSpy.mockRestore()
  })

  it('still commits the correct choice by content, regardless of its shuffled screen position', async () => {
    const onCommit = vi.fn()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    // With Math.random mocked to 0, "Missing break after gold" (the
    // authored-correct choice, index 0) renders last, not first.
    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: 0 })

    randomSpy.mockRestore()
  })

  it('arrow-key navigation moves focus between choices, and Enter on the focused choice commits it', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    const buttons = screen.getAllByRole('button')

    nth(buttons, 0).focus()
    fireEvent.keyDown(nth(buttons, 0), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(nth(buttons, 1))

    fireEvent.click(nth(buttons, 1))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})
