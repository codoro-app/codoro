/**
 * Task 7 (v4 Phase 4.3): the exact gap Task 6's review found —
 * `DailyPage.test.tsx`'s fixture pool is all-mcq, so it never exercised a
 * scrubber-day render. `PuzzleCardShell` throws on `case 'scrubber'`
 * (src/app/practice/PuzzleCardShell.tsx:443-448); this file proves a
 * scrubber Daily puzzle instead renders via `TraceRunnerPuzzle` and reaches
 * the same completed-Daily state a non-scrubber puzzle does. Kept as its own
 * file rather than folded into DailyPage.test.tsx's all-mcq fixture, same
 * convention as useDailySession.scrubber.test.ts.
 *
 * Every calendar entry resolves to the same scrubber puzzle id — see
 * useDailySession.scrubber.test.ts's module doc comment for why.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Puzzle } from '../../content'

const { FIXTURE_CALENDAR, FIXTURE_BODY_BY_ID, SCRUBBER_PUZZLE } = vi.hoisted(() => {
  const scrubberPuzzle = {
    id: 's-daily-1',
    pattern: 'off-by-one',
    difficulty_rating: 1200,
    explanation: 'x accumulates across two separate increments.',
    prompt: 'Trace the value of x.',
    language: 'javascript',
    snippet: 'let x = 0;\nx = x + 1;\nconsole.log(x);',
    interaction: 'scrubber',
    steps: [
      { line: 0, vars: { x: '0' } },
      { line: 1, vars: { x: '1' } },
      { line: 2, vars: { x: '1' }, output: '1' },
    ],
    checkpoints: [
      { afterStep: 0, question: 'var-value', target: 'x', choices: ['0', '1'], correct: 0 },
      { afterStep: 1, question: 'next-line', choices: ['1', '2'], correct: 1 },
    ],
  } as unknown as Puzzle

  return {
    SCRUBBER_PUZZLE: scrubberPuzzle,
    FIXTURE_CALENDAR: Array.from({ length: 5 }, () => scrubberPuzzle.id),
    FIXTURE_BODY_BY_ID: new Map([[scrubberPuzzle.id, scrubberPuzzle]]),
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    DAILY_CALENDAR: FIXTURE_CALENDAR,
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
}))

const { loadProfile, saveProfile, appendAttempt, listAttempts, createDefaultProfile } =
  await import('../../storage')
const { resetPuzzleBodyCacheForTests } = await import('../practice/puzzleBodyCache')
const { DailyPage } = await import('./DailyPage')

describe('DailyPage — scrubber puzzle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPuzzleBodyCacheForTests()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    vi.mocked(listAttempts).mockResolvedValue([])
  })

  it("renders a scrubber day's puzzle via TraceRunnerPuzzle, not PuzzleCardShell, without throwing", async () => {
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
    // The prompt/checkpoint UI proves TraceRunnerPuzzle rendered — a
    // scrubber puzzle reaching PuzzleCardShell would have thrown before
    // this text could ever appear.
    expect(screen.getByText(SCRUBBER_PUZZLE.prompt)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Checkpoint' })).toBeInTheDocument()
  })

  it('answering every checkpoint completes the puzzle and produces the same Daily-completion effects a non-scrubber puzzle does', async () => {
    const user = userEvent.setup()
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(SCRUBBER_PUZZLE.prompt)).toBeInTheDocument()
    })

    // Checkpoint 1 (var-value, afterStep 0): choices are '0'/'1', correct '0'.
    await user.click(screen.getByRole('button', { name: '0' }))

    // Advance to stepIndex 1, where checkpoint 2 (next-line, afterStep 1)
    // becomes the pending checkpoint — displayed choice text is the raw
    // 0-indexed line value + 1 (CheckpointPanel's displayChoiceText).
    await user.click(screen.getByRole('button', { name: 'Next step' }))
    // choices ['1', '2'], correct index 1 -> displayed as '3'.
    await user.click(screen.getByRole('button', { name: '3' }))

    await waitFor(() => {
      expect(screen.getByText('Solved on first try')).toBeInTheDocument()
    })
    expect(screen.getByText(/^[+-]\d+ rating$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()

    expect(appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'daily',
        correct: true,
        checkpoint_results: [
          { correct: true, choiceIndex: 0 },
          { correct: true, choiceIndex: 1 },
        ],
      }),
    )
    expect(saveProfile).toHaveBeenCalledTimes(1)
  })
})
