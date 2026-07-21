import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Attempt } from '../../storage'

const listAttemptsMock = vi.fn<() => Promise<Attempt[]>>()

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return { ...actual, listAttempts: listAttemptsMock }
})

const { MasteryView } = await import('./MasteryView')

function makeAttempt(puzzleId: string, correct: boolean): Attempt {
  return {
    id: `${puzzleId}-${String(Math.random())}`,
    puzzleId,
    puzzleRating: 1200,
    mode: 'practice',
    correct,
    time_ms: 1000,
    choice_index: null,
    userRatingBefore: 1200,
    userRatingAfter: 1200,
    localDateString: '2026-07-17',
    createdAt: '2026-07-17T00:00:00.000Z',
  }
}

describe('MasteryView', () => {
  it('fetches attempts, computes mastery, and renders a row with "not enough data" below the threshold', async () => {
    listAttemptsMock.mockResolvedValue([makeAttempt('oob-001', true), makeAttempt('oob-002', true)])

    render(<MasteryView onBack={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/off-by-one/i)).toBeInTheDocument()
    })
    const row = screen.getByText(/off-by-one/i).closest('li')
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent(/not enough data/i)
  })

  it('renders an accuracy percentage once the minimum-attempts threshold is met', async () => {
    listAttemptsMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => makeAttempt('oob-001', i < 4)),
    )

    render(<MasteryView onBack={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('80%')).toBeInTheDocument()
    })
  })

  it('calls onBack when the back control is used', async () => {
    listAttemptsMock.mockResolvedValue([])
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(<MasteryView onBack={onBack} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('renders without a back button when onBack is omitted', async () => {
    listAttemptsMock.mockResolvedValue([])
    render(<MasteryView />)

    await waitFor(() => {
      expect(screen.getByText('Mastery by pattern')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument()
  })

  it('refetches attempts when refreshKey changes (the mastery-panel-sync fix)', async () => {
    listAttemptsMock.mockResolvedValueOnce([])
    const { rerender } = render(<MasteryView refreshKey={0} />)

    await waitFor(() => {
      expect(screen.getByText(/off-by-one/i).closest('li')).toHaveTextContent('0 attempts')
    })

    listAttemptsMock.mockResolvedValueOnce([makeAttempt('oob-001', true)])
    rerender(<MasteryView refreshKey={1} />)

    await waitFor(() => {
      expect(screen.getByText(/off-by-one/i).closest('li')).toHaveTextContent('1 attempts')
    })
  })

  it('does not refetch on a re-render where refreshKey is unchanged', async () => {
    listAttemptsMock.mockResolvedValue([])
    const { rerender } = render(<MasteryView refreshKey={0} />)

    await waitFor(() => {
      expect(screen.getByText(/off-by-one/i)).toBeInTheDocument()
    })
    listAttemptsMock.mockClear()

    rerender(<MasteryView refreshKey={0} onBack={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    })
    expect(listAttemptsMock).not.toHaveBeenCalled()
  })

  it('renders rows as plain (non-interactive) elements when onSelectPattern is omitted', async () => {
    listAttemptsMock.mockResolvedValue([])
    render(<MasteryView />)

    await waitFor(() => {
      expect(screen.getByText(/off-by-one/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/off-by-one/i).closest('button')).toBeNull()
  })

  it('calls onSelectPattern with the row pattern when an interactive row is clicked', async () => {
    listAttemptsMock.mockResolvedValue([])
    const onSelectPattern = vi.fn()
    const user = userEvent.setup()
    render(<MasteryView onSelectPattern={onSelectPattern} />)

    await waitFor(() => {
      expect(screen.getByText(/off-by-one/i)).toBeInTheDocument()
    })
    const row = screen.getByText(/off-by-one/i).closest('button')
    expect(row).not.toBeNull()
    await user.click(row as HTMLElement)

    expect(onSelectPattern).toHaveBeenCalledTimes(1)
    expect(onSelectPattern).toHaveBeenCalledWith('off-by-one')
  })
})
