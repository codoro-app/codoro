import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { puzzlePool } from '../../content'
import {
  CHALLENGE_PAYLOAD_VERSION,
  buildChallengePayload,
  buildChallengeUrl,
  decodeChallengePayload,
} from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'

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

const trackChallengeLinkView = vi.fn()
const trackChallengeLinkComplete = vi.fn()
const trackChallengeCreate = vi.fn()

// Same shape as PuzzlePage.test.tsx's telemetry mock: the shells challenge
// play reuses only need what PuzzlePageForId's tree needed, plus the three
// challenge events. Deliberately a full-module replace — not importOriginal —
// so PostHog never initializes in these tests.
vi.mock('../../telemetry', () => ({
  trackPuzzleLinkView: vi.fn(),
  trackPuzzleLinkAttempt: vi.fn(),
  trackError: vi.fn(),
  trackChallengeLinkView: (...args: unknown[]) => {
    trackChallengeLinkView(...args)
  },
  trackChallengeLinkComplete: (...args: unknown[]) => {
    trackChallengeLinkComplete(...args)
  },
  trackChallengeCreate: (...args: unknown[]) => {
    trackChallengeCreate(...args)
  },
}))

const { appendAttempt, saveProfile } = await import('../../storage')
const { ChallengePageForHash, ChallengePage } = await import('./ChallengePage')

/** Encodes raw attempts into a URL-fragment hash — the same encode path every surface ships. */
function fragmentFor(attempts: ChallengeAttemptInput[]): string {
  const hash = buildChallengeUrl(buildChallengePayload(attempts)).split('#')[1]
  if (!hash) throw new Error('expected buildChallengeUrl to produce a fragment')
  return hash
}

/** A 2-puzzle challenge that is easy to drive through the real UI: con-005 (mcq) then tc-009 (scrubber). */
function twoPuzzleHash(): string {
  return fragmentFor([
    { puzzleId: 'con-005', correct: false, time_ms: 1000 },
    { puzzleId: 'tc-009', correct: false, time_ms: 1000 },
  ])
}

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

/** Drives a real 2-puzzle challenge (mcq con-005 → scrubber tc-009) to full completion through the actual UI, ending in the done state. */
async function solveTwoPuzzleRun(user: ReturnType<typeof userEvent.setup>) {
  const [firstChoice] = await screen.findAllByRole('button')
  if (!firstChoice) throw new Error('expected at least one choice button')
  await user.click(firstChoice)
  await user.click(await screen.findByRole('button', { name: 'Next puzzle' }))

  await solveScrubberToCompletion(user)
  await user.click(await screen.findByRole('button', { name: 'Next puzzle' }))
}

beforeEach(() => {
  // clearAllMocks (not mockReset) so the storage mocks keep their resolving
  // implementations while every call record from the prior test is dropped —
  // the unrated assertion must start from a clean "never called" state.
  vi.clearAllMocks()
})

describe('ChallengePageForHash — dispatch against the real puzzlePool', () => {
  // The same "every bundled puzzle renders its native interaction" P0 that
  // PuzzlePage.test.tsx guards, applied to challenge play: a challenge link
  // can carry any interaction type, and each must render through its shell.
  it.each(puzzlePool.map((puzzle) => [puzzle.id, puzzle.interaction] as const))(
    'renders %s (%s) without throwing',
    (id, interaction) => {
      const { container } = render(
        <ChallengePageForHash
          hash={fragmentFor([{ puzzleId: id, correct: false, time_ms: 1000 }])}
        />,
      )
      if (interaction === 'scrubber') {
        expect(container.querySelector('.trace-runner')).toBeInTheDocument()
      } else {
        expect(container.querySelector('.puzzle-card')).toBeInTheDocument()
      }
    },
  )
})

describe('ChallengePageForHash — broken link states', () => {
  it('renders the broken state when the fragment does not decode', () => {
    render(<ChallengePageForHash hash="!not-valid-base64url!" />)
    expect(screen.getByText(/challenge link is broken/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /go to practice/i })).toBeInTheDocument()
    expect(trackChallengeLinkView).toHaveBeenCalledWith({ found: false })
  })

  it('renders the broken state when an id does not resolve to a bundled puzzle', () => {
    render(
      <ChallengePageForHash
        hash={fragmentFor([{ puzzleId: 'not-a-real-puzzle-id', correct: true, time_ms: 1000 }])}
      />,
    )
    expect(screen.getByText(/challenge link is broken/i)).toBeInTheDocument()
    expect(trackChallengeLinkView).toHaveBeenCalledWith({ found: false })
  })
})

