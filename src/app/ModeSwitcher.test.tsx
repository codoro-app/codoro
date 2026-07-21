import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModeSwitcher } from './ModeSwitcher'

describe('ModeSwitcher', () => {
  it('shows a disabled Rush slot that does not call onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ModeSwitcher mode="practice" onChange={onChange} />)

    const rush = screen.getByRole('button', { name: /rush/i })
    expect(rush).toBeDisabled()
    await user.click(rush)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('marks the active mode with aria-pressed', () => {
    render(<ModeSwitcher mode="daily" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Daily' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Practice' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
