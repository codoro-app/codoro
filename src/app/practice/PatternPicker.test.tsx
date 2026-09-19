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

describe('PatternPicker — mastery grouping (redesign Phase 4)', () => {
  /** N attempts against one real puzzle id, `correctCount` of them correct — enough to clear MIN_ATTEMPTS_FOR_MASTERY (5) and produce a real accuracy. */
  function makeAttempts(puzzleId: string, correctCount: number, total = 5): Attempt[] {
    return Array.from({ length: total }, (_, i) => ({
      id: `${puzzleId}-${String(i)}`,
      puzzleId,
      puzzleRating: 1200,
      mode: 'practice' as const,
      correct: i < correctCount,
      time_ms: 1000,
      choice_index: null,
      checkpoint_results: null,
      userRatingBefore: 1200,
      userRatingAfter: 1200,
      localDateString: '2026-09-18',
      createdAt: '2026-09-18T00:00:00.000Z',
    }))
  }

  function sectionHeadings(): string[] {
    return screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
  }

  it('groups mixed mastery data into in-progress (weakest first) / not-started / mastered', async () => {
    listAttemptsMock.mockResolvedValue([
      ...makeAttempts('oob-001', 5), // off-by-one: 100% -> mastered
      ...makeAttempts('tc-001', 3), // type-coercion: 60% -> learning
      ...makeAttempts('scl-001', 1), // scope-closures: 20% -> weak
      ...makeAttempts('con-001', 0), // concurrency: 0% -> weak (weakest)
    ])
    render(<PatternPicker onSelect={vi.fn()} onBack={vi.fn()} />)

    await screen.findByText(PATTERN_LABELS['off-by-one'])

    expect(sectionHeadings()).toEqual(['In progress', 'Not started', 'Mastered'])

    // In-progress: weakest accuracy first, ties would fall back to
    // PATTERN_SLUGS order (not exercised by these four distinct values).
    const inProgressHeading = screen.getByRole('heading', { name: 'In progress' })
    const inProgressSection = inProgressHeading.parentElement
    if (!inProgressSection) throw new Error('expected the in-progress section to have a parent')
    const inProgressLabels = [
      PATTERN_LABELS.concurrency,
      PATTERN_LABELS['scope-closures'],
      PATTERN_LABELS['type-coercion'],
    ]
    let lastIndex = -1
    for (const label of inProgressLabels) {
      const index = inProgressSection.textContent.indexOf(label)
      expect(index).toBeGreaterThan(lastIndex)
      lastIndex = index
    }

    // Mastered section holds exactly the one mastered pattern.
    const masteredHeading = screen.getByRole('heading', { name: 'Mastered' })
    expect(masteredHeading.parentElement).toHaveTextContent(PATTERN_LABELS['off-by-one'])

    // Every pattern still appears exactly once across the whole picker.
    for (const slug of PATTERN_SLUGS) {
      expect(screen.getAllByText(PATTERN_LABELS[slug])).toHaveLength(1)
    }
  })

  it('hides a section entirely when it has no rows (all-new profile has no in-progress or mastered section)', async () => {
    listAttemptsMock.mockResolvedValue([])
    render(<PatternPicker onSelect={vi.fn()} onBack={vi.fn()} />)
    await screen.findByText(PATTERN_LABELS['off-by-one'])

    // A first-time user has every pattern at 'new' — only one section, and
    // every pattern still renders (same DoD as the flat-list test above).
    expect(sectionHeadings()).toEqual(['Not started'])
    for (const slug of PATTERN_SLUGS) {
      expect(screen.getByText(PATTERN_LABELS[slug])).toBeInTheDocument()
    }
  })

  it('hides the mastered section specifically when nothing has been mastered yet', async () => {
    listAttemptsMock.mockResolvedValue(makeAttempts('con-001', 2)) // 40% -> learning, not mastered
    render(<PatternPicker onSelect={vi.fn()} onBack={vi.fn()} />)
    await screen.findByText(PATTERN_LABELS.concurrency)

    expect(sectionHeadings()).toEqual(['In progress', 'Not started'])
    expect(screen.queryByRole('heading', { name: 'Mastered' })).not.toBeInTheDocument()
  })
})
