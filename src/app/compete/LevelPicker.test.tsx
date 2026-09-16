import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LevelPicker } from './LevelPicker'

describe('LevelPicker', () => {
  it('calls onSelect with the clicked tier', async () => {
    const onSelect = vi.fn()
    render(<LevelPicker onSelect={onSelect} onBack={vi.fn()} />)
    await userEvent.click(screen.getByText('Sharp'))
    expect(onSelect).toHaveBeenCalledWith('sharp')
  })

  it('calls onBack when Back is clicked', async () => {
    const onBack = vi.fn()
    render(<LevelPicker onSelect={vi.fn()} onBack={onBack} />)
    await userEvent.click(screen.getByText('← Back'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('renders all four tiers', () => {
    render(<LevelPicker onSelect={vi.fn()} onBack={vi.fn()} />)
    for (const label of ['Novice', 'Steady', 'Sharp', 'Elite']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
