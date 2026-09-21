import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CoachPanel } from './CoachPanel'
import {
  loadCoachExplanationSet,
  resetCoachExplanationCacheForTests,
} from './coachExplanationCache'
import type { McqPuzzle, SwipeBinaryPuzzle } from '../../content'

vi.mock('./coachExplanationCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./coachExplanationCache')>()
  return { ...actual, loadCoachExplanationSet: vi.fn(actual.loadCoachExplanationSet) }
})

// cf-001 is a real puzzle with a real explanation file
// (src/content/explanations/cf-001.json) whose target 1 entry's
// misconception is "break-doesnt-exit-as-expected" — using real content
// here (not a mock) for the happy-path test is what actually proves the
// deep-import + shared-cache wiring works end to end, mirroring how
// PuzzleCardShell.test.tsx's own mcq fixture already reuses this exact
// puzzle id.
const mcqPuzzle: McqPuzzle = {
  id: 'cf-001',
  pattern: 'control-flow',
  difficulty_rating: 1100,
  explanation: 'Missing break causes fall-through into the silver case.',
  prompt: "What's the bug in this discount calculator?",
  language: 'javascript',
  snippet: "switch (tier) {\n  case 'gold':\n    discount = 20;\n}",
  interaction: 'mcq',
  choices: ['Missing break after gold', 'Wrong order', 'Should use const', 'Should use if/else'],
  correct_choice: 0,
}

// A puzzle id with no explanation file at all — proves the "no file yet" and
// "not-yet-generated" paths never crash and never call onCoachExplanationShown.
const puzzleWithNoExplanations: McqPuzzle = {
  ...mcqPuzzle,
  id: 'no-such-puzzle-id',
}

const swipePuzzle: SwipeBinaryPuzzle = {
  id: 'con-swipe-fixture',
  pattern: 'concurrency',
  difficulty_rating: 2000,
  explanation: 'Double-checked locking needs volatile.',
  prompt: 'Is this safe?',
  language: 'java',
  snippet: 'if (instance == null) { ... }',
  interaction: 'swipe-binary',
  left_label: 'Thread-safe',
  right_label: 'Race condition',
  correct_direction: 'right',
  correct_verdict: 'bug',
}

afterEach(() => {
  vi.mocked(loadCoachExplanationSet).mockClear()
  resetCoachExplanationCacheForTests()
})

describe('CoachPanel', () => {
  it('fetches and renders the real explanation entry when coachAvailable', async () => {
    const onShown = vi.fn()
    render(
      <CoachPanel
        puzzle={mcqPuzzle}
        committedPayload={{ correct: false, choiceIndex: 1 }}
        coachAvailable={true}
        onCoachExplanationShown={onShown}
      />,
    )

    // Plain-text fragment with no inline-markdown code spans in it, so it
    // lands in a single text node regardless of how renderInlineMarkdown
    // splits the surrounding sentence around backticked `break`/`case` spans.
    await waitFor(() => {
      expect(screen.getByText(/gold customers falling into the silver rate/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Misjudges what', { exact: false })).toBeInTheDocument()
    expect(onShown).toHaveBeenCalledTimes(1)
  }, 15000)

  it('never fetches and shows only the honest spent-meter line when coachAvailable is false', async () => {
    const onShown = vi.fn()
    render(
      <CoachPanel
        puzzle={mcqPuzzle}
        committedPayload={{ correct: false, choiceIndex: 1 }}
        coachAvailable={false}
        onCoachExplanationShown={onShown}
      />,
    )

    expect(await screen.findByText(/used your 2 coach explanations this week/i)).toBeInTheDocument()
    expect(loadCoachExplanationSet).not.toHaveBeenCalled()
    expect(onShown).not.toHaveBeenCalled()
  })

  it('renders nothing and never calls onCoachExplanationShown when no explanation file exists yet', async () => {
    const onShown = vi.fn()
    const { container } = render(
      <CoachPanel
        puzzle={puzzleWithNoExplanations}
        committedPayload={{ correct: false, choiceIndex: 1 }}
        coachAvailable={true}
        onCoachExplanationShown={onShown}
      />,
    )

    await waitFor(() => {
      expect(loadCoachExplanationSet).toHaveBeenCalledWith(puzzleWithNoExplanations.id)
    })
    expect(container).toBeEmptyDOMElement()
    expect(onShown).not.toHaveBeenCalled()
  }, 15000)

  it('resolves swipe-binary to target 0 regardless of choiceIndex (always null on the payload)', async () => {
    vi.mocked(loadCoachExplanationSet).mockResolvedValueOnce({
      puzzle_id: swipePuzzle.id,
      interaction: 'swipe-binary',
      generated_at: '2026-09-20T00:00:00.000Z',
      generator_version: 2,
      entries: [
        {
          target: 0,
          why_wrong: 'This direction is wrong because the lock alone does not publish safely.',
          misconception: 'dcl-missing-volatile',
        },
      ],
    })
    const onShown = vi.fn()
    render(
      <CoachPanel
        puzzle={swipePuzzle}
        committedPayload={{ correct: false, choiceIndex: null }}
        coachAvailable={true}
        onCoachExplanationShown={onShown}
      />,
    )

    await waitFor(() => {
      expect(onShown).toHaveBeenCalledTimes(1)
    })
    expect(loadCoachExplanationSet).toHaveBeenCalledWith(swipePuzzle.id)
  })
})
