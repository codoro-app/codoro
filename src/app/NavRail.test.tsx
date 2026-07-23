import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavRail } from './NavRail'

describe('NavRail', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('calls onChange with the clicked mode', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<NavRail mode="practice" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Daily' }))
    expect(onChange).toHaveBeenCalledWith('daily')
  })

  it('calls onChange with "rush" when Rush is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<NavRail mode="practice" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Rush' }))
    expect(onChange).toHaveBeenCalledWith('rush')
  })

  it('renders the Codoro logo/wordmark', () => {
    render(<NavRail mode="practice" onChange={vi.fn()} />)
    expect(screen.getByText('Codoro')).toBeInTheDocument()
  })

  it('starts expanded by default and collapses on toggle click', async () => {
    const user = userEvent.setup()
    render(<NavRail mode="practice" onChange={vi.fn()} />)

    expect(screen.getByText('Codoro')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))

    expect(screen.queryByText('Codoro')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument()
  })

  it('persists the collapsed preference to localStorage and restores it on remount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<NavRail mode="practice" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    expect(localStorage.getItem('codoro:nav-rail-collapsed')).toBe('1')
    unmount()

    render(<NavRail mode="practice" onChange={vi.fn()} />)
    expect(screen.queryByText('Codoro')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument()
  })
})
