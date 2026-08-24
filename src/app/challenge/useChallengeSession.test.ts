import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { buildChallengePayload, buildChallengeUrl } from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'
import { useChallengeSession } from './useChallengeSession'

vi.mock('../../telemetry', () => ({
  trackChallengeLinkView: vi.fn(),
  trackChallengeLinkComplete: vi.fn(),
}))

const { trackChallengeLinkComplete } = await import('../../telemetry')

/** Encodes raw attempts into a URL-fragment hash — same encode path every surface ships. */
function fragmentFor(attempts: ChallengeAttemptInput[]): string {
  const hash = buildChallengeUrl(buildChallengePayload(attempts)).split('#')[1]
  if (!hash) throw new Error('expected buildChallengeUrl to produce a fragment')
  return hash
}

describe('useChallengeSession — run-end re-entrancy', () => {
  // isComplete stays true for every render between the click that ends the
  // run and the setPuzzleIndex update actually committing, so a rapid
  // double-dispatch of handleContinue (fast double-click, or two calls
  // queued in the same tick) must not double-fire the run's only completion
  // telemetry. Regression for the gap the checkpoint path already guards
  // against via checkpointResultsRef but the run-end path originally didn't.
  it('fires challenge_link_complete only once when handleContinue is dispatched twice in the same tick', async () => {
    const hash = fragmentFor([{ puzzleId: 'con-005', correct: true, time_ms: 500 }])
    const { result } = renderHook(() => useChallengeSession(hash))

    // Task 6: the puzzle body now resolves via a real async getPuzzleBody
    // call — wait for that to settle before driving the handlers, or
    // handleAnswered/handleContinue are no-ops against a still-'loading'
    // session.
    await waitFor(() => {
      expect(result.current.status).toBe('playing')
    })

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })

    act(() => {
      // Both calls run against the same pre-update closure — exactly the
      // race a fast double-click or a double-dispatched event produces.
      result.current.handleContinue()
      result.current.handleContinue()
    })

    expect(trackChallengeLinkComplete).toHaveBeenCalledTimes(1)
  })
})
