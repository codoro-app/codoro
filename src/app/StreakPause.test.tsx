import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StreakPause } from './StreakPause'

describe('StreakPause', () => {
  it('shows the streak count, no best-streak badge when not a new best, and both exit buttons', () => {
    render(
      <StreakPause streak={5} isNewBest={false} onKeepGoing={vi.fn()} onDoneForNow={vi.fn()} />,
    )

    expect(screen.getByText('5 in a row')).toBeInTheDocument()
    expect(screen.queryByText('New best streak')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep going' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done for now' })).toBeInTheDocument()
  })

  it('shows the new-best badge when isNewBest is true', () => {
    render(
      <StreakPause streak={10} isNewBest={true} onKeepGoing={vi.fn()} onDoneForNow={vi.fn()} />,
    )
    expect(screen.getByText('New best streak')).toBeInTheDocument()
  })

  it('calls onKeepGoing when "Keep going" is pressed, and onDoneForNow when "Done for now" is pressed', async () => {
    const onKeepGoing = vi.fn()
    const onDoneForNow = vi.fn()
    const user = userEvent.setup()
    render(
      <StreakPause
        streak={5}
        isNewBest={false}
        onKeepGoing={onKeepGoing}
        onDoneForNow={onDoneForNow}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Keep going' }))
    expect(onKeepGoing).toHaveBeenCalledTimes(1)
    expect(onDoneForNow).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Done for now' }))
    expect(onDoneForNow).toHaveBeenCalledTimes(1)
  })

  it('renders as a labeled, modal dialog for assistive tech', () => {
    render(
      <StreakPause streak={5} isNewBest={false} onKeepGoing={vi.fn()} onDoneForNow={vi.fn()} />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Streak milestone' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })
})
