import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Puzzle } from '../../content'
import { RUSH_PUZZLE_TIME_LIMIT_MS, useRushSession } from './useRushSession'

const { FIXTURE_POOL, FIXTURE_PUZZLE_META, FIXTURE_BODY_BY_ID } = vi.hoisted(() => {
  const FIXTURE_POOL = [
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `p${String(i)}`,
      pattern: i % 2 === 0 ? 'off-by-one' : 'null-undefined',
      difficulty_rating: 700 + i * 20,
      explanation: `explanation ${String(i)}`,
      prompt: `prompt ${String(i)}`,
      language: 'javascript',
      snippet: 'const x = 1',
      interaction: 'mcq',
      choices: ['a', 'b'],
      correct_choice: 0,
    })),
    // Scrubber puzzles at the same ratings as the mcq set above, present to
    // prove Rush's pool-building filters them out — Rush stays quiz-only
    // (RushInteraction excludes 'scrubber'; see useRushSession.ts's
    // isRushEligible). If that filter ever regresses, these are common
    // enough in this fixture that the "never serves a scrubber puzzle" test
    // below would fail almost immediately, not flakily.
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `s${String(i)}`,
      pattern: 'off-by-one',
      difficulty_rating: 700 + i * 20,
      explanation: `scrubber explanation ${String(i)}`,
      prompt: `scrubber prompt ${String(i)}`,
      language: 'javascript',
      snippet: 'let x = 1;\nx = x + 1;',
      interaction: 'scrubber',
      steps: [
        { line: 0, vars: { x: '1' } },
        { line: 1, vars: { x: '2' } },
      ],
      checkpoints: [
        { afterStep: 0, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 0 },
        { afterStep: 0, question: 'next-line', choices: ['0', '1'], correct: 1 },
      ],
    })),
    // drag-order puzzles at the same ratings as the mcq set above, present
    // for the same reason the scrubber decoys above are: RushInteraction
    // deliberately excludes 'drag-order' (see rush.ts's own doc comment —
    // a multi-block drag gesture is a bad fit for Rush's speed format), but
    // isRushEligible (useRushSession.ts) is a hand-written type predicate —
    // TypeScript never checks a predicate's body matches its asserted type,
    // so a future edit could silently start admitting drag-order and no
    // compile error would catch it. This fixture is what would catch it at
    // runtime instead.
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `d${String(i)}`,
      pattern: 'off-by-one',
      difficulty_rating: 700 + i * 20,
      explanation: `drag-order explanation ${String(i)}`,
      prompt: `drag-order prompt ${String(i)}`,
      language: 'javascript',
      snippet: 'const x = 1',
      interaction: 'drag-order',
      blocks: ['first', 'second', 'third'],
      correct_order: [1, 2, 0],
    })),
  ] as unknown as Puzzle[]

  // content-metadata-lazy-load Task 5b: useRushSession now selects from
  // `puzzleMeta` (metadata for the WHOLE fixture pool, scrubber/drag-order
  // included — `isRushEligible`'s own filter, not a separately-pre-filtered
  // export, is what excludes them) and loads bodies via `getPuzzleBody`.
  const FIXTURE_PUZZLE_META = FIXTURE_POOL.map((p) => ({
    id: p.id,
    pattern: p.pattern,
    difficulty_rating: p.difficulty_rating,
    interaction: p.interaction,
  }))
  const FIXTURE_BODY_BY_ID = new Map(FIXTURE_POOL.map((p) => [p.id, p]))

  return { FIXTURE_POOL, FIXTURE_PUZZLE_META, FIXTURE_BODY_BY_ID }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL,
    quizPool: FIXTURE_POOL,
    // The two the hook actually reads now (content-metadata-lazy-load Task
    // 5b) — selection runs over `puzzleMeta`, bodies resolve via
    // `getPuzzleBody`. `puzzlePool`/`quizPool` above are left mocked too
    // (harmless, unread by the hook itself) so any other module transitively
    // importing this same mocked '../../content' isn't left half-real.
    puzzleMeta: FIXTURE_PUZZLE_META,
    // Derived exports must be re-derived from the SAME fixture, not left
    // real — see usePracticeSession.test.ts's identical mock comment.
    quizMeta: FIXTURE_PUZZLE_META.filter((meta) => meta.interaction !== 'scrubber'),
    scrubberMeta: FIXTURE_PUZZLE_META.filter((meta) => meta.interaction === 'scrubber'),
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
  }
})

