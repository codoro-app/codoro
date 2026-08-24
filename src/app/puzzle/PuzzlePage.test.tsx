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
const trackError = vi.fn()

vi.mock('../../telemetry', () => ({
  trackPuzzleLinkView: (...args: unknown[]) => {
    trackPuzzleLinkView(...args)
  },
  trackPuzzleLinkAttempt: (...args: unknown[]) => {
    trackPuzzleLinkAttempt(...args)
  },
  trackError: (...args: unknown[]) => {
    trackError(...args)
  },
}))

// Review-fix regression coverage (race + rejection tests below) needs a
// controllable getPuzzleBody — wrapped in a vi.fn whose DEFAULT
// implementation is the real one (every other test in this file still
// exercises the real, bundled content), overridden per-test via
// mockImplementation/mockImplementationOnce only where needed.
vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, getPuzzleBody: vi.fn(actual.getPuzzleBody) }
})

const { appendAttempt, saveProfile } = await import('../../storage')
const { getPuzzleBody } = await import('../../content')
const { getPuzzleBody: realGetPuzzleBody } =
  await vi.importActual<typeof import('../../content')>('../../content')
const { PuzzlePageForId } = await import('./PuzzlePage')

afterEach(() => {
  // Any race/rejection test below that overrides getPuzzleBody's
  // implementation must not leak that override into later tests, which all
  // assume the real, bundled lookup.
  vi.mocked(getPuzzleBody).mockImplementation(realGetPuzzleBody)
})

