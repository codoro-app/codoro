import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavRail } from './NavRail'

describe('NavRail', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/practice')
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('is a real link to /daily (not a click handler)', () => {
    render(<NavRail />)
    expect(screen.getByRole('link', { name: 'Daily' })).toHaveAttribute('href', '/daily')
  })

  it('navigates to /rush when Rush is clicked', async () => {
    const user = userEvent.setup()
    render(<NavRail />)

    await user.click(screen.getByRole('link', { name: 'Rush' }))
    expect(window.location.pathname).toBe('/rush')
  })

  it('marks the active route with aria-current="page"', () => {
    render(<NavRail />)
    expect(screen.getByRole('link', { name: 'Practice' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Daily' })).not.toHaveAttribute('aria-current')
  })

  it('renders the Codoro logo/wordmark, linking home', () => {
    render(<NavRail />)
    expect(screen.getByText('Codoro')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
  })

  it('starts expanded by default and collapses on toggle click', async () => {
    const user = userEvent.setup()
    render(<NavRail />)

    expect(screen.getByText('Codoro')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))

    expect(screen.queryByText('Codoro')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Practice' })).toBeInTheDocument()
  })

  it('persists the collapsed preference to localStorage and restores it on remount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<NavRail />)
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    expect(localStorage.getItem('codoro:nav-rail-collapsed')).toBe('1')
    unmount()

    render(<NavRail />)
    expect(screen.queryByText('Codoro')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument()
  })
})
