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

  // Launch instrumentation Item 4: the feedback form's optional email field
  // made the old unqualified "collects no personal information" sentence
  // false — this is a correction to existing copy, not just an addition.
  it('scopes the "no personal information" claim to the app itself, and no longer states it unqualified', () => {
    render(<LegalPage />)
    expect(screen.getByText(/the app itself collects no personal information/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/^codoro has no accounts and collects no personal information\./i),
    ).not.toBeInTheDocument()
  })

  it('names the feedback form as the one exception, hosted by Tally, with an optional email used only for product updates', () => {
    render(<LegalPage />)
    expect(screen.getByText(/the one exception is the optional feedback form/i)).toBeInTheDocument()
    expect(screen.getByText(/hosted by tally/i)).toBeInTheDocument()
    expect(screen.getByText(/never sold, never added to a mailing list/i)).toBeInTheDocument()
  })
})
