import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from './AppShell'
import { nth } from '../test/nth'

describe('AppShell', () => {
  it('renders both the mobile ModeSwitcher and the desktop NavRail (visibility is CSS-only)', () => {
    render(
      <AppShell mode="practice" onModeChange={vi.fn()}>
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
    expect(screen.getAllByRole('button', { name: 'Practice', hidden: true }).length).toBe(2)
  })

  it('renders children inside the shell content region', () => {
    render(
      <AppShell mode="practice" onModeChange={vi.fn()}>
        <p>page content</p>
      </AppShell>,
    )
    expect(screen.getByText('page content')).toBeInTheDocument()
  })

  it('forwards mode changes from either nav to onModeChange', async () => {
    const onModeChange = vi.fn()
    const user = userEvent.setup()
    render(
      <AppShell mode="practice" onModeChange={onModeChange}>
        <p>page content</p>
      </AppShell>,
    )
    await user.click(nth(screen.getAllByRole('button', { name: 'Daily' }), 0))
    expect(onModeChange).toHaveBeenCalledWith('daily')
  })

  it('opens Home when the logo/brand is clicked, from either the mobile bar or the desktop rail', async () => {
    const onModeChange = vi.fn()
    const user = userEvent.setup()
    render(
      <AppShell mode="practice" onModeChange={onModeChange}>
        <p>page content</p>
      </AppShell>,
    )
    const homeButtons = screen.getAllByRole('button', { name: 'Home', hidden: true })
    expect(homeButtons.length).toBe(2)

    await user.click(nth(homeButtons, 0))
    expect(onModeChange).toHaveBeenCalledWith('home')
  })
})
