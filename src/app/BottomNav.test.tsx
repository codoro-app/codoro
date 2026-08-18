import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BottomNav } from './BottomNav'

describe('BottomNav', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/practice')
  })

  it('navigates to /daily when the Daily tab is clicked', async () => {
    const user = userEvent.setup()
    render(<BottomNav />)

    await user.click(screen.getByRole('link', { name: 'Daily' }))
    expect(window.location.pathname).toBe('/daily')
  })

  it('navigates to /stats when the Stats tab is clicked', async () => {
    const user = userEvent.setup()
    render(<BottomNav />)

    await user.click(screen.getByRole('link', { name: 'Stats' }))
    expect(window.location.pathname).toBe('/stats')
  })

  it('the Home tab links to /', () => {
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
  })

  it('marks the active route with aria-current="page"', () => {
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Practice' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Daily' })).not.toHaveAttribute('aria-current')
  })

  it('is a landmark named "Primary", distinct from NavRail\'s "Mode" landmark', () => {
    render(<BottomNav />)
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })
})
