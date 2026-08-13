import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { puzzlePool } from '../../content'

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(() => Promise.resolve(actual.createDefaultProfile())),
    saveProfile: vi.fn(() => Promise.resolve(undefined)),
    appendAttempt: vi.fn(() => Promise.resolve(undefined)),
    listAttempts: vi.fn(() => Promise.resolve([])),
  }
})

const trackPuzzleLinkView = vi.fn()
const trackPuzzleLinkAttempt = vi.fn()

vi.mock('../../telemetry', () => ({
  trackPuzzleLinkView: (...args: unknown[]) => {
    trackPuzzleLinkView(...args)
  },
  trackPuzzleLinkAttempt: (...args: unknown[]) => {
    trackPuzzleLinkAttempt(...args)
  },
  trackError: vi.fn(),
}))

const { appendAttempt, saveProfile } = await import('../../storage')
const { PuzzlePageForId } = await import('./PuzzlePage')

/** Drives a mounted scrubber puzzle to full completion via the real UI: repeatedly answers whichever checkpoint is pending and advances via "Next step" until every checkpoint has a result. Generic over checkpoint count/placement so it works for any real scrubberPool puzzle. */
async function solveScrubberToCompletion(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 200; i++) {
    const choiceButtons = screen.queryAllByRole('button', {
      name: /./,
    })
    const unansweredChoice = choiceButtons.find((button) =>
      button.className.includes('checkpoint-choice'),
    )
    if (unansweredChoice && !unansweredChoice.hasAttribute('disabled')) {
      await user.click(unansweredChoice)
      continue
    }
    const nextButton = screen.queryByRole('button', { name: 'Next step' })
    if (nextButton && !nextButton.hasAttribute('disabled')) {
      await user.click(nextButton)
      continue
    }
    return // no more moves available — either complete, or genuinely stuck
  }
  throw new Error('solveScrubberToCompletion: exceeded iteration budget without completing')
}

describe('PuzzlePageForId — dispatch against the real puzzlePool', () => {
  // The corrective's own P0 (docs/v2-phase2-review.md) was exactly "a puzzle
  // interaction type reachable with nothing to render it" — cheap, real
  // coverage: every bundled puzzle renders its native interaction and
  // nothing throws. Not a fixture — the real, shipped content pool.
  it.each(puzzlePool.map((puzzle) => [puzzle.id, puzzle.interaction] as const))(
    'renders %s (%s) without throwing',
    (id, interaction) => {
      const { container } = render(<PuzzlePageForId id={id} />)
      if (interaction === 'scrubber') {
        expect(container.querySelector('.trace-runner')).toBeInTheDocument()
      } else {
        expect(container.querySelector('.puzzle-card')).toBeInTheDocument()
      }
    },
  )
})

describe('PuzzlePageForId — unrated (asserted at the storage boundary)', () => {
  it('never calls appendAttempt/saveProfile across a full quiz solve', async () => {
    const user = userEvent.setup()
    // con-005 is a real, bundled mcq puzzle.
    render(<PuzzlePageForId id="con-005" />)
    const [firstChoice] = await screen.findAllByRole('button')
    if (!firstChoice) throw new Error('expected at least one choice button')
    await user.click(firstChoice)

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    expect(appendAttempt).not.toHaveBeenCalled()
    expect(saveProfile).not.toHaveBeenCalled()
  })

  it('never calls appendAttempt/saveProfile across a full scrubber solve', async () => {
    const user = userEvent.setup()
    // tc-009 is a real, bundled scrubber puzzle.
    render(<PuzzlePageForId id="tc-009" />)
    await solveScrubberToCompletion(user)

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    expect(appendAttempt).not.toHaveBeenCalled()
    expect(saveProfile).not.toHaveBeenCalled()
  })

  it('never displays a computed rating delta — ratingDelta is always null on this surface', async () => {
    const user = userEvent.setup()
    render(<PuzzlePageForId id="con-005" />)
    const [firstChoice] = await screen.findAllByRole('button')
    if (!firstChoice) throw new Error('expected at least one choice button')
    await user.click(firstChoice)

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    expect(document.querySelector('.feedback-panel__delta')).not.toBeInTheDocument()
  })
})

