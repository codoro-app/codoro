import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Puzzle } from '../../content'

const { FIXTURE_POOL, BOSS_RUN_IDS } = vi.hoisted(() => {
  const ids = Array.from({ length: 10 }, (_, i) => `b${String(i)}`)
  return {
    BOSS_RUN_IDS: ids,
    FIXTURE_POOL: ids.map((id, i) => ({
      id,
      pattern: 'off-by-one',
      difficulty_rating: 900 + i * 100,
      explanation: `explanation ${id}`,
      prompt: `prompt ${id}`,
      language: 'javascript',
      snippet: 'const x = 1',
      interaction: 'mcq',
      choices: ['a', 'b'],
      correct_choice: 0,
    })) as unknown as Puzzle[],
  }
})

// See useBossSession.test.ts's identical mock for why resolveActiveBossSet
// must be stubbed alongside BOSS_SETS, not just the constant.
vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL,
    quizPool: FIXTURE_POOL,
    BOSS_SETS: [BOSS_RUN_IDS],
    resolveActiveBossSet: () => BOSS_RUN_IDS,
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
  trackBossAttempt: vi.fn(),
  trackBossRunEnd: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { BossPage } = await import('./BossPage')

async function answerAndContinue(user: ReturnType<typeof userEvent.setup>, correct: boolean) {
  await user.click(await screen.findByRole('button', { name: correct ? 'a' : 'b' }))
  await user.click(await screen.findByRole('button', { name: /next puzzle|see results/i }))
}

describe('BossPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  it('shows the strikes indicator and puzzle 1 of 10 once ready', async () => {
    render(<BossPage />)
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /0 of 3 strikes/i })).toBeInTheDocument()
    })
    expect(screen.getByText(/puzzle 1 of 10/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
  })

  it('click-meaningfulness: shows a segmented pip progress indicator alongside the puzzle counter', async () => {
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))
    const pips = document.querySelectorAll('.boss-progress__pip')
    expect(pips).toHaveLength(10)
    expect(document.querySelectorAll('.boss-progress__pip--current')).toHaveLength(1)
    expect(document.querySelectorAll('.boss-progress__pip--done')).toHaveLength(0)
  })

  it('click-meaningfulness: shows the boss character', async () => {
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))
    expect(document.querySelector('.boss-character')).not.toBeNull()
  })

  it('click-meaningfulness: reacts with a "hit landed" beat on a correct answer', async () => {
    const user = userEvent.setup()
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))

    expect(document.querySelector('.boss-character__icon--hit')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'a' }))
    await waitFor(() => {
      expect(document.querySelector('.boss-character__icon--hit')).not.toBeNull()
    })
  })

  it('click-meaningfulness: reacts with a "struck" beat on a wrong answer', async () => {
    const user = userEvent.setup()
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))

    await user.click(screen.getByRole('button', { name: 'b' }))
    await waitFor(() => {
      expect(document.querySelector('.boss-character__icon--struck')).not.toBeNull()
    })
  })

  it('renders the health bar full at 0 strikes, with no hit-reaction class', async () => {
    render(<BossPage />)
    const bar = await screen.findByRole('status', { name: /0 of 3 strikes/i })
    const fill = bar.querySelector('.boss-strikes__fill')
    expect(fill).toHaveStyle({ width: '100%' })
    expect(fill).not.toHaveClass('boss-strikes__fill--hit')
  })

  it('depletes the health bar as strikes land, and applies the hit-reaction class', async () => {
    const user = userEvent.setup()
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))

    await answerAndContinue(user, false)

    const bar = await screen.findByRole('status', { name: /1 of 3 strikes/i })
    const fill = bar.querySelector('.boss-strikes__fill')
    expect(fill).toHaveStyle({ width: `${String((2 / 3) * 100)}%` })
    expect(fill).toHaveClass('boss-strikes__fill--hit')
  })

  it('advances to puzzle 2 of 10 on a correct answer', async () => {
    const user = userEvent.setup()
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))

    await answerAndContinue(user, true)
    await waitFor(() => {
      expect(screen.getByText(/puzzle 2 of 10/i)).toBeInTheDocument()
    })
  })

  it('shows the end-of-run summary after 3 strikes, with Run it back to replay', async () => {
    const user = userEvent.setup()
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))

    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await answerAndContinue(user, false)

    await waitFor(() => {
      expect(screen.getByText(/run complete/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Run it back' })).toBeInTheDocument()
  })

  it('shows no ghost-pace comparison when there is no prior best-depth run', async () => {
    const user = userEvent.setup()
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))

    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await answerAndContinue(user, false)

    await waitFor(() => {
      expect(screen.getByText(/run complete/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/your best run got there/i)).not.toBeInTheDocument()
  })

  it('shows the ghost-pace comparison once a prior best-depth run recorded splits at the same depth', async () => {
    vi.mocked(loadProfile).mockResolvedValue({
      ...createDefaultProfile(),
      bossStats: {
        bestDepth: 5,
        clears: 0,
        runs: 2,
        lastRunAt: '2026-08-01T00:00:00.000Z',
        bestRunSplits: [1000, 2000, 3000, 4000, 5000],
      },
    })
    const user = userEvent.setup()
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))

    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await answerAndContinue(user, false)

    await waitFor(() => {
      expect(screen.getByText(/run complete/i)).toBeInTheDocument()
    })
    // The prior best run's split at depth 3 is 3000ms (0:03) — the exact
    // wording is asserted by ghostPace.test.ts; this only proves it's wired.
    expect(screen.getByText(/your best run got there in 0:03/i)).toBeInTheDocument()
  })
})
