import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from './AppShell'
import { nth } from '../test/nth'

describe('AppShell', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/practice')
  })

  it('renders both the mobile ModeSwitcher and the desktop NavRail (visibility is CSS-only)', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    // `hidden: true` on both queries below: both navs are always mounted —
    // only CSS (media queries) decides which is visible at a given
    // viewport — and jsdom's own default viewport width happens to sit
    // exactly on this shell's 1024px breakpoint, making CSS-computed
    // accessibility-tree visibility here nondeterministic across runs.
    // These assertions are about DOM structure ("both navs exist"), not
    // about which one a real browser would currently show, so they
    // deliberately opt out of visibility filtering instead of depending on
    // that timing.
    expect(screen.getAllByRole('navigation', { name: 'Mode', hidden: true }).length).toBe(2)
    expect(screen.getAllByRole('link', { name: 'Practice', hidden: true }).length).toBe(2)
  })

  it('renders children inside the shell content region', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    expect(screen.getByText('page content')).toBeInTheDocument()
  })

  it('the Daily link from either nav navigates to /daily', async () => {
    const user = userEvent.setup()
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    await user.click(nth(screen.getAllByRole('link', { name: 'Daily' }), 0))
    expect(window.location.pathname).toBe('/daily')
  })

  it('the logo/brand links home from either the mobile bar or the desktop rail', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    const homeLinks = screen.getAllByRole('link', { name: 'Home', hidden: true })
    expect(homeLinks.length).toBe(2)
    homeLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/')
    })
  })

  it('the footer link goes to /legal', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    expect(screen.getByRole('link', { name: 'Legal' })).toHaveAttribute('href', '/legal')
  })
})
