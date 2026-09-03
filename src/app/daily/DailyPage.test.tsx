import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decodeChallengePayload } from '../../challenge'
import type { Puzzle } from '../../content'

const { FIXTURE_POOL, FIXTURE_CALENDAR, FIXTURE_BODY_BY_ID } = vi.hoisted(() => {
  const pool = Array.from({ length: 12 }, (_, i) => ({
    id: `p${String(i)}`,
    pattern: i % 2 === 0 ? 'off-by-one' : 'null-undefined',
    difficulty_rating: 1150 + i * 10,
    explanation: `explanation ${String(i)}`,
    prompt: `prompt ${String(i)}`,
    language: 'javascript',
    snippet: 'const x = 1',
    interaction: 'mcq',
    choices: ['a', 'b'],
    correct_choice: 0,
  })) as unknown as Puzzle[]

  return {
    FIXTURE_POOL: pool,
    FIXTURE_CALENDAR: pool.map((p) => p.id),
    FIXTURE_BODY_BY_ID: new Map(pool.map((p) => [p.id, p])),
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL,
    quizPool: FIXTURE_POOL,
    DAILY_CALENDAR: FIXTURE_CALENDAR,
    // content-metadata-lazy-load Task 5b: useDailySession now loads today's
    // puzzle body via getPuzzleBody (through the shared puzzleBodyCache).
    getPuzzleBody: vi.fn((id: string) => Promise.resolve(FIXTURE_BODY_BY_ID.get(id))),
  }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
    appendAttempt: vi.fn(),
    listAttempts: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({
  trackAttempt: vi.fn(),
  trackShareClick: vi.fn(),
  trackChallengeCreate: vi.fn(),
  trackError: vi.fn(),
  trackFeedbackLinkClicked: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, listAttempts, createDefaultProfile } =
  await import('../../storage')
const { trackShareClick, trackChallengeCreate } = await import('../../telemetry')
const { resetPuzzleBodyCacheForTests } = await import('../practice/puzzleBodyCache')
const { DailyPage } = await import('./DailyPage')

describe('DailyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPuzzleBodyCacheForTests()
    localStorage.clear()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    vi.mocked(listAttempts).mockResolvedValue([])
  })

  it("renders today's puzzle without a share menu before any attempt", async () => {
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share puzzle' })).not.toBeInTheDocument()
  })

  it("never renders the puzzle's rating before an attempt is committed (Phase 5 Item 3 — anchoring)", async () => {
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
    // DOM-absence, not visual hiding: a rating findable in devtools before
    // answering would still anchor the attempt even if invisible on screen.
    expect(screen.queryByText('Puzzle rating')).not.toBeInTheDocument()
    // Every fixture puzzle's difficulty_rating (1150, 1160, ... 1260) must
    // be absent too — not just the label — in case a future refactor moves
    // the value into a differently-labeled node. Note: 1200 (the default
    // profile's player rating, FIXTURE_POOL[5].difficulty_rating too) is
    // covered by this loop already; the desktop sidebar that would render
    // that player-rating pill doesn't mount in this test (matchMedia never
    // matches by default — src/test/setup.ts), so this loop is asserting
    // puzzle-rating absence specifically, not accidentally passing because
    // the player-rating pill happens to be off-screen for an unrelated reason.
    for (const puzzle of FIXTURE_POOL) {
      expect(screen.queryByText(String(puzzle.difficulty_rating))).not.toBeInTheDocument()
    }
  })

  it("reveals the puzzle's rating only after the first attempt is committed", async () => {
    const user = userEvent.setup()
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Puzzle rating')).not.toBeInTheDocument()

    const choiceButtons = screen.getAllByRole('button', { name: /^[ab]$/i })
    const firstChoice = choiceButtons[0]
    if (!firstChoice) throw new Error('expected at least one choice button')
    await user.click(firstChoice)

    await waitFor(() => {
      expect(screen.getByText('Puzzle rating')).toBeInTheDocument()
    })
    // Pin to the ACTUALLY-served puzzle's own rating, not "any fixture
    // rating" — the served puzzle is identifiable by its rendered prompt
    // text (PuzzleCardShell always renders puzzle.prompt). A looser
    // "does any fixture rating appear" check would pass even if the wrong
    // puzzle's rating rendered (e.g. a calendar-index off-by-one bug).
    const servedPuzzle = FIXTURE_POOL.find((p) => screen.queryByText(p.prompt) !== null)
    if (!servedPuzzle) throw new Error('could not identify which fixture puzzle was served')
    expect(screen.getByText(String(servedPuzzle.difficulty_rating))).toBeInTheDocument()
  })

  it('reveals the share menu after the first attempt, with a working "Share puzzle" action', async () => {
    const user = userEvent.setup()
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })

    const choiceButtons = screen.getAllByRole('button', { name: /^[ab]$/i })
    const firstChoice = choiceButtons[0]
    if (!firstChoice) throw new Error('expected at least one choice button')
    await user.click(firstChoice)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Share' }))

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByRole('button', { name: 'Share puzzle' }))

    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('Codoro Daily #'))
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('getcodoro.com/puzzle/'))
    expect(trackShareClick).toHaveBeenCalledTimes(1)
    expect(trackShareClick).toHaveBeenCalledWith(expect.objectContaining({ surface: 'daily' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    })
  })

  it('shows a feedback nudge linking to the Tally form after the first attempt', async () => {
    const user = userEvent.setup()
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument()

    const choiceButtons = screen.getAllByRole('button', { name: /^[ab]$/i })
    const firstChoice = choiceButtons[0]
    if (!firstChoice) throw new Error('expected at least one choice button')
    await user.click(firstChoice)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute(
        'href',
        'https://tally.so/r/Xxb0v4',
      )
    })
  })

  it('shows a working "Challenge a friend" button after the first attempt that re-encodes the served puzzle', async () => {
    const user = userEvent.setup()
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })

    const choiceButtons = screen.getAllByRole('button', { name: /^[ab]$/i })
    const firstChoice = choiceButtons[0]
    if (!firstChoice) throw new Error('expected at least one choice button')
    await user.click(firstChoice)

    // The served puzzle is identifiable by its rendered prompt text — the
    // same convention the rating-reveal test uses.
    const servedPuzzle = FIXTURE_POOL.find((p) => screen.queryByText(p.prompt) !== null)
    if (!servedPuzzle) throw new Error('could not identify which fixture puzzle was served')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /challenge a friend/i })).toBeInTheDocument()
    })

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByRole('button', { name: /challenge a friend/i }))
    // No saved name yet on a fresh default profile — skip the prompt, same
    // as PracticePage.test.tsx's identical first-use flow.
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(trackChallengeCreate).toHaveBeenCalledTimes(1)
    expect(trackChallengeCreate).toHaveBeenCalledWith({ surface: 'daily', puzzle_count: 1 })

    const url = writeTextSpy.mock.calls[0]?.[0]
    if (typeof url !== 'string')
      throw new Error('expected writeText to have been called with a URL')
    expect(url).toMatch(/^Can you beat today's Daily\? getcodoro\.com\/challenge#/)
    const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
    expect(decoded).not.toBeNull()
    expect(decoded?.ids).toEqual([servedPuzzle.id])
    expect(decoded?.challengerName).toBeNull()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Link copied!' })).toBeInTheDocument()
    })
  })

  it('shows a desktop sidebar (rating/streak pills + mastery teaser) at >=1024px, without navigating', async () => {
    // Same mockMatchMedia shape as useMediaQuery.test.ts — reports a match
    // for every query, standing in for a >=1024px viewport.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '(min-width: 1024px)',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    )

    render(<DailyPage />)
    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })

    expect(screen.queryByText('Mastery by pattern')).not.toBeInTheDocument()
    const link = await screen.findByRole('link', { name: /view full stats/i })
    expect(link).toHaveAttribute('href', '/stats')
    expect(screen.getAllByText('1200').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })
})
