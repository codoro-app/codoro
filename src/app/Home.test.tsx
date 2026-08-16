import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Home } from './Home'
import { loadProfile, listAttempts } from '../storage'
import type { UserProfile, Attempt } from '../storage'

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>()
  return { ...actual, loadProfile: vi.fn(), listAttempts: vi.fn() }
})

function attempt(overrides: Partial<Attempt> & Pick<Attempt, 'id' | 'createdAt'>): Attempt {
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
    localDateString: overrides.createdAt.slice(0, 10),
    ...overrides,
  }
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function baseProfile(): UserProfile {
  return {
    schema_version: 3,
    rating: 1250,
    ratedAttemptCount: 40,
    streak: { currentStreak: 3, longestStreak: 5, lastActiveDate: '2026-07-21' },
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

describe('Home', () => {
  beforeEach(() => {
    vi.mocked(loadProfile).mockReset()
    vi.mocked(listAttempts).mockReset()
    // Default: no attempt history — most tests aren't exercising the
    // recent-activity/rating-trend elements, so they get the "no data yet"
    // (element absent) branch unless a test overrides this explicitly.
    vi.mocked(listAttempts).mockResolvedValue([])
  })

  it('shows rating and streak once the profile loads', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    expect(await screen.findByText('1250')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows "Not done yet" on the Daily card when today has no completion', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    expect(await screen.findByText('Not done yet')).toBeInTheDocument()
  })

  it('shows "Done today" when dailyCompletion matches today', async () => {
    // Local calendar date, matching Home.tsx's own todayDateString (same
    // convention as usePracticeSession.ts/useDailySession.ts) — not
    // toISOString(), which is UTC and can disagree with the local date near
    // a day boundary, making this assertion flaky depending on timezone.
    const now = new Date()
    const today = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    vi.mocked(loadProfile).mockResolvedValue({
      ...baseProfile(),
      dailyCompletion: { date: today, attemptId: 'a1', correct: true },
    })
    render(<Home />)

    expect(await screen.findByText('Done today')).toBeInTheDocument()
  })

  it('links the Practice card to /practice', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    expect(await screen.findByRole('link', { name: /practice/i })).toHaveAttribute(
      'href',
      '/practice',
    )
  })

  it('links the Daily card to /daily', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    expect(await screen.findByRole('link', { name: /daily/i })).toHaveAttribute('href', '/daily')
  })

  it('links the Rush card to /rush', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    expect(await screen.findByRole('link', { name: /rush/i })).toHaveAttribute('href', '/rush')
  })

  it('links the Trace card to /trace', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    expect(await screen.findByRole('link', { name: /trace/i })).toHaveAttribute('href', '/trace')
  })

  it('links the Boss card to /boss', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    expect(await screen.findByRole('link', { name: /boss/i })).toHaveAttribute('href', '/boss')
  })

  it('shows no best-depth badge on the Boss card when bossStats is null', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    await screen.findByRole('link', { name: /boss/i })
    expect(screen.queryByText(/^Best depth \d/)).not.toBeInTheDocument()
  })

  it('shows the best-depth badge on the Boss card once bossStats is set', async () => {
    vi.mocked(loadProfile).mockResolvedValue({
      ...baseProfile(),
      bossStats: {
        bestDepth: 6,
        clears: 1,
        runs: 3,
        lastRunAt: '2026-08-01T10:00:00.000Z',
        bestRunSplits: null,
      },
    })
    render(<Home />)

    expect(await screen.findByText('Best depth 6')).toBeInTheDocument()
  })

  it('shows no best-score badge on the Rush card when rushStats is null', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    await screen.findByRole('link', { name: /rush/i })
    expect(screen.queryByText(/^Best \d/)).not.toBeInTheDocument()
  })

  it('shows the best-score badge on the Rush card once rushStats is set', async () => {
    vi.mocked(loadProfile).mockResolvedValue({
      ...baseProfile(),
      rushStats: { bestScore: 23, bestStreak: 31, runs: 4, lastRunAt: '2026-07-22T10:00:00.000Z' },
    })
    render(<Home />)

    expect(await screen.findByText('Best 23')).toBeInTheDocument()
  })

  it('pins the rating/streak header and Practice card in the sticky header region, above the scrollable Modes list', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    const { container } = render(<Home />)

    const practiceLink = await screen.findByRole('link', { name: /practice/i })
    const stickyHeader = container.querySelector('.sticky.top-0')
    expect(stickyHeader).not.toBeNull()
    expect(stickyHeader?.contains(practiceLink)).toBe(true)
    expect(stickyHeader?.textContent).toContain('1250')

    // "Modes" and the secondary-card grid render outside the sticky region,
    // in the scrollable body.
    const modesLabel = screen.getByText('Modes')
    expect(stickyHeader?.contains(modesLabel)).toBe(false)
  })

  it('shows no recent-activity recap when there are no attempts yet', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    await screen.findByText('1250')
    expect(screen.queryByText(/correct/)).not.toBeInTheDocument()
  })

  it('shows a recent-activity recap once attempts exist', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue([
      attempt({
        id: '1',
        mode: 'practice',
        correct: true,
        userRatingBefore: 1200,
        userRatingAfter: 1210,
        createdAt: daysAgoIso(0),
      }),
      attempt({
        id: '2',
        mode: 'practice',
        correct: false,
        userRatingBefore: 1210,
        userRatingAfter: 1205,
        createdAt: daysAgoIso(0),
      }),
    ])
    render(<Home />)

    expect(await screen.findByText('Practice · 1/2 correct · +5 rating')).toBeInTheDocument()
  })

  it('shows no rating-trend chip when there is no activity in the last 7 days', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue([
      attempt({
        id: '1',
        userRatingBefore: 1100,
        userRatingAfter: 1120,
        createdAt: daysAgoIso(10),
      }),
    ])
    render(<Home />)

    await screen.findByText('1250')
    expect(screen.queryByText(/this week/)).not.toBeInTheDocument()
  })

  it('shows a rating-trend chip summarizing the last 7 days', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue([
      attempt({ id: '1', userRatingBefore: 1150, userRatingAfter: 1182, createdAt: daysAgoIso(2) }),
    ])
    render(<Home />)

    expect(await screen.findByText('▲ +32 this week')).toBeInTheDocument()
  })

  // Elo-style rating updates are rarely whole numbers (e.g. 1191.440233...);
  // both new elements must round for display the same way the header's own
  // Rating figure already does (Math.round(profile.rating)), not print raw
  // float noise.
  it('rounds fractional rating deltas for display', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue([
      attempt({
        id: '1',
        mode: 'practice',
        correct: false,
        userRatingBefore: 1200,
        userRatingAfter: 1191.440233,
        createdAt: daysAgoIso(0),
      }),
    ])
    render(<Home />)

    expect(await screen.findByText('Practice · 0/1 correct · -9 rating')).toBeInTheDocument()
    expect(await screen.findByText('▼ -9 this week')).toBeInTheDocument()
  })

  it('links to /stats via a Stats card', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)
    const link = await screen.findByRole('link', { name: /stats/i })
    expect(link).toHaveAttribute('href', '/stats')
  })
})
