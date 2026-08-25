import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Puzzle } from '../../content'
import { useTraceSession } from './useTraceSession'

/**
 * Pool-invariant test — content-metadata-lazy-load Task 5 update: the hook
 * no longer reads a dedicated `scrubberPool` export at all; it selects
 * directly from `puzzleMeta`, filtered inline to `interaction === 'scrubber'`
 * (see useTraceSession.ts's own `poolForFilters`). The regression this file
 * guards against shifts accordingly: the fixture `puzzleMeta` below is a MIX
 * of interactions (one non-scrubber `mcq` entry plus five real scrubber
 * entries), with the non-scrubber entry placed at index 0. With `Math.random`
 * mocked to 0 (selection.ts's `sample()` picks index 0 of the eligible
 * candidate list), if useTraceSession's own `interaction === 'scrubber'`
 * filter were ever dropped, the very first serve would deterministically be
 * the non-scrubber entry — a hard, non-probabilistic catch, same technique
 * as usePracticeSession's own P0 regression test.
 */
const { FIXTURE_SCRUBBER_POOL, FIXTURE_PUZZLE_META, FIXTURE_BODY_BY_ID, LEAKED_NON_SCRUBBER_ID } =
  vi.hoisted(() => {
    const makeScrubber = (id: string, rating: number) => ({
      id,
      pattern: 'off-by-one',
      difficulty_rating: rating,
      explanation: `explanation ${id}`,
      prompt: `prompt ${id}`,
      language: 'javascript',
      snippet: 'let x = 0;\nx = x + 1;',
      interaction: 'scrubber',
      steps: [
        { line: 0, vars: { x: '0' } },
        { line: 1, vars: { x: '1' } },
      ],
      checkpoints: [
        { afterStep: 0, question: 'var-value', target: 'x', choices: ['0', '1'], correct: 0 },
        { afterStep: 0, question: 'next-line', choices: ['0', '1'], correct: 1 },
      ],
    })

    const scrubberPool = Array.from({ length: 5 }, (_, i) =>
      makeScrubber(`trace-${String(i)}`, 1000 + i * 100),
    )

    // Placed at index 0 of the `puzzleMeta` fixture (below) — see this
    // file's own module doc comment for why.
    const leakedMeta = {
      id: 'leaked-non-scrubber',
      pattern: 'off-by-one',
      difficulty_rating: 1000,
      interaction: 'mcq',
    }

    return {
      FIXTURE_SCRUBBER_POOL: scrubberPool,
      FIXTURE_PUZZLE_META: [
        leakedMeta,
        ...scrubberPool.map((p) => ({
          id: p.id,
          pattern: p.pattern,
          difficulty_rating: p.difficulty_rating,
          interaction: p.interaction,
        })),
      ],
      FIXTURE_BODY_BY_ID: new Map(scrubberPool.map((p) => [p.id, p])),
      LEAKED_NON_SCRUBBER_ID: leakedMeta.id,
    }
  }) as unknown as {
    FIXTURE_SCRUBBER_POOL: Puzzle[]
    FIXTURE_PUZZLE_META: {
      id: string
      pattern: string
      difficulty_rating: number
      interaction: string
    }[]
    FIXTURE_BODY_BY_ID: Map<string, Puzzle>
    LEAKED_NON_SCRUBBER_ID: string
  }

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    scrubberPool: FIXTURE_SCRUBBER_POOL,
    puzzleMeta: FIXTURE_PUZZLE_META,
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
  trackTraceAttempt: vi.fn(),
  trackStreakPause: vi.fn(),
  trackError: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { resetPuzzleBodyCacheForTests } = await import('../practice/puzzleBodyCache')

const scrubberIds = new Set(FIXTURE_SCRUBBER_POOL.map((p) => p.id))

describe('useTraceSession — pool invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    resetPuzzleBodyCacheForTests()
  })

  it('serves only scrubber-interaction puzzleMeta entries, never a leaked non-scrubber one', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    expect(result.current.puzzle).not.toBeNull()
    expect(result.current.puzzle?.id).not.toBe(LEAKED_NON_SCRUBBER_ID)
    expect(result.current.puzzle?.id).toBe('trace-0')
    expect(scrubberIds.has(result.current.puzzle?.id ?? '')).toBe(true)

    randomSpy.mockRestore()
  })

  it('never serves the leaked non-scrubber puzzleMeta entry across several completed puzzles', async () => {
    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    for (let i = 0; i < 8; i++) {
      const puzzle = result.current.puzzle
      if (!puzzle) throw new Error('expected a puzzle to be served')
      expect(scrubberIds.has(puzzle.id)).toBe(true)
      expect(puzzle.id).not.toBe(LEAKED_NON_SCRUBBER_ID)

      act(() => {
        puzzle.checkpoints.forEach(() => {
          result.current.handleCheckpointAnswered({ correct: true, choiceIndex: 0 })
        })
      })
      act(() => {
        result.current.handleContinue()
      })
      // Body resolution for the next puzzle is asynchronous
      // (content-metadata-lazy-load Task 5) — flushed here so each loop
      // iteration actually reads a freshly-resolved puzzle, not the same
      // stale one 8 times over. Same two-microtask-flush idiom
      // useRushSession.test.ts/useBossSession.test.ts already use.
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    }
  })
})
