import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
})
