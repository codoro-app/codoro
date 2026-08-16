import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { Attempt } from '../../storage'

const listAttemptsMock = vi.fn<() => Promise<Attempt[]>>()

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return { ...actual, listAttempts: listAttemptsMock }
})

const { MasteryTeaser } = await import('./MasteryTeaser')

function makeAttempt(puzzleId: string, correct: boolean): Attempt {
  return {
    id: `${puzzleId}-${String(Math.random())}`,
    puzzleId,
    puzzleRating: 1200,
    mode: 'practice',
    correct,
    time_ms: 1000,
    choice_index: null,
    checkpoint_results: null,
    userRatingBefore: 1200,
    userRatingAfter: 1200,
    localDateString: '2026-07-17',
    createdAt: '2026-07-17T00:00:00.000Z',
  }
}

describe('MasteryTeaser', () => {
  it('shows a neutral loading state — not the "solve a few puzzles" fallback — while listAttempts is still pending', () => {
    // Never resolves: mirrors the brief window between mount and
    // listAttempts() resolving, where `rows` is still null.
    listAttemptsMock.mockReturnValue(new Promise(() => undefined))

    render(<MasteryTeaser refreshKey={0} />)

    // The bug this guards: rendering the "solve a few puzzles" fallback
    // during the loading window misinforms a returning user who actually
    // has history — that fallback is only correct once the fetch resolves
    // and genuinely finds no pattern with enough data.
    expect(
      screen.queryByText('Solve a few puzzles to see your weakest pattern.'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('transitions from the loading state to the weakest-pattern row once listAttempts resolves', async () => {
    let resolveAttempts!: (attempts: Attempt[]) => void
    listAttemptsMock.mockReturnValue(
      new Promise<Attempt[]>((resolve) => {
        resolveAttempts = resolve
      }),
    )

    render(<MasteryTeaser refreshKey={0} />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()

    resolveAttempts(Array.from({ length: 5 }, (_, i) => makeAttempt('oob-001', i < 4)))

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/weakest:/i)).toBeInTheDocument()
    expect(screen.getByText(/off-by-one/i)).toBeInTheDocument()
    expect(
      screen.queryByText('Solve a few puzzles to see your weakest pattern.'),
    ).not.toBeInTheDocument()
  })

  it('transitions from the loading state to the "solve a few puzzles" fallback when there is no qualifying mastery data', async () => {
    let resolveAttempts!: (attempts: Attempt[]) => void
    listAttemptsMock.mockReturnValue(
      new Promise<Attempt[]>((resolve) => {
        resolveAttempts = resolve
      }),
    )

    render(<MasteryTeaser refreshKey={0} />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()

    resolveAttempts([])

    await waitFor(() => {
      expect(
        screen.getByText('Solve a few puzzles to see your weakest pattern.'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })
})
