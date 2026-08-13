import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Puzzle } from '../../content'
import { useBossSession } from './useBossSession'

const { FIXTURE_POOL, FIXTURE_SETS } = vi.hoisted(() => {
  // 3 fixture sets (b/c/d), 10 ids each, so rotation coverage below can
  // assert on real distinct sets rather than the same one 3 times over.
  // Set 0 (b-prefixed) is what every pre-existing, non-rotation-specific
  // test in this file was written against — a fresh profile (runsCompleted
  // 0) always resolves it, so those tests are unaffected by this expansion.
  const prefixes = ['b', 'c', 'd']
  const sets = prefixes.map((prefix) =>
    Array.from({ length: 10 }, (_, i) => `${prefix}${String(i)}`),
  )
  const pool = sets.flat().map((id, i) => ({
    id,
    pattern: 'off-by-one',
    difficulty_rating: 900 + i * 50,
    explanation: `explanation ${id}`,
    prompt: `prompt ${id}`,
    language: 'javascript',
    snippet: 'const x = 1',
    interaction: 'mcq',
    choices: ['a', 'b'],
    correct_choice: 0,
  })) as unknown as Puzzle[]
  return { FIXTURE_POOL: pool, FIXTURE_SETS: sets }
})

// resolveActiveBossSet must be mocked too, not just BOSS_SETS: its default
// `sets` parameter closes over the real bossRun.ts module-scope BOSS_SETS
// (the real puzzle ids), independent of what this mock re-exports as
// content's BOSS_SETS — mocking only the constant would leave useBossSession
// resolving real ids that don't exist in FIXTURE_POOL. This stub replicates
// the real resolver's modulo logic against FIXTURE_SETS (not the real
// content), so a fresh profile (runsCompleted 0) still resolves BOSS_RUN_IDS
// — preserving every pre-existing test's assumptions — while rotation-
// specific tests below can drive runsCompleted to reach sets 1/2.
vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL,
    quizPool: FIXTURE_POOL,
    BOSS_SETS: FIXTURE_SETS,
    resolveActiveBossSet: (runsCompleted: number) =>
      FIXTURE_SETS[runsCompleted % FIXTURE_SETS.length],
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
  trackBossAttempt: vi.fn(),
  trackBossRunEnd: vi.fn(),
}))

vi.mock('../../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine')>()
  return { ...actual, updateRating: vi.fn(actual.updateRating) }
})

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { updateRating } = await import('../../engine')
const { trackBossAttempt, trackBossRunEnd } = await import('../../telemetry')

function answerAndContinue(
  result: { current: ReturnType<typeof useBossSession> },
  correct: boolean,
) {
  act(() => {
    result.current.handleAnswered({ correct, choiceIndex: correct ? 0 : 1 })
  })
  act(() => {
    result.current.handleContinue()
  })
}

