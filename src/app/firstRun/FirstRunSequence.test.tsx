/**
 * Focused render test for FirstRunSequence itself — previously only its
 * underlying hook (useFirstRunSession.test.ts) had coverage, per the
 * redesign audit's own "Still open" note. Mirrors useFirstRunSession.test.ts's
 * fixture-pool convention (a small FIRST_RUN_SET override, not real content
 * ids) and Home.test.tsx's storage/telemetry mock shape (the same module
 * paths, one directory shallower since this file lives in ./firstRun).
 *
 * Uses 2 mcq fixtures (not tap-line/drag-order/scrubber) purely so the run
 * can be driven end-to-end with plain button clicks, the same shortcut
 * ChallengePage.test.tsx takes for its own multi-puzzle flows — the
 * per-interaction-type rendering itself is already covered by
 * PuzzleCardShell.test.tsx and the dispatch tests elsewhere.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Puzzle } from '../../content'
import { FirstRunSequence } from './FirstRunSequence'

const { FIXTURE_SET, FIXTURE_BODY_BY_ID } = vi.hoisted(() => {
  const puzzleOne = {
    id: 'fr-fixture-1',
    pattern: 'off-by-one',
    difficulty_rating: 1200,
    explanation: 'Loop bound is off by one.',
    prompt: 'What is the bug?',
    language: 'javascript',
    snippet: 'for (let i = 0; i <= arr.length; i++) {}',
    interaction: 'mcq',
    choices: ['Off-by-one loop bound', 'Missing return'],
    correct_choice: 0,
  } as unknown as Puzzle
  const puzzleTwo = {
    id: 'fr-fixture-2',
    pattern: 'null-undefined',
    difficulty_rating: 1150,
    explanation: 'Missing null check.',
    prompt: 'What is the bug?',
    language: 'javascript',
    snippet: 'return user.name.toUpperCase();',
    interaction: 'mcq',
    choices: ['Missing null check on user', 'Wrong method name'],
    correct_choice: 0,
  } as unknown as Puzzle

  return {
    FIXTURE_SET: [puzzleOne.id, puzzleTwo.id] as readonly string[],
    FIXTURE_BODY_BY_ID: new Map([
      [puzzleOne.id, puzzleOne],
      [puzzleTwo.id, puzzleTwo],
    ]),
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    FIRST_RUN_SET: FIXTURE_SET,
    getPuzzleBody: vi.fn((id: string) => Promise.resolve(FIXTURE_BODY_BY_ID.get(id))),
  }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(() =>
      Promise.resolve({ ...actual.createDefaultProfile(), firstRunCompleted: false }),
    ),
    saveProfile: vi.fn(() => Promise.resolve(undefined)),
    appendAttempt: vi.fn(() => Promise.resolve(undefined)),
  }
})

vi.mock('../../telemetry', () => ({
  trackAttempt: vi.fn(),
  trackError: vi.fn(),
  trackFirstRunStepComplete: vi.fn(),
  trackFirstRunCompleted: vi.fn(),
  trackChallengeCreate: vi.fn(),
}))

describe('FirstRunSequence', () => {
  it('shows Puzzle 1 of N with progress dots, advances through the run, and reaches the completion screen', async () => {
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<FirstRunSequence onComplete={onComplete} />)

    expect(await screen.findByText('Puzzle 1 of 2')).toBeInTheDocument()
    const dotsAtStart = screen.getAllByTestId('progress-dot')
    expect(dotsAtStart).toHaveLength(2)
    expect(dotsAtStart[0]).toHaveAttribute('data-state', 'current')

    // Answer puzzle 1 by its exact correct_choice: 0 text (not a positional
    // findAllByRole('button')[0] — that raced puzzle 1's own remount/portal
    // buttons and occasionally grabbed the wrong element) and advance.
    await user.click(await screen.findByRole('button', { name: 'Off-by-one loop bound' }))
    await user.click(await screen.findByRole('button', { name: 'Next puzzle' }))

    await waitFor(() => {
      expect(screen.getByText('Puzzle 2 of 2')).toBeInTheDocument()
    })

    // Answer puzzle 2 — the run's last puzzle; its own Continue click is
    // what flips useFirstRunSession's phase to 'ended'.
    await user.click(await screen.findByRole('button', { name: 'Missing null check on user' }))
    await user.click(await screen.findByRole('button', { name: 'Next puzzle' }))

    expect(await screen.findByText('You solved your first puzzles')).toBeInTheDocument()
    expect(screen.getByText('2/2 correct')).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('link', { name: 'Keep practicing' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
