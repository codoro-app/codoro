import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChallengeAttemptInput, ChallengePayload } from '../../challenge'
import { CHALLENGE_PAYLOAD_VERSION } from '../../challenge'

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(() => Promise.resolve(actual.createDefaultProfile())),
    saveProfile: vi.fn(() => Promise.resolve(undefined)),
  }
})

const trackChallengeCreate = vi.fn()
vi.mock('../../telemetry', () => ({
  trackError: vi.fn(),
  trackChallengeCreate: (...args: unknown[]) => {
    trackChallengeCreate(...args)
  },
}))

const { saveProfile } = await import('../../storage')
const { ChallengeComparison } = await import('./ChallengeComparison')

function payload(overrides: Partial<ChallengePayload> = {}): ChallengePayload {
  return {
    v: CHALLENGE_PAYLOAD_VERSION,
    ids: ['con-005'],
    results: [{ correct: true, time_ms: 4000 }],
    totalMs: 4000,
    challengerName: null,
    ...overrides,
  }
}

const yours: ChallengeAttemptInput[] = [{ puzzleId: 'con-005', correct: false, time_ms: 9000 }]

describe('ChallengeComparison — challenger-name copy substitution (challenge redesign)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('substitutes the challenger name into the "lost" verdict and the stats line', () => {
    render(<ChallengeComparison theirs={payload({ challengerName: 'Joe' })} yours={yours} />)

    expect(screen.getByText('Joe beat you')).toBeInTheDocument()
    expect(screen.getByText(/Joe got 1\/1 in 4s/)).toBeInTheDocument()
  })

  it('falls back to the generic "Your friend"/"they" copy when challengerName is null', () => {
    render(<ChallengeComparison theirs={payload({ challengerName: null })} yours={yours} />)

    expect(screen.getByText('Your friend beat you')).toBeInTheDocument()
    expect(screen.getByText(/they got 1\/1 in 4s/)).toBeInTheDocument()
  })

  it('a tie never substitutes the name (its copy names neither side)', () => {
    render(
      <ChallengeComparison
        theirs={payload({
          challengerName: 'Joe',
          results: [{ correct: false, time_ms: 9000 }],
          // Same correct count (0) and same totalMs as `yours` (9000) — a
          // genuine tie, not just a same-correct-count near-miss.
          totalMs: 9000,
        })}
        yours={yours}
      />,
    )
    expect(screen.getByText('It’s a tie')).toBeInTheDocument()
  })
})

describe('ChallengeComparison — counter-challenge via ChallengeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a "Challenge a friend" button (not the old inline ShareMenu row) fed the recipient\'s own run', async () => {
    render(<ChallengeComparison theirs={payload()} yours={yours} />)
    expect(await screen.findByRole('button', { name: /challenge a friend/i })).toBeInTheDocument()
  })

  it('prompts for a name on first use (no saved challengerName on the loaded profile), then sends with surface: "challenge"', async () => {
    const user = userEvent.setup()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    render(<ChallengeComparison theirs={payload()} yours={yours} />)

    await user.click(await screen.findByRole('button', { name: /challenge a friend/i }))
    expect(screen.getByRole('dialog', { name: 'Your name' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    await waitFor(() => {
      expect(trackChallengeCreate).toHaveBeenCalledWith({ surface: 'challenge', puzzle_count: 1 })
    })
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('beat my counter-challenge'))
    expect(saveProfile).not.toHaveBeenCalled()
  })
})
