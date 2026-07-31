import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Puzzle } from '../../content'

const { FIXTURE_POOL } = vi.hoisted(() => ({
  FIXTURE_POOL: Array.from({ length: 12 }, (_, i) => ({
    id: `p${String(i)}`,
    pattern: i % 2 === 0 ? 'off-by-one' : 'null-undefined',
    difficulty_rating: 700 + i * 20,
    explanation: `explanation ${String(i)}`,
    prompt: `prompt ${String(i)}`,
    language: 'javascript',
    snippet: 'const x = 1',
    interaction: 'mcq',
    choices: ['a', 'b'],
    correct_choice: 0,
  })) as unknown as Puzzle[],
}))

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL, quizPool: FIXTURE_POOL }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
    appendAttempt: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({
  trackError: vi.fn(),
  trackRushAttempt: vi.fn(),
  trackRushRunEnd: vi.fn(),
  trackShareClick: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { trackShareClick } = await import('../../telemetry')
const { RushPage } = await import('./RushPage')

/** correct_choice is always 0 -> choice text 'a'; 'b' is always wrong. */
async function answerAndContinue(user: ReturnType<typeof userEvent.setup>, correct: boolean) {
  await user.click(await screen.findByRole('button', { name: correct ? 'a' : 'b' }))
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
}

describe('RushPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  it('shows the strikes indicator and a puzzle once ready', async () => {
    render(<RushPage />)
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /0 of 3 strikes/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
  })

  it('increments the solved count on a correct answer and serves a new puzzle', async () => {
    const user = userEvent.setup()
    render(<RushPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
    })

    await answerAndContinue(user, true)

    expect(screen.getByText('1 solved')).toBeInTheDocument()
  })

  it('ends the run after 3 strikes and shows the end-of-run card with share + run-it-back', async () => {
    const user = userEvent.setup()
    render(<RushPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
    })

    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await answerAndContinue(user, false)

    await waitFor(() => {
      expect(screen.getByText('Run complete')).toBeInTheDocument()
    })
    expect(screen.getByText(/Copy share text/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run it back' })).toBeInTheDocument()
  })

  it('"Run it back" starts a fresh run', async () => {
    const user = userEvent.setup()
    render(<RushPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
    })

    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run it back' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Run it back' }))

    await waitFor(() => {
      expect(screen.getByRole('status', { name: /0 of 3 strikes/i })).toBeInTheDocument()
    })
    expect(screen.queryByText('Run complete')).not.toBeInTheDocument()
  })

  it('copies the share text to the clipboard', async () => {
    const user = userEvent.setup()
    render(<RushPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
    })

    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await waitFor(() => {
      expect(screen.getByText(/Copy share text/i)).toBeInTheDocument()
    })

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByText(/Copy share text/i))

    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('Codoro Rush —'))
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('getcodoro.com/puzzle/'))
    expect(trackShareClick).toHaveBeenCalledTimes(1)
    expect(trackShareClick).toHaveBeenCalledWith(expect.objectContaining({ surface: 'rush' }))
    await waitFor(() => {
      expect(screen.getByText(/Copied!/i)).toBeInTheDocument()
    })
  })
})