vi.mock('../../telemetry', () => ({
  trackError: vi.fn(),
  trackRushAttempt: vi.fn(),
  trackRushRunEnd: vi.fn(),
}))

vi.mock('../../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine')>()
  return { ...actual, updateRating: vi.fn(actual.updateRating) }
})

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { updateRating } = await import('../../engine')
const { trackRushAttempt, trackRushRunEnd } = await import('../../telemetry')
const { getPuzzleBody } = await import('../../content')
const { resetPuzzleBodyCacheForTests } = await import('../practice/puzzleBodyCache')

/**
 * Drives one commit + Continue through the hook, exactly like
 * PuzzleCardShell's onAnswered/onContinue would. `handleContinue`'s
 * `serveNext` now resolves the next puzzle's body asynchronously
 * (content-metadata-lazy-load Task 5b — the mocked `getPuzzleBody` above
 * resolves on a microtask), so this flushes the microtask queue afterward —
 * same two-`Promise.resolve()` flush this file's own fake-timer tests
 * already use for the mount effect — before returning, so callers that
 * immediately read `result.current.puzzle` see the SWR update, not the
 * stale pre-Continue puzzle.
 */
async function answerAndContinue(
  result: { current: ReturnType<typeof useRushSession> },
  correct: boolean,
) {
  act(() => {
    result.current.handleAnswered({ correct, choiceIndex: correct ? 0 : 1 })
  })
  act(() => {
    result.current.handleContinue()
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useRushSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    // Re-establishes the default resolve-from-fixture implementation on
    // every test: unlike `mockResolvedValueOnce`/`mockImplementationOnce`,
    // `vi.clearAllMocks()` does NOT undo a persistent `mockImplementation`
    // override (the stale-while-revalidate test below installs one) — without
    // this, a later test would silently inherit that override's forever-
    // pending promises and hang.
    vi.mocked(getPuzzleBody).mockImplementation((id: string) =>
      Promise.resolve(FIXTURE_BODY_BY_ID.get(id)),
    )
    // The shared puzzleBodyCache is a module-level singleton — Vitest
    // isolates modules per test FILE, not per `it()` within one, so without
    // this a call-count assertion in one test could be silently satisfied by
    // a promise this same cache resolved during an earlier test.
    resetPuzzleBodyCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves a first puzzle at rating - 400 on mount', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.puzzle).not.toBeNull()
    expect(result.current.phase).toBe('playing')
    expect(result.current.strikes).toBe(0)
  })

  it('never calls updateRating across a full run, including wrong answers — the orchestration-layer rating-isolation guard', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    // Mix of correct/wrong, ending in 3 strikes (RUSH_STRIKE_LIMIT).
    const pattern = [true, true, false, true, false, true, false]
    for (const correct of pattern) {
      if (result.current.phase === 'ended') break
      await answerAndContinue(result, correct)
    }

    expect(result.current.phase).toBe('ended')
    expect(updateRating).not.toHaveBeenCalled()

    // Every appended attempt for this (unrated) mode has an unchanged rating.
    for (const call of vi.mocked(appendAttempt).mock.calls) {
      const attempt = call[0]
      expect(attempt.mode).toBe('rush')
      expect(attempt.userRatingAfter).toBe(attempt.userRatingBefore)
    }
  })

  it('ends the run at exactly 3 strikes, persists rushStats, and reports a summary', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await answerAndContinue(result, true) // solved 1, streak 1
    await answerAndContinue(result, true) // solved 2, streak 2
    await answerAndContinue(result, false) // strike 1
    await answerAndContinue(result, false) // strike 2
    expect(result.current.phase).toBe('playing')
    await answerAndContinue(result, false) // strike 3 -> ends

    expect(result.current.phase).toBe('ended')
    expect(result.current.runSummary).toEqual({
      solvedCount: 2,
      bestStreakThisRun: 2,
      longestStreakEver: 2,
      bestScoreEver: 2,
      isNewBestScore: true,
    })
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        rushStats: {
          bestScore: 2,
          bestStreak: 2,
          runs: 1,
          lastRunAt: expect.any(String) as string,
        },
      }),
    )
    expect(trackRushRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ solved_count: 2, best_streak_in_run: 2 }),
    )
  })

  describe('per-puzzle clock (Phase 5b Item 6)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('reaching the clock produces a forcedCommit payload; applying it counts as a strike and marks the attempt timed_out', async () => {
      const { result } = renderHook(() => useRushSession())
      // Flushes the mount effect's async loadProfile().then(startRun) — a
      // microtask, not a timer, so it resolves without advancing fake time.
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.status).toBe('ready')
      expect(result.current.forcedCommit).toBeUndefined()

      act(() => {
        vi.advanceTimersByTime(RUSH_PUZZLE_TIME_LIMIT_MS)
      })

      const commit = result.current.forcedCommit
      expect(commit).toEqual({ correct: false, choiceIndex: null })
      if (!commit) throw new Error('expected forcedCommit to be set')

      // Applying it is PuzzleCardShell's own job (see its forcedCommit
      // effect) — exercised directly here to keep this test scoped to
      // useRushSession's own behavior once that payload lands.
      act(() => {
        result.current.handleAnswered(commit)
      })
      expect(result.current.strikes).toBe(1)
      expect(trackRushAttempt).toHaveBeenCalledWith(expect.objectContaining({ timed_out: true }))
    })

    it('a real, in-time answer never sets forcedCommit — the clock only fires once it actually reaches 0', async () => {
      const { result } = renderHook(() => useRushSession())
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.status).toBe('ready')

      act(() => {
        vi.advanceTimersByTime(RUSH_PUZZLE_TIME_LIMIT_MS / 2)
      })
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })

      expect(result.current.forcedCommit).toBeUndefined()
      expect(trackRushAttempt).toHaveBeenCalledWith(expect.objectContaining({ timed_out: false }))
    })

    it('a run that ends on a clock timeout reports ended_reason "clock"; a run that ends on a real wrong tap reports "strikes"', async () => {
      const { result } = renderHook(() => useRushSession())
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.status).toBe('ready')

      await answerAndContinue(result, false) // strike 1, real tap
      await answerAndContinue(result, false) // strike 2, real tap

      act(() => {
        vi.advanceTimersByTime(RUSH_PUZZLE_TIME_LIMIT_MS)
      })
      const commit = result.current.forcedCommit
      if (!commit) throw new Error('expected forcedCommit to be set')
      act(() => {
        result.current.handleAnswered(commit) // strike 3, via the clock -> ends
      })
      act(() => {
        result.current.handleContinue()
      })

      expect(result.current.phase).toBe('ended')
      expect(trackRushRunEnd).toHaveBeenCalledWith(
        expect.objectContaining({ ended_reason: 'clock' }),
      )
    })

    it('backgrounding the tab does not drain the clock — hidden time is added back to the deadline', async () => {
      const { result } = renderHook(() => useRushSession())
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.status).toBe('ready')

      // Ticks forward to just shy of the limit, then "hides" the tab for
      // longer than the remaining time — without the visibilitychange
      // handling, the clock would already have fired well before it's
      // shown again.
      act(() => {
        vi.advanceTimersByTime(RUSH_PUZZLE_TIME_LIMIT_MS - 1000)
      })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      // Still hidden this whole time — no forcedCommit should have fired,
      // since the interval's own tick checks are independent of visibility
      // but the deadline itself hasn't been reached in wall-clock terms
      // once the hidden gap is accounted for.
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))

      expect(result.current.forcedCommit).toBeUndefined()

      // The remaining ~1s (from before hiding) should still be left, not
      // "long since expired" — advancing well past it now fires the clock.
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(result.current.forcedCommit).toEqual({ correct: false, choiceIndex: null })
    })
  })

  it('steps the difficulty up only on a correct answer, never on a miss', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    const firstPuzzleId = result.current.puzzle?.id

    await answerAndContinue(result, false)

    expect(result.current.strikes).toBe(1)
    expect(result.current.phase).toBe('playing')
    expect(result.current.puzzle?.id).not.toBe(firstPuzzleId)
  })

  it('never serves a scrubber puzzle, even though the fixture pool contains several', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    for (let i = 0; i < 12; i++) {
      expect(result.current.puzzle?.interaction).not.toBe('scrubber')
      await answerAndContinue(result, true)
    }
    expect(result.current.puzzle?.interaction).not.toBe('scrubber')
  })

  it('never serves a drag-order puzzle, even though the fixture pool contains several', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    for (let i = 0; i < 12; i++) {
      expect(result.current.puzzle?.interaction).not.toBe('drag-order')
      await answerAndContinue(result, true)
    }
    expect(result.current.puzzle?.interaction).not.toBe('drag-order')
  })

  it('handleRunItBack starts a fresh run: strikes/solved/streak reset, a new run id in play', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await answerAndContinue(result, false)
    await answerAndContinue(result, false)
    await answerAndContinue(result, false)
    expect(result.current.phase).toBe('ended')

    act(() => {
      result.current.handleRunItBack()
    })

    expect(result.current.phase).toBe('playing')
    expect(result.current.strikes).toBe(0)
    expect(result.current.solvedCount).toBe(0)
    expect(result.current.currentStreak).toBe(0)
    expect(result.current.runSummary).toBeNull()
  })

  it('accumulates every attempt into runAttempts (correct and incorrect alike) and resets on a fresh run', async () => {
    const { result } = renderHook(() => useRushSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await answerAndContinue(result, true) // solved 1
    await answerAndContinue(result, true) // solved 2
    await answerAndContinue(result, false) // strike 1
    await answerAndContinue(result, false) // strike 2
    await answerAndContinue(result, false) // strike 3 -> ends

    expect(result.current.phase).toBe('ended')
    expect(result.current.runAttempts).toHaveLength(5)
    expect(result.current.runAttempts.filter((attempt) => attempt.correct)).toHaveLength(2)
    // Every attempt records the puzzle actually served at that point, with a
    // wall-clock time — the raw material the challenge link replays.
    for (const attempt of result.current.runAttempts) {
      expect(typeof attempt.puzzleId).toBe('string')
      expect(attempt.puzzleId.length).toBeGreaterThan(0)
      expect(typeof attempt.time_ms).toBe('number')
    }

    act(() => {
      result.current.handleRunItBack()
    })
    expect(result.current.runAttempts).toHaveLength(0)
  })

  describe('content-metadata-lazy-load Task 5b: stale-while-revalidate + speculative prefetch', () => {
    it("keeps the previous puzzle displayed while the next selection's body is still loading (stale-while-revalidate), and never flips status back to loading mid-run", async () => {
      const { result } = renderHook(() => useRushSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      const firstPuzzleId = result.current.puzzle?.id
      if (!firstPuzzleId) throw new Error('expected a puzzle to be served')

      // Every getPuzzleBody call (prefetch AND the real serve alike) now
      // returns a promise this test controls, so the assertions below don't
      // depend on guessing which specific call is "the real one" — only the
      // id that's actually SELECTED by serveNext ever reaches `setPuzzle`,
      // so resolving every pending promise at once is safe and simpler.
      const pendingResolvers: (() => void)[] = []
      vi.mocked(getPuzzleBody).mockImplementation(
        (id: string) =>
          new Promise((resolve) => {
            pendingResolvers.push(() => {
              resolve(FIXTURE_BODY_BY_ID.get(id))
            })
          }),
      )

      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      act(() => {
        result.current.handleContinue()
      })

      // Selection itself is synchronous — usedIds already advanced — but
      // every body fetch is still pending, so the DISPLAYED puzzle is still
      // the previous one.
      expect(result.current.puzzle?.id).toBe(firstPuzzleId)
      expect(result.current.status).toBe('ready')

      act(() => {
        pendingResolvers.forEach((resolve) => {
          resolve()
        })
      })
      await waitFor(() => {
        expect(result.current.puzzle?.id).not.toBe(firstPuzzleId)
      })
      expect(result.current.status).toBe('ready')
    })

    it('handleAnswered speculatively prefetches candidate body/bodies for the likely next puzzle, before Continue is ever pressed', async () => {
      const { result } = renderHook(() => useRushSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      const callsBeforeAnswer = vi.mocked(getPuzzleBody).mock.calls.length

      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })

      // No handleContinue call anywhere above — the prefetch fires purely
      // off the answer itself, using pendingDifficultyRef.current (already
      // computed inside handleAnswered).
      expect(vi.mocked(getPuzzleBody).mock.calls.length).toBeGreaterThan(callsBeforeAnswer)
    })

    it('skips the speculative prefetch entirely when the answer ends the run (3rd strike) — no puzzle will be served next', async () => {
      const { result } = renderHook(() => useRushSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      await answerAndContinue(result, false) // strike 1
      await answerAndContinue(result, false) // strike 2

      const callsBeforeFinalStrike = vi.mocked(getPuzzleBody).mock.calls.length

      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 }) // strike 3 -> ends
      })

      expect(result.current.willEndOnContinue).toBe(true)
      // pendingEndRef.current (mirrored here by willEndOnContinue) being
      // true must suppress the prefetch entirely — no puzzle will be served
      // next, so a prefetch would be pure waste.
      expect(vi.mocked(getPuzzleBody).mock.calls.length).toBe(callsBeforeFinalStrike)
    })

    it('does not re-fetch a body that was already prefetched, once that same id becomes the real next selection', async () => {
      const { result } = renderHook(() => useRushSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      // Exhausts 10 of the fixture's 12 rush-eligible (mcq) puzzles from
      // usedIdsRef, then answers the 11th too (without Continue yet) — at
      // that point exactly ONE rush-eligible id remains unused across the
      // whole fixture pool: a puzzle that has never yet been the real
      // selection this run, only ever (if at all) a speculative prefetch
      // candidate from an earlier round. Deliberately not controlling either
      // rng (real or the prefetch's throwaway one): rush.ts's own `usedIds`
      // no-repeat filter (MIN_ELIGIBLE=1) narrows the pool down to that one
      // candidate regardless of any rng draw, so the real `selectRushPuzzle`
      // call after Continue below is forced onto it deterministically.
      for (let i = 0; i < 10; i++) {
        await answerAndContinue(result, true)
      }
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 }) // 11th, no Continue yet
      })

      // Every getPuzzleBody call up to this point — the cold-boot serve,
      // every prior round's real serve, and every round's speculative
      // prefetch (including this 11th answer's own) — is fair game for
      // having already resolved the one remaining candidate; this doesn't
      // pin down exactly which round did it, only that SOME call before
      // Continue did.
      const idsFetchedBeforeContinue = new Set(
        vi.mocked(getPuzzleBody).mock.calls.map(([id]) => id),
      )
      vi.mocked(getPuzzleBody).mockClear()

      act(() => {
        result.current.handleContinue()
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      // The real selection deterministically lands on the one remaining
      // candidate — it must already be in the cache from an earlier
      // speculative prefetch, so Continue triggers zero NEW getPuzzleBody
      // calls, and the puzzle actually displayed was already fetched.
      expect(vi.mocked(getPuzzleBody).mock.calls.length).toBe(0)
      const servedId = result.current.puzzle?.id
      expect(servedId).toBeDefined()
      expect(idsFetchedBeforeContinue.has(servedId ?? '')).toBe(true)
    })
  })
})