/** Drives a mounted scrubber puzzle to full completion via the real UI: repeatedly answers whichever checkpoint is pending and advances via "Next step" until every checkpoint has a result. Generic over checkpoint count/placement so it works for any real scrubberPool puzzle. */
async function solveScrubberToCompletion(user: ReturnType<typeof userEvent.setup>) {
  // Task 6: the puzzle body now resolves via a real async getPuzzleBody
  // call — wait past the loading state, or the loop below finds no
  // checkpoint buttons yet and returns immediately, mistaking "not rendered
  // yet" for "already complete".
  await waitFor(() => {
    expect(screen.queryByText(/loading puzzle/i)).not.toBeInTheDocument()
  })
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
  // nothing throws. Not a fixture — the real, shipped content pool. Task 6:
  // the puzzle body now resolves via a real async getPuzzleBody call, so
  // this waits for the resolved render instead of asserting synchronously.
  it.each(puzzlePool.map((puzzle) => [puzzle.id, puzzle.interaction] as const))(
    'renders %s (%s) without throwing',
    async (id, interaction) => {
      const { container } = render(<PuzzlePageForId id={id} />)
      if (interaction === 'scrubber') {
        await waitFor(() => {
          expect(container.querySelector('.trace-runner')).toBeInTheDocument()
        })
      } else {
        await waitFor(() => {
          expect(container.querySelector('.puzzle-card')).toBeInTheDocument()
        })
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
  it('fires puzzle_link_view once with found: true and the real interaction for a real id', async () => {
    trackPuzzleLinkView.mockClear()
    render(<PuzzlePageForId id="con-005" />)
    // Task 6: fires once the real async getPuzzleBody call settles, not on
    // mount.
    await waitFor(() => {
      expect(trackPuzzleLinkView).toHaveBeenCalledTimes(1)
    })
    expect(trackPuzzleLinkView).toHaveBeenCalledWith({
      puzzle_id: 'con-005',
      interaction: 'mcq',
      found: true,
    })
  })

  it('fires puzzle_link_view with found: false and a null interaction for an unknown id', async () => {
    trackPuzzleLinkView.mockClear()
    render(<PuzzlePageForId id="not-a-real-puzzle-id" />)
    await waitFor(() => {
      expect(trackPuzzleLinkView).toHaveBeenCalledWith({
        puzzle_id: 'not-a-real-puzzle-id',
        interaction: null,
        found: false,
      })
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

describe('PuzzlePageForId — review-fix regression coverage (async id-change race + rejection)', () => {
  // Critical review finding: a single shared `useRef(false)` reset to
  // `false` at the top of every effect run couldn't distinguish "the run
  // that got cancelled" from "the run that replaced it" — an id change
  // (real app: navigating link-to-link on this un-keyed route, App.tsx's
  // `<Route path="/puzzle/:id">`) whose OLDER fetch resolves AFTER its
  // NEWER one would let the older result win, rendering the wrong puzzle
  // with `loading: false`. Reproduces the exact race: id 'con-005' is
  // deliberately held pending while id 'tc-009' is allowed to resolve and
  // render first, then the held-back 'con-005' fetch is released — it must
  // not clobber the already-rendered 'tc-009'.
  it('does not render a stale puzzle when getPuzzleBody resolves out of order across an id change', async () => {
    trackPuzzleLinkView.mockClear()
    let releaseFirst!: (puzzle: Awaited<ReturnType<typeof realGetPuzzleBody>>) => void
    const firstFetch = new Promise<Awaited<ReturnType<typeof realGetPuzzleBody>>>((resolve) => {
      releaseFirst = resolve
    })
    vi.mocked(getPuzzleBody).mockImplementation((id: string) => {
      if (id === 'con-005') return firstFetch
      return realGetPuzzleBody(id)
    })

    const { container, rerender } = render(<PuzzlePageForId id="con-005" />)
    expect(screen.getByText(/loading puzzle/i)).toBeInTheDocument()

    // The id changes before the first fetch has resolved — same prop
    // change a real un-keyed route navigation produces, no remount.
    rerender(<PuzzlePageForId id="tc-009" />)
    await waitFor(() => {
      expect(container.querySelector('.trace-runner')).toBeInTheDocument()
    })

    // Now let the stale, superseded 'con-005' fetch resolve.
    releaseFirst(await realGetPuzzleBody('con-005'))
    await waitFor(() => {
      // Still tc-009 — the stale result must not have won.
      expect(container.querySelector('.trace-runner')).toBeInTheDocument()
      expect(container.querySelector('.puzzle-card')).not.toBeInTheDocument()
    })
    // And it must not have fired its own (stale) telemetry either.
    expect(trackPuzzleLinkView).not.toHaveBeenCalledWith(
      expect.objectContaining({ puzzle_id: 'con-005' }),
    )
  })

  // Important #3: PuzzlePage had no double-fire guard on trackPuzzleLinkView
  // (unlike useChallengeSession.ts's viewTrackedRef) — under StrictMode's
  // dev-only double-invoke, the same disarmed-guard mechanism as the
  // Critical finding let both effect invocations reach it. The runTokenRef
  // fix (each invocation gets its own token, even repeat invocations for
  // the same id) closes this for free.
  it('fires puzzle_link_view exactly once for a given id under StrictMode', async () => {
    trackPuzzleLinkView.mockClear()
    render(<PuzzlePageForId id="con-005" />, { wrapper: StrictMode })
    await waitFor(() => {
      expect(trackPuzzleLinkView).toHaveBeenCalled()
    })
    expect(trackPuzzleLinkView).toHaveBeenCalledTimes(1)
    expect(trackPuzzleLinkView).toHaveBeenCalledWith({
      puzzle_id: 'con-005',
      interaction: 'mcq',
      found: true,
    })
  })

  // Important #2: a rejected getPuzzleBody (failed dynamic import, or the
  // zod validation throw on invalid content) must not hang the page in
  // `loading` forever.
  it('clears the loading state and reports the error instead of hanging when getPuzzleBody rejects', async () => {
    const failure = new Error('chunk load failed')
    vi.mocked(getPuzzleBody).mockRejectedValue(failure)

    render(<PuzzlePageForId id="con-005" />)
    expect(screen.getByText(/loading puzzle/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByText(/loading puzzle/i)).not.toBeInTheDocument()
    })
    expect(trackError).toHaveBeenCalledWith(failure, 'PuzzlePage: getPuzzleBody failed')
  })
})

describe('PuzzlePageForId — not-found state', () => {
  it('renders a loading state, then the real in-app not-found state for an unknown id, not a crash', async () => {
    render(<PuzzlePageForId id="definitely-not-a-real-id" />)
    // Task 6: the lookup is now a real async getPuzzleBody call, so the
    // page must render a distinct loading state first — an unresolved-yet
    // id should never be briefly mistaken for a genuinely missing one.
    expect(screen.getByText(/loading puzzle/i)).toBeInTheDocument()
    expect(screen.queryByText(/couldn.t find that puzzle/i)).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/couldn.t find that puzzle/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /go to practice/i })).toBeInTheDocument()
  })
})

describe('PuzzlePageForId — "practice more like this" CTA', () => {
  it("links into /practice filtered to the puzzle's own pattern", async () => {
    const puzzle = puzzlePool.find((candidate) => candidate.id === 'con-005')
    if (!puzzle) throw new Error('expected con-005 to exist in puzzlePool')
    render(<PuzzlePageForId id="con-005" />)
    const cta = await screen.findByRole('link', { name: /practice more like this/i })
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