describe('PuzzlePageForId — telemetry', () => {
  it('fires puzzle_link_view once with found: true and the real interaction for a real id', () => {
    trackPuzzleLinkView.mockClear()
    render(<PuzzlePageForId id="con-005" />)
    expect(trackPuzzleLinkView).toHaveBeenCalledTimes(1)
    expect(trackPuzzleLinkView).toHaveBeenCalledWith({
      puzzle_id: 'con-005',
      interaction: 'mcq',
      found: true,
    })
  })

  it('fires puzzle_link_view with found: false and a null interaction for an unknown id', () => {
    trackPuzzleLinkView.mockClear()
    render(<PuzzlePageForId id="not-a-real-puzzle-id" />)
    expect(trackPuzzleLinkView).toHaveBeenCalledWith({
      puzzle_id: 'not-a-real-puzzle-id',
      interaction: null,
      found: false,
    })
  })

  it('fires puzzle_link_attempt once a quiz answer is committed', async () => {
    trackPuzzleLinkAttempt.mockClear()
    const user = userEvent.setup()
    render(<PuzzlePageForId id="con-005" />)
    const [firstChoice] = await screen.findAllByRole('button')
    if (!firstChoice) throw new Error('expected at least one choice button')
    await user.click(firstChoice)

    expect(trackPuzzleLinkAttempt).toHaveBeenCalledTimes(1)
    expect(trackPuzzleLinkAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ puzzle_id: 'con-005', interaction: 'mcq' }),
    )
  })

  it('fires puzzle_link_attempt once every scrubber checkpoint is answered', async () => {
    trackPuzzleLinkAttempt.mockClear()
    const user = userEvent.setup()
    render(<PuzzlePageForId id="tc-009" />)
    await solveScrubberToCompletion(user)

    expect(trackPuzzleLinkAttempt).toHaveBeenCalledTimes(1)
    expect(trackPuzzleLinkAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ puzzle_id: 'tc-009', interaction: 'scrubber' }),
    )
  })

  // Finding 2 (v2 Phase 1b corrective): trackPuzzleLinkAttempt used to fire
  // from inside the setCheckpointResults updater, which React (deliberately,
  // under StrictMode) can invoke more than once per logical update — a
  // double-fire that would corrupt the one telemetry record link-play
  // completion is evaluated by (Decision 1: no rated attempts are ever
  // recorded for this surface). Wrapping in StrictMode here is what would
  // have caught it; a plain render() would not.
  it('fires puzzle_link_attempt exactly once per completed scrubber link attempt under StrictMode', async () => {
    trackPuzzleLinkAttempt.mockClear()
    const user = userEvent.setup()
    render(<PuzzlePageForId id="tc-009" />, { wrapper: StrictMode })
    await solveScrubberToCompletion(user)

    expect(trackPuzzleLinkAttempt).toHaveBeenCalledTimes(1)
    expect(trackPuzzleLinkAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ puzzle_id: 'tc-009', interaction: 'scrubber' }),
    )
  })
})

describe('PuzzlePageForId — not-found state', () => {
  it('renders a real in-app not-found state for an unknown id, not a crash', () => {
    render(<PuzzlePageForId id="definitely-not-a-real-id" />)
    expect(screen.getByText(/couldn.t find that puzzle/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /go to practice/i })).toBeInTheDocument()
  })
})

describe('PuzzlePageForId — "practice more like this" CTA', () => {
  it("links into /practice filtered to the puzzle's own pattern", () => {
    const puzzle = puzzlePool.find((candidate) => candidate.id === 'con-005')
    if (!puzzle) throw new Error('expected con-005 to exist in puzzlePool')
    render(<PuzzlePageForId id="con-005" />)
    const cta = screen.getByRole('link', { name: /practice more like this/i })
    expect(cta).toHaveAttribute('href', `/practice?pattern=${puzzle.pattern}`)
  })
})

describe('PuzzlePageForId — Continue button navigates (Phase 5 Item 1)', () => {
  // Revert check: asserting the button exists/is clickable is not enough —
  // an onContinue={() => {}} no-op renders and is clickable too. Only
  // asserting the resulting location proves it isn't dead. Reset both
  // before and after: jsdom gives this whole file one shared window, so a
  // before-only or after-only reset would make each test's precondition
  // depend on file-wide declaration order rather than being self-contained.
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('navigates to /practice?pattern=<slug> on a quiz puzzle after answering', async () => {
    const puzzle = puzzlePool.find((candidate) => candidate.id === 'con-005')
    if (!puzzle) throw new Error('expected con-005 to exist in puzzlePool')
    const user = userEvent.setup()
    render(<PuzzlePageForId id="con-005" />)

    const [firstChoice] = await screen.findAllByRole('button')
    if (!firstChoice) throw new Error('expected at least one choice button')
    await user.click(firstChoice)

    const continueButton = await screen.findByRole('button', { name: 'Next puzzle' })
    await user.click(continueButton)

    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        `/practice?pattern=${puzzle.pattern}`,
      )
    })
  })

  it('navigates to /practice?pattern=<slug> on a scrubber puzzle after full completion', async () => {
    const puzzle = puzzlePool.find((candidate) => candidate.id === 'tc-009')
    if (!puzzle) throw new Error('expected tc-009 to exist in puzzlePool')
    const user = userEvent.setup()
    render(<PuzzlePageForId id="tc-009" />)
    await solveScrubberToCompletion(user)

    const continueButton = await screen.findByRole('button', { name: 'Next puzzle' })
    await user.click(continueButton)

    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        `/practice?pattern=${puzzle.pattern}`,
      )
    })
  })
})
