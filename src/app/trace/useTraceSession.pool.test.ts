import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Puzzle } from '../../content'
import { useTraceSession } from './useTraceSession'

/**
 * Pool-invariant test — mirrors src/content/index.test.ts's own idiom
 * (quizPool/scrubberPool partition tests): the assertion has to fail if
 * useTraceSession ever derives its serving pool from `puzzlePool` (or
 * `quizPool`) instead of importing the dedicated `scrubberPool` export
 * directly. Checking "the served puzzle's interaction === 'scrubber'"
 * alone would NOT catch that regression here, because the real
 * `scrubberPool` is itself just `puzzlePool.filter(interaction ===
 * 'scrubber')` — a `puzzlePool.filter(...)` call at the hook's own call
 * site would produce an identical-looking result against real content.
 *
 * So the fixture below deliberately makes `scrubberPool` DIVERGE from
 * `puzzlePool`'s scrubber-interaction subset: `leaked-scrubber` has
 * interaction 'scrubber' and sits in the mocked `puzzlePool`, but is
 * absent from the mocked `scrubberPool` export. If useTraceSession ever
 * re-derives its pool via `puzzlePool.filter(...)` instead of reading
 * `scrubberPool` directly, this leaked puzzle becomes servable and the
 * assertions below go red.
 */
const { FIXTURE_SCRUBBER_POOL, FIXTURE_PUZZLE_POOL, FIXTURE_QUIZ_POOL, LEAKED_SCRUBBER_ID } =
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

    // Present in `puzzlePool` with a scrubber interaction, deliberately
    // absent from the mocked `scrubberPool` export above — see this file's
    // module doc comment. Placed at index 0 of a naive
    // `puzzlePool.filter(interaction === 'scrubber')` derivation so a
    // regression is a hard deterministic catch (rng mocked to 0 below),
    // not a probabilistic one — same technique as usePracticeSession's own
    // P0 regression test.
    const leaked = makeScrubber('leaked-scrubber', 1000)

    const quizPool = Array.from({ length: 3 }, (_, i) => ({
      id: `quiz-${String(i)}`,
      pattern: 'off-by-one',
      difficulty_rating: 1000 + i * 100,
      explanation: `quiz explanation ${String(i)}`,
      prompt: `quiz prompt ${String(i)}`,
      language: 'javascript',
      snippet: 'const y = 1',
      interaction: 'mcq',
      choices: ['a', 'b'],
      correct_choice: 0,
    }))

    return {
      FIXTURE_SCRUBBER_POOL: scrubberPool,
      FIXTURE_PUZZLE_POOL: [leaked, ...quizPool, ...scrubberPool],
      FIXTURE_QUIZ_POOL: quizPool,
      LEAKED_SCRUBBER_ID: leaked.id,
    }
  }) as unknown as {
    FIXTURE_SCRUBBER_POOL: Puzzle[]
    FIXTURE_PUZZLE_POOL: Puzzle[]
    FIXTURE_QUIZ_POOL: Puzzle[]
    LEAKED_SCRUBBER_ID: string
  }

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_PUZZLE_POOL,
    quizPool: FIXTURE_QUIZ_POOL,
    scrubberPool: FIXTURE_SCRUBBER_POOL,
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

const scrubberIds = new Set(FIXTURE_SCRUBBER_POOL.map((p) => p.id))
const quizIds = new Set(FIXTURE_QUIZ_POOL.map((p) => p.id))

describe('useTraceSession — pool invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  it('serves only from the dedicated scrubberPool export, never puzzlePool/quizPool, even when a scrubber-interaction puzzle leaks through puzzlePool only', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    expect(result.current.puzzle).not.toBeNull()
    expect(result.current.puzzle?.id).not.toBe(LEAKED_SCRUBBER_ID)
    expect(result.current.puzzle?.id).toBe('trace-0')
    expect(scrubberIds.has(result.current.puzzle?.id ?? '')).toBe(true)
    expect(quizIds.has(result.current.puzzle?.id ?? '')).toBe(false)

    randomSpy.mockRestore()
  })

  it('never serves a quizPool puzzle across several completed puzzles', async () => {
    const { result } = renderHook(() => useTraceSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    for (let i = 0; i < 8; i++) {
      const puzzle = result.current.puzzle
      if (!puzzle) throw new Error('expected a puzzle to be served')
      expect(scrubberIds.has(puzzle.id)).toBe(true)
      expect(puzzle.id).not.toBe(LEAKED_SCRUBBER_ID)

      act(() => {
        puzzle.checkpoints.forEach(() => {
          result.current.handleCheckpointAnswered({ correct: true, choiceIndex: 0 })
        })
      })
      act(() => {
        result.current.handleContinue()
      })
    }
  })
})
