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

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL, quizPool: FIXTURE_POOL, BOSS_RUN: BOSS_RUN_IDS }
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
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
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
})
