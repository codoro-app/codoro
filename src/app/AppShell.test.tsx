import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('labels the main landmark with the active route, and does not steal focus on initial render', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Practice')
    expect(document.activeElement).not.toBe(screen.getByRole('main'))
  })

  it('a Link-driven navigation moves focus to <main> and resets scroll to top', async () => {
    const user = userEvent.setup()
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )

    await user.click(nth(screen.getAllByRole('link', { name: 'Daily' }), 0))

    expect(document.activeElement).toBe(screen.getByRole('main'))
    expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Daily')
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 })

    scrollToSpy.mockRestore()
  })

  it('a back/forward (popstate) navigation moves focus but does not reset scroll — the browser restores it', async () => {
    const user = userEvent.setup()
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )

    // Real history entry (via the Link click's pushState), so history.back()
    // below is a genuine back navigation — not another synthetic pushState —
    // and fires a native popstate event the same way a real back-button
    // press would, with no pushState/replaceState involved.
    await user.click(nth(screen.getAllByRole('link', { name: 'Daily' }), 0))
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 })
    scrollToSpy.mockClear()
    screen.getByRole('main').blur()

    window.history.back()
    await waitFor(() => {
      expect(window.location.pathname).toBe('/practice')
    })

    expect(scrollToSpy).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('main'))

    scrollToSpy.mockRestore()
  })
})
