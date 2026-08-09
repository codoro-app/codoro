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

  it('points at the in-app Settings export/import (Phase 7) and names challenge links + the anonymous ID', () => {
    render(<LegalPage />)
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.getByText(/anonymous id/i)).toBeInTheDocument()
    expect(screen.getByText(/challenge a friend/i)).toBeInTheDocument()
  })
})
