import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Home } from './Home'
import { loadProfile, listAttempts, DEFAULT_PREFERENCES } from '../storage'
import type { UserProfile, Attempt } from '../storage'

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>()
  return { ...actual, loadProfile: vi.fn(), listAttempts: vi.fn() }
})

vi.mock('../telemetry', () => ({
  trackFeedbackLinkClicked: vi.fn(),
}))

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
    preferences: DEFAULT_PREFERENCES,
    anonId: 'test-anon-id',
    challengerName: null,
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
    // Feedback-nudge dismissal (useFeedbackNudge.ts) persists via
    // localStorage — clear so one test's dismissal can't leak into another.
    localStorage.clear()
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

  it('keeps the Daily badge neutral (not warn-colored) at mobile widths', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    const badge = await screen.findByText('Not done yet')
    expect(badge.className).not.toContain('text-warn')
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

  // Regression: Google's live search snippet for the homepage showed
  // "TraceStep through code, predict each line Boss10 puzzles..." — title
  // and description were adjacent sibling <span>s with no whitespace
  // between them in JSX, so raw-text extraction ran them together even
  // though the flex-col layout visually separates them onto their own
  // lines. See the `{' '}` doc comment above the cards grid for the fix.
  it("has a real space between each card's title, description, and badge text (not run together)", async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home />)

    const practiceLink = await screen.findByRole('link', { name: /practice/i })
    expect(practiceLink.textContent).toContain('Practice Endless rating-matched puzzles')

    const traceLink = screen.getByRole('link', { name: /trace/i })
    expect(traceLink.textContent).toContain('Trace Step through code, predict each line')

    const bossLink = screen.getByRole('link', { name: /boss/i })
    expect(bossLink.textContent).toContain('Boss 10 puzzles, escalating — how deep can you get?')

    const statsLink = screen.getByRole('link', { name: /stats/i })
    expect(statsLink.textContent).toContain('Stats Rating history and pattern accuracy')

    // Daily's badge is unconditional (unlike Rush/Boss/Missions'), so the
    // base profile (no dailyCompletion) already exercises the
    // description-to-badge space too, not just title-to-description.
    const dailyLink = screen.getByRole('link', { name: /daily/i })
    expect(dailyLink.textContent).toContain('One puzzle, once a day Not done yet')
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

  describe('desktop (>=1024px)', () => {
    // Same mockMatchMedia shape as DailyPage.test.tsx/useMediaQuery.test.ts
    // — reports a match for every query, standing in for a >=1024px viewport.
    function stubDesktopViewport() {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({
          matches: true,
          media: '(min-width: 1024px)',
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        })),
      )
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('shows a sidebar with the mastery teaser and an activity grid', async () => {
      stubDesktopViewport()
      vi.mocked(loadProfile).mockResolvedValue(baseProfile())
      render(<Home />)

      await screen.findByText('1250')
      const link = await screen.findByRole('link', { name: /view full stats/i })
      expect(link).toHaveAttribute('href', '/stats')
      expect(screen.getByRole('img', { name: /activity/i })).toBeInTheDocument()
    })

    it('has no sidebar at mobile widths', async () => {
      // No matchMedia stub here — jsdom's default matchMedia (or the lack of
      // one) resolves useMediaQuery's query to false, the same as a real
      // <1024px viewport.
      vi.mocked(loadProfile).mockResolvedValue(baseProfile())
      render(<Home />)

      await screen.findByText('1250')
      expect(screen.queryByRole('link', { name: /view full stats/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('img', { name: /activity/i })).not.toBeInTheDocument()
    })

    it('shows a getting-started recommendation when no pattern has enough data yet', async () => {
      stubDesktopViewport()
      vi.mocked(loadProfile).mockResolvedValue(baseProfile())
      render(<Home />)

      const fallback = await screen.findByRole('link', { name: /practice a pattern/i })
      expect(fallback).toHaveAttribute('href', '/practice')
      expect(screen.queryByText(/practice this next/i)).not.toBeInTheDocument()
    })

    it('names the lowest-accuracy pattern with enough data in the recommendation card', async () => {
      stubDesktopViewport()
      vi.mocked(loadProfile).mockResolvedValue(baseProfile())
      const strongAttempts = Array.from({ length: 5 }, (_, i) =>
        attempt({
          id: `strong-${String(i)}`,
          puzzleId: 'oob-001',
          correct: true,
          createdAt: daysAgoIso(0),
        }),
      )
      const weakAttempts = Array.from({ length: 5 }, (_, i) =>
        attempt({
          id: `weak-${String(i)}`,
          puzzleId: 'con-001',
          correct: i < 1,
          createdAt: daysAgoIso(0),
        }),
      )
      vi.mocked(listAttempts).mockResolvedValue([...strongAttempts, ...weakAttempts])
      render(<Home />)

      const callout = await screen.findByRole('link', { name: /practice this next/i })
      expect(callout).toHaveTextContent(/concurrency/i)
      expect(callout).toHaveAttribute('href', '/practice?pattern=concurrency')
    })

    it('has no recommendation card at mobile widths', async () => {
      vi.mocked(loadProfile).mockResolvedValue(baseProfile())
      render(<Home />)

      await screen.findByText('1250')
      expect(screen.queryByRole('link', { name: /practice a pattern/i })).not.toBeInTheDocument()
    })

    it('gives the Daily badge warn styling when not done today', async () => {
      stubDesktopViewport()
      vi.mocked(loadProfile).mockResolvedValue(baseProfile())
      render(<Home />)

      const badge = await screen.findByText('Not done yet')
      expect(badge.className).toContain('text-warn')
    })
  })
})

// Launch instrumentation follow-up (feedback nudges): Home's own trigger
// surface for players who solve puzzles without ever touching Daily — see
// DailyPage.test.tsx's "shows a feedback nudge" test for the other surface.
describe('Home feedback nudge', () => {
  function attemptsOfLength(n: number): Attempt[] {
    return Array.from({ length: n }, (_, i) =>
      attempt({ id: `a${String(i)}`, createdAt: daysAgoIso(0) }),
    )
  }

  it('shows the feedback nudge once 5+ puzzles are solved and today’s Daily is not done', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue(attemptsOfLength(5))
    render(<Home />)

    expect(await screen.findByRole('link', { name: 'Feedback' })).toHaveAttribute(
      'href',
      'https://tally.so/r/Xxb0v4',
    )
  })

  it('does not show the feedback nudge with fewer than 5 solved attempts', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue(attemptsOfLength(4))
    render(<Home />)

    await screen.findByText('1250')
    expect(screen.queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument()
  })

  it('does not show the feedback nudge once today’s Daily is already done, regardless of attempt count', async () => {
    // Local calendar date, matching Home.tsx's own todayDateString (see the
    // "shows 'Done today'" test above) — not toISOString(), which is UTC and
    // can disagree with the local date near a day boundary.
    const now = new Date()
    const today = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    vi.mocked(loadProfile).mockResolvedValue({
      ...baseProfile(),
      dailyCompletion: { date: today, attemptId: 'a0', correct: true },
    })
    vi.mocked(listAttempts).mockResolvedValue(attemptsOfLength(5))
    render(<Home />)

    await screen.findByText('1250')
    expect(screen.queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument()
  })

  it('permanently hides the nudge (across remounts) once dismissed', async () => {
    const user = userEvent.setup()
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue(attemptsOfLength(5))
    const { unmount } = render(<Home />)

    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument()

    unmount()
    render(<Home />)
    await screen.findByText('1250')
    expect(screen.queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument()
  })
})
