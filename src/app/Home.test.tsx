import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Home } from './Home'
import { loadProfile } from '../storage'
import type { UserProfile } from '../storage'

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>()
  return { ...actual, loadProfile: vi.fn() }
})

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
  }
}

describe('Home', () => {
  beforeEach(() => {
    vi.mocked(loadProfile).mockReset()
  })

  it('shows rating and streak once the profile loads', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home onNavigate={vi.fn()} />)

    expect(await screen.findByText('1250')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows "Not done yet" on the Daily card when today has no completion', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home onNavigate={vi.fn()} />)

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
    render(<Home onNavigate={vi.fn()} />)

    expect(await screen.findByText('Done today')).toBeInTheDocument()
  })

  it('navigates to practice when the Practice card is clicked', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<Home onNavigate={onNavigate} />)

    await user.click(await screen.findByRole('button', { name: /practice/i }))
    expect(onNavigate).toHaveBeenCalledWith('practice')
  })

  it('navigates to daily when the Daily card is clicked', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<Home onNavigate={onNavigate} />)

    await user.click(await screen.findByRole('button', { name: /daily/i }))
    expect(onNavigate).toHaveBeenCalledWith('daily')
  })

  it('navigates to rush when the Rush card is clicked', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<Home onNavigate={onNavigate} />)

    await user.click(await screen.findByRole('button', { name: /rush/i }))
    expect(onNavigate).toHaveBeenCalledWith('rush')
  })

  it('shows no best-score badge on the Rush card when rushStats is null', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<Home onNavigate={vi.fn()} />)

    await screen.findByRole('button', { name: /rush/i })
    expect(screen.queryByText(/^Best \d/)).not.toBeInTheDocument()
  })

  it('shows the best-score badge on the Rush card once rushStats is set', async () => {
    vi.mocked(loadProfile).mockResolvedValue({
      ...baseProfile(),
      rushStats: { bestScore: 23, bestStreak: 31, runs: 4, lastRunAt: '2026-07-22T10:00:00.000Z' },
    })
    render(<Home onNavigate={vi.fn()} />)

    expect(await screen.findByText('Best 23')).toBeInTheDocument()
  })
})