describe('useBossSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves BOSS_RUN[0] first, at position 1', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.puzzle?.id).toBe('b0')
    expect(result.current.position).toBe(1)
    expect(result.current.strikes).toBe(0)
  })

  it('serves BOSS_RUN in fixed order on correct answers', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe('b1')
    })
    expect(result.current.position).toBe(2)

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe('b2')
    })
    expect(result.current.position).toBe(3)
  })

  it('increments strikes on a wrong answer but keeps serving the next puzzle', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.strikes).toBe(1)
    })
    expect(result.current.phase).toBe('playing')
    expect(result.current.puzzle?.id).toBe('b1')
  })

  it('click-meaningfulness: sets lastAnswerCorrect + bumps answerNonce on a correct answer, resets on the next puzzle', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.lastAnswerCorrect).toBeNull()
    const nonceBefore = result.current.answerNonce

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    expect(result.current.lastAnswerCorrect).toBe(true)
    expect(result.current.answerNonce).toBe(nonceBefore + 1)

    act(() => {
      result.current.handleContinue()
    })
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe('b1')
    })
    expect(result.current.lastAnswerCorrect).toBeNull()
  })

  it('click-meaningfulness: sets lastAnswerCorrect to false on a wrong answer', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    act(() => {
      result.current.handleAnswered({ correct: false, choiceIndex: 1 })
    })
    expect(result.current.lastAnswerCorrect).toBe(false)
  })

  it('ends the run on the 3rd strike, reporting depthReached and cleared: false', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.position).toBe(3)
    })
    answerAndContinue(result, false)

    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })
    expect(result.current.runSummary).toEqual(
      expect.objectContaining({
        depthReached: 3,
        cleared: false,
        bestDepthEver: 3,
        isNewBestDepth: true,
        previousBestSplits: null,
      }),
    )
    expect(result.current.runSummary?.splits).toHaveLength(3)
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        depth_reached: 3,
        cleared: false,
        ended_reason: 'strikes',
        is_new_best_depth: true,
      }),
    )
  })

  it('ends the run after the 10th puzzle with cleared: true when the run was never struck out', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    for (let i = 0; i < 9; i++) {
      answerAndContinue(result, true)
      await waitFor(() => {
        expect(result.current.position).toBe(i + 2)
      })
    }
    answerAndContinue(result, true)

    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })
    expect(result.current.runSummary).toEqual(
      expect.objectContaining({
        depthReached: 10,
        cleared: true,
        bestDepthEver: 10,
        isNewBestDepth: true,
        previousBestSplits: null,
      }),
    )
    expect(result.current.runSummary?.splits).toHaveLength(10)
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ cleared: true, ended_reason: 'completed' }),
    )
  })

  // Plan-flagged edge case: reaching the 10th puzzle and losing the 3rd
  // strike there is a loss, not a clear — depth alone (10) can't tell this
  // apart from a clean finish; only `cleared`/`ended_reason` can.
  it('reports cleared: false when the 3rd strike lands exactly on the 10th puzzle', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, false) // strike 1, puzzle 1 -> 2
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    for (let i = 0; i < 7; i++) {
      answerAndContinue(result, true) // puzzles 2-8, correct
      await waitFor(() => {
        expect(result.current.position).toBe(i + 3)
      })
    }
    answerAndContinue(result, false) // strike 2, puzzle 9 -> 10
    await waitFor(() => {
      expect(result.current.position).toBe(10)
    })
    answerAndContinue(result, false) // strike 3, on puzzle 10 itself — the run ends here

    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })
    expect(result.current.runSummary).toEqual(
      expect.objectContaining({
        depthReached: 10,
        cleared: false,
        bestDepthEver: 10,
        isNewBestDepth: true,
        previousBestSplits: null,
      }),
    )
    expect(result.current.runSummary?.splits).toHaveLength(10)
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ depth_reached: 10, cleared: false, ended_reason: 'strikes' }),
    )
  })

  // A wrong answer on the 10th puzzle that is NOT the 3rd strike still
  // counts as clearing the run — the player was never eliminated.
  it('reports cleared: true when the 10th puzzle is answered wrong but it is not the 3rd strike', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, false) // strike 1, puzzle 1 -> 2
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    for (let i = 0; i < 8; i++) {
      answerAndContinue(result, true) // puzzles 2-9, correct
      await waitFor(() => {
        expect(result.current.position).toBe(i + 3)
      })
    }
    answerAndContinue(result, false) // strike 2, on puzzle 10 — not the 3rd strike

    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })
    expect(result.current.runSummary).toEqual(
      expect.objectContaining({
        depthReached: 10,
        cleared: true,
        bestDepthEver: 10,
        isNewBestDepth: true,
        previousBestSplits: null,
      }),
    )
    expect(result.current.runSummary?.splits).toHaveLength(10)
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ depth_reached: 10, cleared: true, ended_reason: 'completed' }),
    )
  })

  it('accumulates onto prior bossStats and reports isNewBestDepth: false when the run does not beat the stored best', async () => {
    vi.mocked(loadProfile).mockResolvedValue({
      ...createDefaultProfile(),
      bossStats: {
        bestDepth: 8,
        clears: 2,
        runs: 5,
        lastRunAt: '2026-08-01T00:00:00.000Z',
        bestRunSplits: [1000, 2200, 3400, 4800, 6100, 7300, 8500, 9900],
      },
    })

    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    // 3 strikes at depth 3 — well short of the stored bestDepth of 8.
    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.position).toBe(3)
    })
    answerAndContinue(result, false)

    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })
    expect(result.current.runSummary).toEqual(
      expect.objectContaining({
        depthReached: 3,
        cleared: false,
        bestDepthEver: 8,
        isNewBestDepth: false,
        // An ordinary (non-record) run — the prior best's splits pass
        // through, since this run didn't beat bestDepth.
        previousBestSplits: [1000, 2200, 3400, 4800, 6100, 7300, 8500, 9900],
      }),
    )
    expect(result.current.runSummary?.splits).toHaveLength(3)
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        bossStats: {
          bestDepth: 8,
          clears: 2,
          runs: 6,
          lastRunAt: expect.any(String) as string,
          bestRunSplits: [1000, 2200, 3400, 4800, 6100, 7300, 8500, 9900],
        },
      }),
    )
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ is_new_best_depth: false }),
    )
  })

  it('never rates — updateRating is never called across a full run including wrong answers', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.strikes).toBe(1)
    })

    expect(updateRating).not.toHaveBeenCalled()
  })

  it('records every attempt with mode "boss" and the correct run-level telemetry context', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })

    expect(appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'boss', puzzleId: 'b0' }),
    )
    expect(trackBossAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'boss', puzzle_id: 'b0', position_in_run: 1 }),
    )
  })

  it('"Run it back" starts a fresh run from position 1 with strikes reset', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    for (let i = 0; i < 3; i++) {
      answerAndContinue(result, false)
      await waitFor(() => {
        expect(result.current.strikes).toBe(i + 1)
      })
    }
    await waitFor(() => {
      expect(result.current.phase).toBe('ended')
    })

    act(() => {
      result.current.handleRunItBack()
    })

    await waitFor(() => {
      expect(result.current.phase).toBe('playing')
    })
    // 'c0': BOSS_SETS rotation means "Run it back" resolves the NEXT set
    // (bossStats.runs was incremented by the run that just ended) — see the
    // dedicated "BOSS_SETS rotation" describe block above for that behavior
    // in isolation. This test's own point is the reset below.
    expect(result.current.puzzle?.id).toBe('c0')
    expect(result.current.position).toBe(1)
    expect(result.current.strikes).toBe(0)
  })

  describe('BOSS_SETS rotation — resolved once at run start, not per puzzle', () => {
    it('a fresh profile (bossStats null, runsCompleted 0) resolves FIXTURE_SETS[0]', async () => {
      const { result } = renderHook(() => useBossSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      expect(result.current.puzzle?.id).toBe('b0')
    })

    it('a profile with bossStats.runs = 1 resolves FIXTURE_SETS[1], not the default set', async () => {
      vi.mocked(loadProfile).mockResolvedValue({
        ...createDefaultProfile(),
        bossStats: {
          bestDepth: 5,
          clears: 0,
          runs: 1,
          lastRunAt: '2026-08-01T00:00:00.000Z',
          bestRunSplits: null,
        },
      })
      const { result } = renderHook(() => useBossSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      expect(result.current.puzzle?.id).toBe('c0')
    })

    it('bossStats.runs = 3 wraps back to FIXTURE_SETS[0] (3 sets, 3 % 3 = 0)', async () => {
      vi.mocked(loadProfile).mockResolvedValue({
        ...createDefaultProfile(),
        bossStats: {
          bestDepth: 5,
          clears: 0,
          runs: 3,
          lastRunAt: '2026-08-01T00:00:00.000Z',
          bestRunSplits: null,
        },
      })
      const { result } = renderHook(() => useBossSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      expect(result.current.puzzle?.id).toBe('b0')
    })

    it('stays on the run-start-resolved set for the rest of the run, even as position advances', async () => {
      vi.mocked(loadProfile).mockResolvedValue({
        ...createDefaultProfile(),
        bossStats: {
          bestDepth: 5,
          clears: 0,
          runs: 2,
          lastRunAt: '2026-08-01T00:00:00.000Z',
          bestRunSplits: null,
        },
      })
      const { result } = renderHook(() => useBossSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      expect(result.current.puzzle?.id).toBe('d0')

      answerAndContinue(result, true)
      await waitFor(() => {
        expect(result.current.position).toBe(2)
      })
      expect(result.current.puzzle?.id).toBe('d1')
    })

    it('"Run it back" resolves the NEXT set — bossStats.runs was incremented by the run that just ended', async () => {
      const { result } = renderHook(() => useBossSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
      expect(result.current.puzzle?.id).toBe('b0')

      for (let i = 0; i < 3; i++) {
        answerAndContinue(result, false)
        await waitFor(() => {
          expect(result.current.strikes).toBe(i + 1)
        })
      }
      await waitFor(() => {
        expect(result.current.phase).toBe('ended')
      })

      act(() => {
        result.current.handleRunItBack()
      })

      await waitFor(() => {
        expect(result.current.phase).toBe('playing')
      })
      expect(result.current.puzzle?.id).toBe('c0')
    })

    it('reports the resolved set_index on telemetry', async () => {
      vi.mocked(loadProfile).mockResolvedValue({
        ...createDefaultProfile(),
        bossStats: {
          bestDepth: 5,
          clears: 0,
          runs: 1,
          lastRunAt: '2026-08-01T00:00:00.000Z',
          bestRunSplits: null,
        },
      })
      const { result } = renderHook(() => useBossSession())
      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })

      answerAndContinue(result, true)
      await waitFor(() => {
        expect(result.current.position).toBe(2)
      })

      expect(trackBossAttempt).toHaveBeenCalledWith(expect.objectContaining({ set_index: 1 }))
    })
  })

  describe('ghost pace — bestRunSplits capture', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function flushMountEffect() {
      // Flushes the mount effect's async loadProfile().then(startRun) — a
      // microtask, not a timer — same pattern as useRushSession.test.ts's
      // own fake-timer describe block.
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    it("captures this run's own elapsed-ms-per-position splits, exactly", async () => {
      const { result } = renderHook(() => useBossSession())
      await flushMountEffect()
      expect(result.current.status).toBe('ready')

      act(() => {
        vi.advanceTimersByTime(500)
      })
      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 })
      })
      act(() => {
        result.current.handleContinue()
      })

      act(() => {
        vi.advanceTimersByTime(700)
      })
      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 })
      })
      act(() => {
        result.current.handleContinue()
      })

      act(() => {
        vi.advanceTimersByTime(300)
      })
      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 })
      })
      act(() => {
        result.current.handleContinue()
      })

      expect(result.current.phase).toBe('ended')
      expect(result.current.runSummary?.splits).toEqual([500, 1200, 1500])
    })

    it('an ordinary (non-record) run leaves stored bestRunSplits untouched, and its summary compares against the prior record', async () => {
      const priorSplits = [1000, 2000, 3000, 4000, 5000]
      vi.mocked(loadProfile).mockResolvedValue({
        ...createDefaultProfile(),
        bossStats: {
          bestDepth: 5,
          clears: 1,
          runs: 2,
          lastRunAt: '2026-08-01T00:00:00.000Z',
          bestRunSplits: priorSplits,
        },
      })
      const { result } = renderHook(() => useBossSession())
      await flushMountEffect()
      expect(result.current.status).toBe('ready')

      // Strikes out at depth 3 — well short of the stored bestDepth of 5.
      for (let i = 0; i < 3; i++) {
        act(() => {
          vi.advanceTimersByTime(400)
        })
        act(() => {
          result.current.handleAnswered({ correct: false, choiceIndex: 1 })
        })
        act(() => {
          result.current.handleContinue()
        })
      }

      expect(result.current.runSummary?.isNewBestDepth).toBe(false)
      expect(result.current.runSummary?.previousBestSplits).toEqual(priorSplits)
      const savedProfile = vi.mocked(saveProfile).mock.calls[0]?.[0]
      expect(savedProfile?.bossStats?.bestRunSplits).toEqual(priorSplits)
    })

    it('a run that sets a new bestDepth overwrites stored bestRunSplits with its OWN splits, while its own summary still compares against the PRIOR record', async () => {
      const priorSplits = [900, 1800]
      vi.mocked(loadProfile).mockResolvedValue({
        ...createDefaultProfile(),
        bossStats: {
          bestDepth: 2,
          clears: 0,
          runs: 1,
          lastRunAt: '2026-08-01T00:00:00.000Z',
          bestRunSplits: priorSplits,
        },
      })
      const { result } = renderHook(() => useBossSession())
      await flushMountEffect()
      expect(result.current.status).toBe('ready')

      // 3 strikes at depth 3 — beats the stored bestDepth of 2.
      for (let i = 0; i < 3; i++) {
        act(() => {
          vi.advanceTimersByTime(600)
        })
        act(() => {
          result.current.handleAnswered({ correct: false, choiceIndex: 1 })
        })
        act(() => {
          result.current.handleContinue()
        })
      }

      expect(result.current.runSummary?.isNewBestDepth).toBe(true)
      expect(result.current.runSummary?.depthReached).toBe(3)
      // The summary still races against the PRIOR record, not itself.
      expect(result.current.runSummary?.previousBestSplits).toEqual(priorSplits)
      const thisRunSplits = result.current.runSummary?.splits
      expect(thisRunSplits).toEqual([600, 1200, 1800])
      const savedProfile = vi.mocked(saveProfile).mock.calls[0]?.[0]
      expect(savedProfile?.bossStats?.bestRunSplits).toEqual(thisRunSplits)
    })

    it('a fresh profile with no prior bossStats reports previousBestSplits: null', async () => {
      const { result } = renderHook(() => useBossSession())
      await flushMountEffect()

      for (let i = 0; i < 3; i++) {
        act(() => {
          vi.advanceTimersByTime(500)
        })
        act(() => {
          result.current.handleAnswered({ correct: false, choiceIndex: 1 })
        })
        act(() => {
          result.current.handleContinue()
        })
      }

      expect(result.current.runSummary?.isNewBestDepth).toBe(true)
      expect(result.current.runSummary?.previousBestSplits).toBeNull()
    })

    it('"Run it back" resets split tracking — the next run\'s first split reflects only its own elapsed time', async () => {
      const { result } = renderHook(() => useBossSession())
      await flushMountEffect()

      // Run 1: strike out after a long elapsed time.
      for (let i = 0; i < 3; i++) {
        act(() => {
          vi.advanceTimersByTime(5000)
        })
        act(() => {
          result.current.handleAnswered({ correct: false, choiceIndex: 1 })
        })
        act(() => {
          result.current.handleContinue()
        })
      }
      expect(result.current.phase).toBe('ended')

      // A real-world gap before the player clicks "Run it back".
      act(() => {
        vi.advanceTimersByTime(20000)
      })
      act(() => {
        result.current.handleRunItBack()
      })

      // A short elapsed time on run 2's first puzzle — if runStartAtRef
      // weren't reset by startRun, this split would instead reflect
      // ~25000ms+ accumulated since run 1's original start, not ~300ms.
      act(() => {
        vi.advanceTimersByTime(300)
      })
      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 })
      })
      act(() => {
        result.current.handleContinue()
      })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 })
      })
      act(() => {
        result.current.handleContinue()
      })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      act(() => {
        result.current.handleAnswered({ correct: false, choiceIndex: 1 })
      })
      act(() => {
        result.current.handleContinue()
      })

      expect(result.current.runSummary?.splits).toEqual([300, 600, 900])
    })
  })
})
