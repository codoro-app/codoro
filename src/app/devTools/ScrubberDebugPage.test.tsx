import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScrubberDebugPage } from './ScrubberDebugPage'

/**
 * Exercises the real scrubberPool (not a fixture) end-to-end through the
 * debug harness — this is the DoD's "5 pilot puzzles ... are playable on
 * the debug route" check, automated rather than only eyeballed.
 */
describe('ScrubberDebugPage', () => {
  it('lists every scrubber puzzle in the pool, including the 5 Phase 2 pilots', () => {
    render(<ScrubberDebugPage />)
    for (const id of ['oob-009', 'mut-009', 'scl-009', 'scl-010', 'tc-009']) {
      expect(screen.getByRole('button', { name: new RegExp(`\\[${id}\\]`) })).toBeInTheDocument()
    }
  })

  it('steps through a real pilot puzzle, answers every checkpoint correctly, and reports SOLVED', async () => {
    const user = userEvent.setup()
    render(<ScrubberDebugPage />)

    await user.click(screen.getByRole('button', { name: /\[oob-009\]/ }))
    expect(screen.getByText(/predict what happens/i)).toBeInTheDocument()

    // 6 "Next step" clicks reach afterStep=6, the first checkpoint (next-line).
    for (let i = 0; i < 6; i++) {
      await user.click(screen.getByRole('button', { name: 'Next step' }))
    }
    // oob-009's first checkpoint: next-line, choices ['1','2','3'], correct '3'.
    await user.click(screen.getByRole('button', { name: '3' }))

    // 3 more "Next step" clicks (6 -> 9) reach afterStep=9, the second checkpoint.
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole('button', { name: 'Next step' }))
    }
    // oob-009's second checkpoint: var-value sum, choices ['60','90','NaN'], correct 'NaN'.
    await user.click(screen.getByRole('button', { name: 'NaN' }))

    expect(screen.getByText(/=== SOLVED ===/)).toBeInTheDocument()
  })

  it('reports FAILED when a checkpoint is answered incorrectly', async () => {
    const user = userEvent.setup()
    render(<ScrubberDebugPage />)

    await user.click(screen.getByRole('button', { name: /\[oob-009\]/ }))
    for (let i = 0; i < 6; i++) {
      await user.click(screen.getByRole('button', { name: 'Next step' }))
    }
    // Answer the first checkpoint wrong on purpose.
    await user.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByText(/last answer: incorrect/)).toBeInTheDocument()

    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole('button', { name: 'Next step' }))
    }
    await user.click(screen.getByRole('button', { name: 'NaN' }))

    expect(screen.getByText(/=== FAILED ===/)).toBeInTheDocument()
  })

  it('returns to the puzzle list via "Back to puzzle list"', async () => {
    const user = userEvent.setup()
    render(<ScrubberDebugPage />)

    await user.click(screen.getByRole('button', { name: /\[oob-009\]/ }))
    expect(screen.queryByRole('button', { name: /\[oob-009\]/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to puzzle list' }))
    expect(screen.getByRole('button', { name: /\[oob-009\]/ })).toBeInTheDocument()
  })
})
