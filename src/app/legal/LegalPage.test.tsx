import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LegalPage } from './LegalPage'

describe('LegalPage', () => {
  it('shows what data is collected and the contact address', () => {
    render(<LegalPage onNavigate={vi.fn()} />)
    expect(screen.getByText(/anonymous usage events/i)).toBeInTheDocument()
    expect(screen.getByText(/local storage/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'codoroapp@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:codoroapp@gmail.com',
    )
  })

  it('navigates home when Back is clicked', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<LegalPage onNavigate={onNavigate} />)

    await user.click(screen.getByRole('button', { name: '← Back' }))
    expect(onNavigate).toHaveBeenCalledWith('home')
  })
})
