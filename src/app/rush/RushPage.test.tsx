import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decodeChallengePayload } from '../../challenge'
import type { Puzzle } from '../../content'

const { FIXTURE_POOL, FIXTURE_PUZZLE_META, FIXTURE_BODY_BY_ID } = vi.hoisted(() => {
  const FIXTURE_POOL = Array.from({ length: 12 }, (_, i) => ({
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
  })) as unknown as Puzzle[]

  // content-metadata-lazy-load Task 5b: useRushSession now selects from
  // `puzzleMeta` and loads bodies via `getPuzzleBody`.
  const FIXTURE_PUZZLE_META = FIXTURE_POOL.map((p) => ({
    id: p.id,
    pattern: p.pattern,
    difficulty_rating: p.difficulty_rating,
    interaction: p.interaction,
  }))
  const FIXTURE_BODY_BY_ID = new Map(FIXTURE_POOL.map((p) => [p.id, p]))

  return { FIXTURE_POOL, FIXTURE_PUZZLE_META, FIXTURE_BODY_BY_ID }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL,
    quizPool: FIXTURE_POOL,
    puzzleMeta: FIXTURE_PUZZLE_META,
    // Derived exports must be re-derived from the SAME fixture, not left
    // real — see usePracticeSession.test.ts's identical mock comment.
    quizMeta: FIXTURE_PUZZLE_META.filter((meta) => meta.interaction !== 'scrubber'),
    scrubberMeta: FIXTURE_PUZZLE_META.filter((meta) => meta.interaction === 'scrubber'),
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
  }
})

vi.mock('../../telemetry', () => ({
  trackError: vi.fn(),
  trackRushAttempt: vi.fn(),
  trackRushRunEnd: vi.fn(),
  trackShareClick: vi.fn(),
  trackChallengeCreate: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { trackShareClick, trackChallengeCreate } = await import('../../telemetry')
const { resetPuzzleBodyCacheForTests } = await import('../practice/puzzleBodyCache')
const { RushPage } = await import('./RushPage')

/** correct_choice is always 0 -> choice text 'a'; 'b' is always wrong. */
async function answerAndContinue(user: ReturnType<typeof userEvent.setup>, correct: boolean) {
  await user.click(await screen.findByRole('button', { name: correct ? 'a' : 'b' }))
  await user.click(await screen.findByRole('button', { name: /next puzzle|see results/i }))
}

describe('RushPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    resetPuzzleBodyCacheForTests()
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
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
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

  it('copies the puzzle share text to the clipboard', async () => {
    const user = userEvent.setup()
    render(<RushPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
    })

    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Share' }))

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByRole('button', { name: 'Share puzzle' }))

    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('Codoro Rush —'))
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('getcodoro.com/puzzle/'))
    expect(trackShareClick).toHaveBeenCalledTimes(1)
    expect(trackShareClick).toHaveBeenCalledWith(expect.objectContaining({ surface: 'rush' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    })
  })

  it('shows a working "Share challenge" action after a run ends that re-encodes the run', async () => {
    const user = userEvent.setup()
    render(<RushPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
    })

    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Share' }))

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByRole('button', { name: 'Share challenge' }))

    expect(trackChallengeCreate).toHaveBeenCalledTimes(1)
    // All three run attempts (none correct here) are encoded — puzzle_count
    // reflects what the link actually replays, truncated to MAX_CHALLENGE_PUZZLES.
    expect(trackChallengeCreate).toHaveBeenCalledWith({ surface: 'rush', puzzle_count: 3 })

    const url = writeTextSpy.mock.calls[0]?.[0]
    if (typeof url !== 'string')
      throw new Error('expected writeText to have been called with a URL')
    expect(url).toMatch(/^Beat my Codoro Rush — 0 solved · 🔥 best 0 — getcodoro\.com\/challenge#/)

    const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
    expect(decoded).not.toBeNull()
    expect(decoded?.ids).toHaveLength(3)
    expect(decoded?.results.every((result) => !result.correct)).toBe(true)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Link copied!' })).toBeInTheDocument()
    })
  })
})
