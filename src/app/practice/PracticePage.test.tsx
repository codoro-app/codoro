import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PATTERN_LABELS } from '../../content'
import { nth } from '../../test/nth'

const practicePagePath = join(dirname(fileURLToPath(import.meta.url)), 'PracticePage.tsx')

const { FIXTURE_POOL } = vi.hoisted(() => ({
  FIXTURE_POOL: Array.from({ length: 12 }, (_, i) => ({
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
  })),
}))

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL }
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

vi.mock('../../telemetry', () => ({ trackAttempt: vi.fn() }))

const { loadProfile, saveProfile, appendAttempt, listAttempts, createDefaultProfile } =
  await import('../../storage')
const { PracticePage } = await import('./PracticePage')

describe('PracticePage', () => {
  beforeEach(() => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    vi.mocked(listAttempts).mockResolvedValue([])
  })

  it('keys the rendered PuzzleCardShell by puzzle.id (required concern-b fix)', () => {
    const source = readFileSync(practicePagePath, 'utf-8')
    expect(source).toMatch(/<PuzzleCardShell[\s\S]{0,40}key=\{session\.puzzle\.id\}/)
  })

  it('loads a puzzle and renders the status bar + card after startup', async () => {
    render(<PracticePage />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
    // Rating pill shows the default starting rating.
    expect(screen.getByText('1200')).toBeInTheDocument()
  })

  it('browse-by-pattern: selecting a pattern filters subsequent puzzles and shows a way back to all patterns', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /browse patterns/i }))
    expect(screen.getByText(PATTERN_LABELS['null-undefined'])).toBeInTheDocument()

    await user.click(screen.getByText(PATTERN_LABELS['null-undefined']))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pattern: null/i })).toBeInTheDocument()
    })

    // Practice-all-patterns escape hatch is reachable again from here.
    await user.click(screen.getByRole('button', { name: /pattern: null/i }))
    expect(screen.getByRole('button', { name: /practice all patterns/i })).toBeInTheDocument()
  })

  it('mastery view is reachable and has a way back to practice', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^mastery$/i }))
    await waitFor(() => {
      expect(screen.getByText(/mastery by pattern/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
  })

  it('answering and continuing serves a fresh, unanswered card', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    expect(screen.getByRole('status')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    // AnimatePresence keeps the outgoing (answered) card mounted until its
    // exit transition finishes — real wall-clock time, not a synchronous
    // state flush — so wait for it to actually leave the DOM.
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })
})
