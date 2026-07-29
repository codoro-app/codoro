import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PATTERN_LABELS, PATTERN_SLUGS } from '../../content'
import type { Attempt } from '../../storage'

const listAttemptsMock = vi.fn<() => Promise<Attempt[]>>()

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return { ...actual, listAttempts: listAttemptsMock }
})

const { PatternPicker } = await import('./PatternPicker')

describe('PatternPicker', () => {
  it('renders every pattern label plus a "practice all patterns" option', () => {
    listAttemptsMock.mockResolvedValue([])
    render(<PatternPicker onSelect={vi.fn()} onBack={vi.fn()} />)
    for (const slug of PATTERN_SLUGS) {
      expect(screen.getByText(PATTERN_LABELS[slug])).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /practice all patterns/i })).toBeInTheDocument()
  })

  it('calls onSelect(null) for "practice all patterns"', async () => {
    listAttemptsMock.mockResolvedValue([])
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<PatternPicker onSelect={onSelect} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /practice all patterns/i }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('calls onSelect(slug) when a specific pattern is picked', async () => {
    listAttemptsMock.mockResolvedValue([])
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<PatternPicker onSelect={onSelect} onBack={vi.fn()} />)
    await user.click(screen.getByText(PATTERN_LABELS['off-by-one']))
    expect(onSelect).toHaveBeenCalledWith('off-by-one')
  })

  it('calls onBack when the back control is used', async () => {
    listAttemptsMock.mockResolvedValue([])
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(<PatternPicker onSelect={vi.fn()} onBack={onBack} />)
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('renders a "not enough data" badge and 0/5 · new caption before attempt history resolves', () => {
    listAttemptsMock.mockResolvedValue([])
    render(<PatternPicker onSelect={vi.fn()} onBack={vi.fn()} />)
    const card = screen.getByText(PATTERN_LABELS['off-by-one']).closest('button')
    expect(card).not.toBeNull()
    expect(card).toHaveTextContent(/not enough data/i)
    expect(card).toHaveTextContent('0/5 · new')
  })

  it('renders an accuracy badge and mastered caption once mastery data resolves', async () => {
    listAttemptsMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `oob-${String(i)}`,
        puzzleId: 'oob-001',
        puzzleRating: 1200,
        mode: 'practice' as const,
        correct: true,
        time_ms: 1000,
        choice_index: null,
        checkpoint_results: null,
        userRatingBefore: 1200,
        userRatingAfter: 1200,
        localDateString: '2026-07-17',
        createdAt: '2026-07-17T00:00:00.000Z',
      })),
    )
    render(<PatternPicker onSelect={vi.fn()} onBack={vi.fn()} />)
    const card = await screen.findByText('100%')
    const button = card.closest('button')
    expect(button).toHaveTextContent('5/5 · mastered')
  })
})
