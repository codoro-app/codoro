import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PATTERN_LABELS, PATTERN_SLUGS } from '../../content'
import { PatternPicker } from './PatternPicker'

describe('PatternPicker', () => {
  it('renders every pattern label plus a "practice all patterns" option', () => {
    render(<PatternPicker onSelect={vi.fn()} onBack={vi.fn()} />)
    for (const slug of PATTERN_SLUGS) {
      expect(screen.getByText(PATTERN_LABELS[slug])).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /practice all patterns/i })).toBeInTheDocument()
  })

  it('calls onSelect(null) for "practice all patterns"', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<PatternPicker onSelect={onSelect} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /practice all patterns/i }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('calls onSelect(slug) when a specific pattern is picked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<PatternPicker onSelect={onSelect} onBack={vi.fn()} />)
    await user.click(screen.getByText(PATTERN_LABELS['off-by-one']))
    expect(onSelect).toHaveBeenCalledWith('off-by-one')
  })

  it('calls onBack when the back control is used', async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(<PatternPicker onSelect={vi.fn()} onBack={onBack} />)
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