describe('ChallengePageForHash — telemetry', () => {
  it('fires challenge_link_view once with found: true for a real challenge', () => {
    render(<ChallengePageForHash hash={twoPuzzleHash()} />)
    expect(trackChallengeLinkView).toHaveBeenCalledTimes(1)
    expect(trackChallengeLinkView).toHaveBeenCalledWith({ found: true })
  })

  it('fires challenge_link_complete with beat_challenger: false when the challenger cannot be beaten', async () => {
    const user = userEvent.setup()
    // Challenger: 2/2 at 0ms — the recipient can only tie (also false) or lose.
    render(
      <ChallengePageForHash
        hash={fragmentFor([
          { puzzleId: 'con-005', correct: true, time_ms: 0 },
          { puzzleId: 'tc-009', correct: true, time_ms: 0 },
        ])}
      />,
    )
    await solveTwoPuzzleRun(user)

    expect(trackChallengeLinkComplete).toHaveBeenCalledTimes(1)
    expect(trackChallengeLinkComplete).toHaveBeenCalledWith({ beat_challenger: false })
  })

  it('fires challenge_link_complete with beat_challenger: true when the recipient wins', async () => {
    const user = userEvent.setup()
    // Challenger: 0/2 at 60s — any correct answer wins, and even 0 correct
    // wins on total time, so the recipient's outcome is deterministic.
    render(
      <ChallengePageForHash
        hash={fragmentFor([
          { puzzleId: 'con-005', correct: false, time_ms: 30_000 },
          { puzzleId: 'tc-009', correct: false, time_ms: 30_000 },
        ])}
      />,
    )
    await solveTwoPuzzleRun(user)

    expect(trackChallengeLinkComplete).toHaveBeenCalledTimes(1)
    expect(trackChallengeLinkComplete).toHaveBeenCalledWith({ beat_challenger: true })
  })
})

describe('ChallengePageForHash — unrated (asserted at the storage boundary)', () => {
  // Decision 1 (same standard as /puzzle/:id): challenge play is structurally
  // unrated — no appendAttempt, no saveProfile, no rating math. The boundary
  // assertion is the storage layer: a full run across two puzzles must never
  // reach either write.
  it('never calls appendAttempt/saveProfile across a full multi-puzzle run', async () => {
    const user = userEvent.setup()
    render(<ChallengePageForHash hash={twoPuzzleHash()} />)
    await solveTwoPuzzleRun(user)

    expect(screen.getByText(/you got/i)).toBeInTheDocument() // done state reached
    expect(appendAttempt).not.toHaveBeenCalled()
    expect(saveProfile).not.toHaveBeenCalled()
  })
})

describe('ChallengePageForHash — duplicate puzzle id regression', () => {
  // A challenge payload can legally repeat the same puzzle id back-to-back
  // (a real Practice/Daily/Rush session can re-serve the same puzzle within
  // its soft no-repeat window, and a hand-edited link can do it on purpose).
  // Before the puzzleIndex-keyed fix, PuzzleCardShell's self-reset guard
  // (commit.puzzleId === puzzle.id) couldn't tell the two occurrences apart,
  // so the shell stayed permanently "committed" to the first occurrence's
  // feedback, the second occurrence's answer never registered, and the
  // player was stranded with a Continue button that never re-armed.
  it('does not softlock when a challenge repeats the same puzzle id back-to-back', async () => {
    const user = userEvent.setup()
    render(
      <ChallengePageForHash
        hash={fragmentFor([
          { puzzleId: 'con-005', correct: false, time_ms: 1000 },
          { puzzleId: 'con-005', correct: false, time_ms: 1000 },
        ])}
      />,
    )

    const [firstChoice] = await screen.findAllByRole('button')
    if (!firstChoice) throw new Error('expected at least one choice button')
    await user.click(firstChoice)
    await user.click(await screen.findByRole('button', { name: 'Next puzzle' }))

    // The second occurrence must render fresh — no feedback panel until it
    // is actually answered. Under the bug this was already present, stale,
    // the instant the second occurrence mounted.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    const [secondChoice] = await screen.findAllByRole('button')
    if (!secondChoice)
      throw new Error('expected at least one choice button on the second occurrence')
    await user.click(secondChoice)
    await user.click(await screen.findByRole('button', { name: 'Next puzzle' }))

    // Reaches the done state with both results recorded — the concrete
    // symptom of the softlock was never getting here.
    expect(await screen.findByText(/you got/i)).toBeInTheDocument()
  })
})

