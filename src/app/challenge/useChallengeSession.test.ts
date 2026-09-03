import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { buildChallengePayload, buildChallengeUrl } from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'
import { useChallengeSession } from './useChallengeSession'

vi.mock('../../telemetry', () => ({
  trackChallengeLinkView: vi.fn(),
  trackChallengeLinkComplete: vi.fn(),
  trackError: vi.fn(),
}))

// Review-fix regression coverage (race + rejection tests below) needs a
// controllable getPuzzleBody — wrapped in a vi.fn whose DEFAULT
// implementation is the real one (the pre-existing test above still
// exercises the real, bundled content), overridden per-test only where
// needed.
vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, getPuzzleBody: vi.fn(actual.getPuzzleBody) }
})

const { trackChallengeLinkComplete, trackChallengeLinkView, trackError } =
  await import('../../telemetry')
const { getPuzzleBody } = await import('../../content')
const { getPuzzleBody: realGetPuzzleBody } =
  await vi.importActual<typeof import('../../content')>('../../content')

afterEach(() => {
  // Any race/rejection test below that overrides getPuzzleBody's
  // implementation must not leak that override into later tests.
  vi.mocked(getPuzzleBody).mockImplementation(realGetPuzzleBody)
})

/** Encodes raw attempts into a URL-fragment hash — same encode path every surface ships. `challengerName` defaults to null; these tests don't exercise the intro hero's greeting copy. */
function fragmentFor(
  attempts: ChallengeAttemptInput[],
  challengerName: string | null = null,
): string {
  const hash = buildChallengeUrl(buildChallengePayload(attempts, challengerName)).split('#')[1]
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
    // session. Challenge redesign: resolution now lands on 'intro', not
    // 'playing' — handleAccept is the new gate into 'playing'.
    await waitFor(() => {
      expect(result.current.status).toBe('intro')
    })
    act(() => {
      result.current.handleAccept()
    })
    expect(result.current.status).toBe('playing')

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

describe('useChallengeSession — intro status + handleAccept (challenge redesign)', () => {
  it('holds at "intro" once resolved, never reaching "playing" on its own', async () => {
    const hash = fragmentFor([{ puzzleId: 'con-005', correct: true, time_ms: 500 }])
    const { result } = renderHook(() => useChallengeSession(hash))

    await waitFor(() => {
      expect(result.current.status).toBe('intro')
    })
    // No puzzle is exposed yet — `puzzle` stays null outside 'playing', same
    // guard as loading/broken.
    expect(result.current.puzzle).toBeNull()

    // Stays on 'intro' — no auto-advance, unlike the pre-redesign behavior.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(result.current.status).toBe('intro')
  })

  it('handleAccept flips status to "playing" and is idempotent against a second call', async () => {
    const hash = fragmentFor([{ puzzleId: 'con-005', correct: true, time_ms: 500 }])
    const { result } = renderHook(() => useChallengeSession(hash))
    await waitFor(() => {
      expect(result.current.status).toBe('intro')
    })

    act(() => {
      result.current.handleAccept()
      result.current.handleAccept()
    })

    expect(result.current.status).toBe('playing')
    expect(result.current.puzzle?.id).toBe('con-005')
  })

  // The correctness fix this whole status exists for: puzzle 1's clock must
  // start at handleAccept, not at resolution — otherwise however long a
  // recipient spends reading the intro hero would unfairly count toward
  // their first puzzle's time_ms.
  it("excludes the pre-accept window from puzzle 1's recorded time_ms", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const hash = fragmentFor([{ puzzleId: 'con-005', correct: true, time_ms: 500 }])
      const { result } = renderHook(() => useChallengeSession(hash))
      await vi.waitFor(() => {
        expect(result.current.status).toBe('intro')
      })

      // Simulate the recipient reading the hero for a while before accepting.
      vi.advanceTimersByTime(5000)
      act(() => {
        result.current.handleAccept()
      })

      // Answer "immediately" after accepting — real elapsed time since
      // accept is ~0ms, nowhere near the 5s spent on the intro hero.
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })

      const recorded = result.current.results[0]
      expect(recorded?.time_ms).toBeLessThan(1000)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useChallengeSession — review-fix regression coverage (async payload-change race + rejection)', () => {
  // Important #1 (same defeated-guard shape as PuzzlePage.tsx's Critical
  // finding): a single shared `useRef(false)` reset at the top of every
  // effect run couldn't distinguish "the run that got cancelled" from "the
  // run that replaced it". In-app this is masked by ChallengePage's
  // key={hash} remount, but this hook's own module doc comment claims it
  // "stays correct standalone too" — this test drives that claim directly,
  // the way ChallengePage never does.
  it('does not resolve to a stale, superseded hash when getPuzzleBody resolves out of order across a hash change', async () => {
    const hashA = fragmentFor([{ puzzleId: 'con-005', correct: true, time_ms: 500 }])
    const hashB = fragmentFor([{ puzzleId: 'tc-009', correct: true, time_ms: 500 }])

    let releaseA!: (puzzle: Awaited<ReturnType<typeof realGetPuzzleBody>>) => void
    const fetchA = new Promise<Awaited<ReturnType<typeof realGetPuzzleBody>>>((resolve) => {
      releaseA = resolve
    })
    vi.mocked(getPuzzleBody).mockImplementation((id: string) => {
      if (id === 'con-005') return fetchA
      return realGetPuzzleBody(id)
    })

    const { result, rerender } = renderHook(({ hash }) => useChallengeSession(hash), {
      initialProps: { hash: hashA },
    })
    expect(result.current.status).toBe('loading')

    // The hash changes before hashA's fetch has resolved — driving the hook
    // directly (no ChallengePage remount), exactly what the module doc
    // comment's "stays correct standalone" claim is about.
    rerender({ hash: hashB })
    await waitFor(() => {
      expect(result.current.status).toBe('intro')
    })
    act(() => {
      result.current.handleAccept()
    })
    expect(result.current.puzzle?.id).toBe('tc-009')

    // Now let the stale, superseded hashA fetch resolve.
    releaseA(await realGetPuzzleBody('con-005'))
    await waitFor(() => {
      // Still hashB's puzzle — the stale result must not have won.
      expect(result.current.puzzle?.id).toBe('tc-009')
    })
  })

  // Important #2: a rejected getPuzzleBody (failed dynamic import, or the
  // zod validation throw on invalid content) must not hang the run in
  // 'loading' forever — reject-wholesale already treats "this challenge
  // can't be played" as one legible 'broken' state, so a fetch failure is
  // just one more way to reach it.
  it('resolves to broken instead of hanging when getPuzzleBody rejects', async () => {
    const failure = new Error('chunk load failed')
    vi.mocked(getPuzzleBody).mockRejectedValue(failure)
    const hash = fragmentFor([{ puzzleId: 'con-005', correct: true, time_ms: 500 }])

    const { result } = renderHook(() => useChallengeSession(hash))
    expect(result.current.status).toBe('loading')

    await waitFor(() => {
      expect(result.current.status).toBe('broken')
    })
    expect(trackError).toHaveBeenCalledWith(failure, 'useChallengeSession: getPuzzleBody failed')
    expect(trackChallengeLinkView).toHaveBeenCalledWith({ found: false })
  })
})
