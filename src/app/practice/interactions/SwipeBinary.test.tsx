import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { SwipeBinary } from './SwipeBinary'
import type { SwipeBinaryPuzzle } from '../../../content'
import type { CommitPayload } from '../interactionTypes'

const puzzle: SwipeBinaryPuzzle = {
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

function Harness({ onCommit }: { onCommit?: (p: CommitPayload) => void }) {
  const [committed, setCommitted] = useState(false)
  const [payload, setPayload] = useState<CommitPayload | undefined>(undefined)
  return (
    <SwipeBinary
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

describe('SwipeBinary', () => {
  it('renders the left/right labels as two buttons', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Thread-safe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Race condition' })).toBeInTheDocument()
  })

  it('commits correct: true, choiceIndex: null when the correct side is tapped', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: 'Race condition' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
  })

  it('commits correct: false when the wrong side is tapped', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: 'Thread-safe' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
  })

  it('marks the wrongly-chosen side red and reveals the correct side green', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Thread-safe' }))

    expect(screen.getByRole('button', { name: 'Thread-safe' }).className).toContain('wrong')
    expect(screen.getByRole('button', { name: 'Race condition' }).className).toContain(
      'reveal-correct',
    )
  })

  it('marks the correctly-chosen side green with no separate reveal', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Race condition' }))

    expect(screen.getByRole('button', { name: 'Race condition' }).className).toContain('correct')
    expect(screen.getByRole('button', { name: 'Thread-safe' }).className).not.toContain(
      'reveal-correct',
    )
  })

  it('disables both buttons once committed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Race condition' }))

    expect(screen.getByRole('button', { name: 'Race condition' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Thread-safe' })).toBeDisabled()
  })
})
