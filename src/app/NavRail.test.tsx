import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavRail } from './NavRail'

describe('NavRail', () => {
  it('calls onChange with the clicked mode', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<NavRail mode="practice" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Daily' }))
    expect(onChange).toHaveBeenCalledWith('daily')
  })

  it('renders a disabled Rush entry', () => {
    render(<NavRail mode="practice" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /rush/i })).toBeDisabled()
  })

  it('renders the Codoro logo/wordmark', () => {
    render(<NavRail mode="practice" onChange={vi.fn()} />)
    expect(screen.getByText('Codoro')).toBeInTheDocument()
  })
})
