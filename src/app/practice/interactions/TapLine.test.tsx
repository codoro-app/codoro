import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { TapLine } from './TapLine'
import type { TapLinePuzzle } from '../../../content'
import type { CommitPayload } from '../interactionTypes'
import { nth } from '../../../test/nth'

const puzzle: TapLinePuzzle = {
  id: 'cf-002',
  pattern: 'control-flow',
  difficulty_rating: 1600,
  explanation: 'The break only exits the inner loop.',
  prompt: 'Tap the line responsible for the bug.',
  language: 'javascript',
  snippet:
    'function findFirstPair(matrix, target) {\n  let result = null\n  for (let i = 0; i < matrix.length; i++) {\n    for (let j = 0; j < matrix[i].length; j++) {\n      if (matrix[i][j] === target) {\n        result = [i, j]\n        break\n      }\n    }\n  }\n  return result\n}',
  interaction: 'tap-line',
  correct_line: 6,
}

function Harness({ onCommit }: { onCommit?: (p: CommitPayload) => void }) {
  const [committed, setCommitted] = useState(false)
  const [payload, setPayload] = useState<CommitPayload | undefined>(undefined)
  return (
    <TapLine
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

describe('TapLine', () => {
  it('renders one tap target per snippet line', () => {
    render(<Harness />)
    expect(screen.getAllByRole('button')).toHaveLength(puzzle.snippet.split('\n').length)
  })

  it('commits correct: true with the tapped line index when the correct line is tapped', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(nth(screen.getAllByRole('button'), 6))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: 6 })
  })

  it('marks a wrongly-tapped line as wrong and reveals the real bug line as correct', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness />)

    await user.click(nth(screen.getAllByRole('button'), 1))

    // Once committed, lines are no longer buttons (see the next test), so
    // read their state off the line elements directly.
    const lines = container.querySelectorAll('.code-snippet__line')
    expect(nth(Array.from(lines), 1).className).toContain('wrong')
    expect(nth(Array.from(lines), 6).className).toContain('reveal-correct')
  })

  it('stops being clickable once committed', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(nth(screen.getAllByRole('button'), 6))
    expect(onCommit).toHaveBeenCalledTimes(1)

    // After commit, lines render as plain (non-interactive) elements, so
    // there should be no more clickable buttons.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
