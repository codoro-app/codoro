import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatsPage } from './StatsPage'
import { loadProfile, listAttempts } from '../../storage'
import type { UserProfile, Attempt } from '../../storage'

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return { ...actual, loadProfile: vi.fn(), listAttempts: vi.fn() }
})

function attempt(overrides: Partial<Attempt> & Pick<Attempt, 'id' | 'localDateString'>): Attempt {
  return {
    puzzleId: `puzzle-${overrides.id}`,
    puzzleRating: 1200,
    mode: 'practice',
    correct: true,
    time_ms: 4000,
    choice_index: null,
    checkpoint_results: null,
    userRatingBefore: 1200,
    userRatingAfter: 1210,
    createdAt: `${overrides.localDateString}T10:00:00.000Z`,
    ...overrides,
  }
}

function baseProfile(): UserProfile {
  return {
    schema_version: 9,
    rating: 1487,
    ratedAttemptCount: 40,
    streak: { currentStreak: 12, longestStreak: 23, lastActiveDate: '2026-08-14' },
    requeueState: [],
    storagePersisted: null,
    dailyCompletion: null,
    rushStats: null,
    bestRunStreak: 0,
    bossStats: null,
    missionProgress: null,
    missionStats: null,
    anonId: 'test-anon-id',
  }
}

describe('StatsPage', () => {
  beforeEach(() => {
    vi.mocked(loadProfile).mockReset()
    vi.mocked(listAttempts).mockReset()
    vi.mocked(listAttempts).mockResolvedValue([])
  })

  it('shows a loading state before the profile resolves', () => {
    vi.mocked(loadProfile).mockReturnValue(new Promise(() => undefined))
    render(<StatsPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows the current rating once loaded', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<StatsPage />)
    await waitFor(() => {
      expect(screen.getByText('1487')).toBeInTheDocument()
    })
  })

  it('defaults the rating-graph window to 7 days and switches on toggle click', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue([
      attempt({ id: '1', localDateString: '2026-08-01', userRatingAfter: 1400 }),
      attempt({ id: '2', localDateString: '2026-08-13', userRatingAfter: 1487 }),
    ])
    const user = userEvent.setup()
    render(<StatsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true')
    })
    // The 2026-08-01 point falls outside a 7-day window (nowIso is real
    // Date.now() here, so this only asserts the toggle's own pressed state
    // changes — point-count assertions against a live clock live in
    // statsData.test.ts, which injects nowIso explicitly).
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'false')
  })
})
