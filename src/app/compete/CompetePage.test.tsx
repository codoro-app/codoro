import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Same full-module-replace shape as ChallengePage.test.tsx's own telemetry
// mock — a full replace (not importOriginal) so PostHog never initializes.
vi.mock('../../telemetry', () => ({
  trackPuzzleLinkView: vi.fn(),
  trackPuzzleLinkAttempt: vi.fn(),
  trackError: vi.fn(),
  trackChallengeLinkView: vi.fn(),
  trackChallengeLinkComplete: vi.fn(),
  trackChallengeCreate: vi.fn(),
}))

const { CompetePage } = await import('./CompetePage')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CompetePage — abandoning a Play Computer race, then Play Human', () => {
  // Regression test for the QA report (2026-09-17): a remote session
  // abandoned an in-progress Play Computer race by navigating directly back
  // to /compete via the URL bar (not any in-app exit control), then found
  // Play Human unresponsive. A real browser reload fully remounts the JS
  // runtime, which is strictly more of a reset than a plain React unmount —
  // this test uses `unmount`+re-`render` as the closest same-process proxy
  // for that reset. Investigation traced the reported no-op to a QA-tooling
  // artifact (a stale accessibility-tree element reference resolved right
  // after the reload), not app state: this test locks in that a genuinely
  // fresh CompetePage mount always lets Play Human proceed, regardless of
  // what happened in a prior, discarded instance.
  it('opens a fresh level picker for Play Human after a Play Computer race is abandoned via full remount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<CompetePage />)

    await user.click(screen.getByRole('button', { name: /play computer/i }))
    await user.click(screen.getByText('Novice'))
    await user.click(await screen.findByRole('button', { name: /accept challenge/i }))
    // Mid-race: the puzzle content is loading/rendered, matching the QA
    // report's "stepped through part of the puzzle" before abandoning.
    await screen.findAllByRole('button')

    unmount()

    render(<CompetePage />)
    await user.click(screen.getByRole('button', { name: /play human/i }))
    expect(await screen.findByText('Pick a level')).toBeInTheDocument()

    await user.click(screen.getByText('Novice'))
    expect(await screen.findByText(/^Puzzle 1 of/)).toBeInTheDocument()
  })
})

describe('CompetePage — Quit control on an active race', () => {
  // QA report (2026-09-17), issue #2: once a race starts there was no
  // back/quit/exit control anywhere on screen — the sidebar nav was the only
  // way out, and it silently abandoned the race with no visual framing as an
  // exit action. These lock in the added Quit control for both doors.
  it('Play Computer: Quit returns to the Compete menu mid-race', async () => {
    const user = userEvent.setup()
    render(<CompetePage />)

    await user.click(screen.getByRole('button', { name: /play computer/i }))
    await user.click(screen.getByText('Novice'))
    await user.click(await screen.findByRole('button', { name: /accept challenge/i }))
    await screen.findAllByRole('button')

    await user.click(screen.getByRole('button', { name: 'Quit' }))

    expect(screen.getByRole('button', { name: /play computer/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /play human/i })).toBeInTheDocument()
  })

  it('Play Human: Quit returns to the Compete menu mid-race', async () => {
    const user = userEvent.setup()
    render(<CompetePage />)

    await user.click(screen.getByRole('button', { name: /play human/i }))
    await user.click(screen.getByText('Novice'))
    await screen.findByText(/^Puzzle 1 of/)

    await user.click(screen.getByRole('button', { name: 'Quit' }))

    expect(screen.getByRole('button', { name: /play computer/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /play human/i })).toBeInTheDocument()
  })
})
