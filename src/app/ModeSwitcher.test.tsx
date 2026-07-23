import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModeSwitcher } from './ModeSwitcher'

describe('ModeSwitcher', () => {
  it('calls onChange with "rush" when the Rush tab is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ModeSwitcher mode="practice" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Rush' }))
    expect(onChange).toHaveBeenCalledWith('rush')
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
