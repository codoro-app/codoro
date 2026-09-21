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

  // Phase 5.6 update: the Privacy section now explicitly describes account creation
  // (optional, Clerk-backed), data sync (D1 for signed-in players), and data deletion.
  it('describes account creation, data sync, and deletion accurately after Phase 5.1 shipped real accounts + sync', () => {
    render(<LegalPage />)
    expect(screen.getByText(/signing in is optional/i)).toBeInTheDocument()
    expect(screen.getByText(/our authentication provider/i)).toBeInTheDocument()
    expect(screen.getByText(/collects an email address/i)).toBeInTheDocument()
    expect(screen.getByText(/sync to a server.*cloudflare d1/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/^codoro has no accounts and collects no personal information\./i),
    ).not.toBeInTheDocument()
  })

  it('discloses that signed-in usage events are linked to the account by Clerk user ID, never email (PR #153)', () => {
    render(<LegalPage />)
    expect(
      screen.getByText(/linked to your account instead of staying anonymous/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/clerk's internal user id only, never your email/i)).toBeInTheDocument()
  })

  it('names the feedback form, hosted by Tally, with an optional email used only for product updates', () => {
    render(<LegalPage />)
    expect(
      screen.getByText(/feedback form\. the feedback link opens a form hosted by tally/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/never sold, never added to a mailing list/i)).toBeInTheDocument()
  })

  it('discloses the new post-challenge email opt-in list and names Resend as the sub-processor', () => {
    render(<LegalPage />)
    expect(
      screen.getByText(/email list\. on the screen shown after a challenge finishes/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Resend' })).toHaveAttribute(
      'href',
      'https://resend.com/legal/privacy-policy',
    )
    expect(screen.getByText(/every email sent includes an unsubscribe link/i)).toBeInTheDocument()
  })
})
