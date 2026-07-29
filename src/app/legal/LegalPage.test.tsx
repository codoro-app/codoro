import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LegalPage } from './LegalPage'

describe('LegalPage', () => {
  it('shows what data is collected and the contact address', () => {
    render(<LegalPage />)
    expect(screen.getByText(/anonymous usage events/i)).toBeInTheDocument()
    expect(screen.getByText(/local storage/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'codoroapp@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:codoroapp@gmail.com',
    )
  })

  it('links back to / (Back)', () => {
    render(<LegalPage />)
    expect(screen.getByRole('link', { name: '← Back' })).toHaveAttribute('href', '/')
  })
})
