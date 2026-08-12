import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModeSwitcher } from './ModeSwitcher'

describe('ModeSwitcher', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/practice')
  })

  it('navigates to /rush when the Rush tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ModeSwitcher />)

    await user.click(screen.getByRole('link', { name: 'Rush' }))
    expect(window.location.pathname).toBe('/rush')
  })

  it('navigates to /boss when the Boss tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ModeSwitcher />)

    await user.click(screen.getByRole('link', { name: 'Boss' }))
    expect(window.location.pathname).toBe('/boss')
  })

  it('navigates to /trace when the Trace tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ModeSwitcher />)

    await user.click(screen.getByRole('link', { name: 'Trace' }))
    expect(window.location.pathname).toBe('/trace')
  })

  it('marks the active mode with aria-current="page"', () => {
    window.history.pushState({}, '', '/daily')
    render(<ModeSwitcher />)
    expect(screen.getByRole('link', { name: 'Daily' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Practice' })).not.toHaveAttribute('aria-current')
  })

  it('scrolls horizontally within its own bar instead of overflowing the page when tabs do not fit', () => {
    render(<ModeSwitcher />)
    expect(screen.getByRole('navigation', { name: 'Mode' })).toHaveClass('overflow-x-auto')
  })
})
