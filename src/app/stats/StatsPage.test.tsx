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

// Local calendar date (not toISOString(), which is UTC and can disagree
// with the local date near a day boundary) — same convention as
// Home.test.tsx's own `today` helper, so an attempt dated "today" reliably
// falls inside the component's default 7-day window regardless of the
// machine's timezone.
function todayDateString(): string {
  const now = new Date()
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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

  // Regression test for a bug in the min/span mapping formula: with a
  // single history point (or a flat stretch of equal-rating points), max
  // === min, so the formula's (rating - min) / span term degenerates to 0
  // for every point and pins them all to the chart's bottom edge instead of
  // vertically centering — the correct rendering for "no variance to show."
  it('vertically centers a lone rating-history point instead of pinning it to the bottom', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue([
      attempt({ id: '1', localDateString: todayDateString(), userRatingAfter: 1487 }),
    ])
    const { container } = render(<StatsPage />)

    // Matches buildGraphPoints' own defaults (width=300, height=70,
    // padding=6): usableHeight = 70 - 6*2 = 58, so a vertically centered
    // point sits at y = 6 + 58/2 = 35 — computed explicitly here, not just
    // asserted "not at the bottom" (which the pre-fix y of 64 would also
    // fail to be equal to, but for the wrong reason).
    const expectedCenteredY = '35'

    await waitFor(() => {
      const circle = container.querySelector('circle')
      expect(circle).not.toBeNull()
      expect(circle).toHaveAttribute('cy', expectedCenteredY)
    })
  })

  it('shows no weakest-pattern callout when no pattern has enough data yet', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<StatsPage />)
    await waitFor(() => {
      expect(screen.getByText('1487')).toBeInTheDocument()
    })
    expect(screen.queryByText(/practice this next/i)).not.toBeInTheDocument()
  })

  it('names the lowest-accuracy pattern with enough data in the weakest-pattern callout, and links its heatmap cell to practice that pattern', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    const strongAttempts = Array.from({ length: 5 }, (_, i) =>
      attempt({
        id: `strong-${String(i)}`,
        localDateString: '2026-08-10',
        puzzleId: 'oob-001',
        correct: true,
      }),
    )
    const weakAttempts = Array.from({ length: 5 }, (_, i) =>
      attempt({
        id: `weak-${String(i)}`,
        localDateString: '2026-08-10',
        puzzleId: 'con-001',
        correct: i < 1,
      }),
    )
    vi.mocked(listAttempts).mockResolvedValue([...strongAttempts, ...weakAttempts])
    render(<StatsPage />)

    await waitFor(() => {
      expect(screen.getByText(/practice this next/i)).toBeInTheDocument()
    })
    // Scoped to the callout link itself (rather than a bare screen.getByText),
    // because the heatmap cell below also carries an accessible "Concurrency"
    // label — an unscoped query would match both and throw.
    const callout = screen.getByRole('link', { name: /practice this next/i })
    expect(callout).toHaveTextContent(/concurrency/i)

    const cell = screen.getByRole('link', { name: 'Concurrency & race conditions' })
    expect(cell).toHaveAttribute('href', '/practice?pattern=concurrency')
  })

  it('shows the activity calendar and lifetime totals once loaded', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    // Both attempts share `mode: 'practice'` (deviating from the task
    // brief's literal fixture, which used 'practice' + 'daily') — with two
    // distinct modes, totals.modesPlayed also equals 2, colliding with
    // totals.solved's own "2" and making screen.getByText('2') match two
    // elements. Mode diversity isn't asserted by this test, so collapsing
    // it to one shared mode removes the ambiguity without weakening intent.
    vi.mocked(listAttempts).mockResolvedValue([
      attempt({ id: '1', localDateString: '2026-08-10', mode: 'practice', time_ms: 3000 }),
      attempt({ id: '2', localDateString: '2026-08-11', mode: 'practice', time_ms: 5000 }),
    ])
    render(<StatsPage />)

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument() // solved count
    })
    expect(screen.getByText('23')).toBeInTheDocument() // bestStreak, from baseProfile's longestStreak
    expect(screen.getByLabelText(/activity calendar/i)).toBeInTheDocument()
  })

  it('shows real zeros, not a hidden section, for a brand-new profile with no attempts', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<StatsPage />)
    await waitFor(() => {
      expect(screen.getByText('1487')).toBeInTheDocument()
    })
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })
})
