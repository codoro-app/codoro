import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TraceRunner } from './TraceRunner'
import type { Puzzle } from '../../content'

/**
 * Whole-branch review finding (see task-6 review): `TraceRunner.test.tsx`
 * mocks `useTraceSession` entirely, and `useTraceSession.test.ts` never
 * renders UI — so the seam between them (Task 1's hook and Task 3's
 * checkpoint UI) was only ever verified as two disjoint halves. In
 * particular, `TraceRunnerPuzzle`'s `checkpointIndexAtStep < answeredCount`
 * logic treats `checkpointResults` as positionally aligned with
 * `puzzle.checkpoints`, while the hook actually appends results in *call*
 * order — those only coincide because checkpoint-gating makes out-of-order
 * answering unreachable through the real UI. This test drives that real UI
 * against the real hook end to end: only what sits below the hook (content
 * pool, storage, telemetry) is mocked.
 *
 * Selection is made deterministic the same way useTraceSession.pool.test.ts
 * does it: `Math.random` mocked to always return 0 (selectNext never calls
 * `Math.random` internally — see selection.ts — so this only affects the
 * caller-supplied `rng`/`shuffledIndices`, not engine logic itself), plus a
 * two-puzzle pool at equal ratings so both are always in the eligible
 * window. With `traceRecentIdsWindow(2) === 1`, the puzzle just answered is
 * always excluded from the very next pick, so puzzle B is guaranteed to
 * follow puzzle A's Continue deterministically.
 */

const { FIXTURE_SCRUBBER_POOL, FIXTURE_PUZZLE_META, FIXTURE_BODY_BY_ID } = vi.hoisted(() => {
  const makePuzzle = (id: string, prompt: string): unknown => ({
    id,
    pattern: 'off-by-one',
    difficulty_rating: 1200,
    explanation: `explanation for ${id}`,
    prompt,
    language: 'javascript',
    snippet: 'let x = 0\nx = x + 1\nconsole.log(x)',
    interaction: 'scrubber',
    steps: [
      { line: 0, vars: { x: '0' } },
      { line: 1, vars: { x: '1' }, output: 'one' },
    ],
    checkpoints: [
      { afterStep: 0, question: 'var-value', target: 'x', choices: ['0', '1'], correct: 0 },
      { afterStep: 1, question: 'output', choices: ['one', 'two'], correct: 0 },
    ],
  })

  const pool = [
    makePuzzle('trace-a', 'Trace puzzle A'),
    makePuzzle('trace-b', 'Trace puzzle B'),
  ] as Puzzle[]

  return {
    FIXTURE_SCRUBBER_POOL: pool,
    // content-metadata-lazy-load Task 5: useTraceSession now selects from
    // `puzzleMeta` and loads bodies via `getPuzzleBody`, not `scrubberPool`
    // directly.
    FIXTURE_PUZZLE_META: pool.map((p) => ({
      id: p.id,
      pattern: p.pattern,
      difficulty_rating: p.difficulty_rating,
      interaction: p.interaction,
    })),
    FIXTURE_BODY_BY_ID: new Map(pool.map((p) => [p.id, p])),
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    puzzlePool: FIXTURE_SCRUBBER_POOL,
    scrubberPool: FIXTURE_SCRUBBER_POOL,
    puzzleMeta: FIXTURE_PUZZLE_META,
    // Derived exports must be re-derived from the SAME fixture, not left
    // real — see usePracticeSession.test.ts's identical mock comment.
    // Filtered with the real predicate, deliberately: this fixture
    // includes a non-scrubber entry, and the point of these tests is that
    // the hook selects from `scrubberMeta` rather than raw `puzzleMeta`.
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

vi.mock('../../telemetry', () => ({ trackTraceAttempt: vi.fn(), trackError: vi.fn() }))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { resetPuzzleBodyCacheForTests } = await import('../practice/puzzleBodyCache')

describe('TraceRunner + useTraceSession integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    resetPuzzleBodyCacheForTests()
  })

  it('answers every checkpoint in order, shows the solve panel, and Continue serves a fresh puzzle at step 0', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    render(<TraceRunner />)

    await waitFor(() => {
      expect(screen.getByText('Trace puzzle A')).toBeInTheDocument()
    })

    // Checkpoint 0 (var-value, afterStep 0) is pending immediately at
    // stepIndex 0 — no scrub needed to reach it.
    expect(screen.getByText('What is its value?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '0' }))

    // Not complete yet — one checkpoint remains, so no solve panel and no
    // persistence call yet.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(appendAttempt).not.toHaveBeenCalled()

    // Scrubbing forward is now capped at checkpoint 1's afterStep (1).
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled()

    // Checkpoint 1 (output, afterStep 1).
    expect(screen.getByText('What did this line print?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'one' }))

    // Both checkpoints answered -> the solve/explanation panel appears with
    // the fully-correct verdict, and the attempt was scored/persisted.
    const solvePanel = await screen.findByRole('status')
    expect(solvePanel).toHaveTextContent('Nice — fully traced')
    expect(screen.getByText('explanation for trace-a')).toBeInTheDocument()
    await waitFor(() => {
      expect(appendAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ puzzleId: 'trace-a', correct: true }),
      )
    })

    // Continue serves the next puzzle — deterministically puzzle B, since
    // puzzle A is now the sole entry in the (window-1) recent-ids exclusion.
    fireEvent.click(screen.getByRole('button', { name: 'Next puzzle' }))

    await waitFor(() => {
      expect(screen.getByText('Trace puzzle B')).toBeInTheDocument()
    })

    // Fresh puzzle at step 0: back to checkpoint 0's question, no solve
    // panel, and the first code line is the one highlighted.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('What is its value?')).toBeInTheDocument()
    const highlighted = document.querySelectorAll('.scrubber__code-line--current')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]?.textContent).toContain('let x = 0')

    randomSpy.mockRestore()
  })
})
