import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComboSurge } from './ComboSurge'
import type { Outcome } from './feel'

const OUTCOME: Extract<Outcome, { kind: 'correct' }> = {
  kind: 'correct',
  level: 1,
  newCombo: 3,
  newShields: 1,
  surge: true,
  tier: 'novice',
}

describe('ComboSurge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is a non-blocking status region showing the combo count', () => {
    render(<ComboSurge outcome={OUTCOME} isNewBest={false} onDismiss={vi.fn()} />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('3')
  })

  it('shows "+1 shield" when this surge banked one', () => {
    render(
      <ComboSurge outcome={{ ...OUTCOME, newShields: 1 }} isNewBest={false} onDismiss={vi.fn()} />,
    )
    expect(screen.getByText(/shield/i)).toBeInTheDocument()
  })

  it('shows "New best" when isNewBest', () => {
    render(<ComboSurge outcome={OUTCOME} isNewBest onDismiss={vi.fn()} />)
    expect(screen.getByText(/new best/i)).toBeInTheDocument()
  })

  it('auto-dismisses after ~1600ms', () => {
    const onDismiss = vi.fn()
    render(<ComboSurge outcome={OUTCOME} isNewBest={false} onDismiss={onDismiss} />)
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders no buttons — dismissal is time-only, not user-initiated', () => {
    render(<ComboSurge outcome={OUTCOME} isNewBest={false} onDismiss={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