describe('ChallengePageForHash — comparison screen + counter-challenge', () => {
  it('shows the verdict, the recipient-vs-challenger line, and both CTAs after a full run', async () => {
    const user = userEvent.setup()
    render(<ChallengePageForHash hash={twoPuzzleHash()} />)
    await solveTwoPuzzleRun(user)

    // Verdict is one of the three resolveChallengeOutcome strings.
    expect(
      screen.getByText(/You beat the challenge|friend beat you|it.s a tie/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/they got/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share counter-challenge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy counter-challenge link' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /practice more like this/i })).toHaveAttribute(
      'href',
      '/practice',
    )
  })

  it('counter-challenge copies a link that re-encodes the recipient run', async () => {
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    const user = userEvent.setup()
    render(<ChallengePageForHash hash={twoPuzzleHash()} />)
    await solveTwoPuzzleRun(user)

    await user.click(screen.getByRole('button', { name: 'Copy counter-challenge link' }))
    await screen.findByRole('button', { name: 'Link copied!' })

    expect(trackChallengeCreate).toHaveBeenCalledWith({ surface: 'challenge', puzzle_count: 2 })
    const url = writeTextSpy.mock.calls[0]?.[0]
    if (typeof url !== 'string')
      throw new Error('expected writeText to have been called with a URL')
    const hash = url.split('#')[1]
    const decoded = decodeChallengePayload(hash ?? '')
    expect(decoded).not.toBeNull()
    // Play order is preserved, so the recipient's own run round-trips.
    expect(decoded?.ids).toEqual(['con-005', 'tc-009'])
    expect(decoded?.results).toHaveLength(2)
    for (const result of decoded?.results ?? []) {
      expect(typeof result.correct).toBe('boolean')
      expect(typeof result.time_ms).toBe('number')
    }
    expect(decoded?.v).toBe(CHALLENGE_PAYLOAD_VERSION)
    expect(decoded?.totalMs).toBe(decoded?.results.reduce((sum, r) => sum + r.time_ms, 0))
  })
})

describe('ChallengePage — the wrapper reads the real URL fragment', () => {
  // Regression for the bug that shipped: the wrapper originally read
  // `useLocation().split('#')`, but wouter's location is pathname-only
  // (use-browser-location.js: currentPathname = () => location.pathname), so
  // every real /challenge#<payload> cold load rendered the broken state.
  // The suite missed it because every other test drives ChallengePageForHash
  // with a raw hash prop — only these tests exercise the actual
  // window.location.hash path a real browser load hits (Finding 4: what a
  // green suite can't see, a cold browser load can).
  it('renders the challenge puzzle from a real URL fragment, not the broken state', () => {
    window.history.pushState({}, '', `/challenge#${twoPuzzleHash()}`)
    const { container } = render(<ChallengePage />)

    expect(container.querySelector('.puzzle-card')).toBeInTheDocument()
    expect(screen.queryByText(/challenge link is broken/i)).not.toBeInTheDocument()
    expect(trackChallengeLinkView).toHaveBeenCalledWith({ found: true })
  })

  it('remounts a fresh session when the URL fragment is edited', async () => {
    window.history.pushState({}, '', `/challenge#${twoPuzzleHash()}`)
    const { container } = render(<ChallengePage />)
    expect(container.querySelector('.puzzle-card')).toBeInTheDocument()

    // Editing the hash mid-session navigates the URL without a page load —
    // the same-document navigation a player does to "get a different
    // challenge". The key={hash} remount must land on the broken state, not
    // keep showing the previous challenge's puzzle.
    window.history.pushState({}, '', '/challenge#!not-valid-base64url!')
    window.dispatchEvent(new Event('hashchange'))

    // The hashchange listener's setState lands outside React's act() — the
    // re-render is async, so wait for the remounted broken state to appear.
    await waitFor(() => {
      expect(screen.getByText(/challenge link is broken/i)).toBeInTheDocument()
    })
    expect(container.querySelector('.puzzle-card')).not.toBeInTheDocument()
  })
})
