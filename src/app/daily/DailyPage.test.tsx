import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Puzzle } from '../../content'

const { FIXTURE_POOL, FIXTURE_CALENDAR } = vi.hoisted(() => {
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

  return { FIXTURE_POOL: pool, FIXTURE_CALENDAR: pool.map((p) => p.id) }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL,
    quizPool: FIXTURE_POOL,
    DAILY_CALENDAR: FIXTURE_CALENDAR,
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
  trackError: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, listAttempts, createDefaultProfile } =
  await import('../../storage')
const { trackShareClick } = await import('../../telemetry')
const { DailyPage } = await import('./DailyPage')

describe('DailyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    vi.mocked(listAttempts).mockResolvedValue([])
  })

  it("renders today's puzzle without a share card before any attempt", async () => {
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Copy share text/i)).not.toBeInTheDocument()
  })

  it('reveals the share card after the first attempt, with a working copy button', async () => {
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
      expect(screen.getByText(/Copy share text/i)).toBeInTheDocument()
    })

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByText(/Copy share text/i))

    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('Codoro Daily #'))
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('getcodoro.com/puzzle/'))
    expect(trackShareClick).toHaveBeenCalledTimes(1)
    expect(trackShareClick).toHaveBeenCalledWith(expect.objectContaining({ surface: 'daily' }))
    await waitFor(() => {
      expect(screen.getByText(/Copied!/i)).toBeInTheDocument()
    })
  })

  it('shows a desktop sidebar (rating/streak pills + mastery) at >=1024px, without navigating', async () => {
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

    expect(screen.getByText('Mastery by pattern')).toBeInTheDocument()
    expect(screen.getAllByText('1200').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })
})
