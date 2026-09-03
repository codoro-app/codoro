/**
 * Mirrors useBossSession.test.ts's fixed-order-serving style (position 1 ->
 * 2 -> 3 -> ended) and useDailySession.scrubber.test.ts's checkpoint-commit
 * style for puzzle 3 (scrubber) — see useFirstRunSession.ts's own doc
 * comment for why this hook is a deliberate merge of both shapes.
 *
 * FIXTURE_SET mirrors FIRST_RUN_SET's real shape: 3 ids, escalating
 * interaction complexity (tap-line -> drag-order -> scrubber), not the real
 * content ids — same "fixture pool, not real content" convention every
 * other session-hook test in this repo uses (see useBossSession.test.ts's
 * own doc comment on FIXTURE_POOL).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { roundForDisplay, updateRating } from '../../engine'
import type { Puzzle } from '../../content'
import { useFirstRunSession } from './useFirstRunSession'

const { FIXTURE_SET, FIXTURE_BODY_BY_ID, TAP_LINE_PUZZLE, DRAG_ORDER_PUZZLE, SCRUBBER_PUZZLE } =
  vi.hoisted(() => {
    const tapLine = {
      id: 'fr-1',
      pattern: 'control-flow',
      difficulty_rating: 1300,
      explanation: 'break only exits the inner loop.',
      prompt: 'Tap the line that only exits the inner loop.',
      language: 'javascript',
      snippet: 'for (;;) {\n  for (;;) {\n    break\n  }\n}',
      interaction: 'tap-line',
      correct_line: 2,
    } as unknown as Puzzle
    const dragOrder = {
      id: 'fr-2',
      pattern: 'off-by-one',
      difficulty_rating: 1150,
      explanation: 'Reorder the 4 blocks.',
      prompt: 'Put these 4 blocks back in order.',
      language: 'javascript',
      snippet: 'a\nb\nc\nd',
      interaction: 'drag-order',
      blocks: ['a', 'b', 'c', 'd'],
      correct_order: [0, 1, 2, 3],
    } as unknown as Puzzle
    const scrubber = {
      id: 'fr-3',
      pattern: 'data-structure-misuse',
      difficulty_rating: 1125,
      explanation: '.pop() removes from the wrong end of a queue.',
      prompt: 'Trace the value of x.',
      language: 'javascript',
      snippet: 'let x = [1, 2];\nx.pop();',
      interaction: 'scrubber',
      steps: [
        { line: 0, vars: { x: '[1, 2]' } },
        { line: 1, vars: { x: '[1]' } },
      ],
      checkpoints: [
        { afterStep: 0, question: 'var-value', target: 'x', choices: ['[1, 2]', '[]'], correct: 0 },
        { afterStep: 1, question: 'var-value', target: 'x', choices: ['[1]', '[2]'], correct: 0 },
      ],
    } as unknown as Puzzle

    return {
      FIXTURE_SET: [tapLine.id, dragOrder.id, scrubber.id] as readonly string[],
      FIXTURE_BODY_BY_ID: new Map([
        [tapLine.id, tapLine],
        [dragOrder.id, dragOrder],
        [scrubber.id, scrubber],
      ]),
      TAP_LINE_PUZZLE: tapLine,
      DRAG_ORDER_PUZZLE: dragOrder,
      SCRUBBER_PUZZLE: scrubber,
    }
  })

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return {
    ...actual,
    FIRST_RUN_SET: FIXTURE_SET,
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
  trackAttempt: vi.fn(),
  trackError: vi.fn(),
  trackFirstRunStepComplete: vi.fn(),
  trackFirstRunCompleted: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { trackAttempt, trackFirstRunStepComplete, trackFirstRunCompleted } =
  await import('../../telemetry')

function answerAndContinue(
  result: { current: ReturnType<typeof useFirstRunSession> },
  correct: boolean,
) {
  act(() => {
    result.current.handleAnswered({ correct, choiceIndex: correct ? 0 : 1 })
  })
  act(() => {
    result.current.handleContinue()
  })
}

/** Answers both of the scrubber puzzle's checkpoints (correct or not), matching SCRUBBER_PUZZLE's fixture shape above. */
function answerScrubberCheckpoints(
  result: { current: ReturnType<typeof useFirstRunSession> },
  corrects: [boolean, boolean],
) {
  act(() => {
    result.current.onCheckpointAnswered({ correct: corrects[0], choiceIndex: corrects[0] ? 0 : 1 })
  })
  act(() => {
    result.current.onCheckpointAnswered({ correct: corrects[1], choiceIndex: corrects[1] ? 0 : 1 })
  })
}

describe('useFirstRunSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue({
      ...createDefaultProfile(),
      firstRunCompleted: false,
    })
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves FIRST_RUN_SET[0] first, at position 1', async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.puzzle?.id).toBe(TAP_LINE_PUZZLE.id)
    expect(result.current.position).toBe(1)
    expect(result.current.phase).toBe('playing')
    expect(result.current.totalPuzzles).toBe(3)
  })

  it('serves puzzles 1 and 2 in fixed order via handleAnswered + handleContinue', async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe(DRAG_ORDER_PUZZLE.id)
    })
    expect(result.current.position).toBe(2)
    expect(result.current.phase).toBe('playing')
  })

  it('serves puzzle 3 (scrubber) after puzzle 2, and it is answered via onCheckpointAnswered', async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.puzzle?.id).toBe(SCRUBBER_PUZZLE.id)
    })
    expect(result.current.position).toBe(3)
    expect(result.current.checkpointResults).toEqual([])
    expect(result.current.isComplete).toBe(false)
    expect(result.current.solved).toBeNull()
  })

  it('phase stays "playing" through all 3 puzzles and only flips to "ended" once handleContinue fires after puzzle 3 commits', async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(3)
    })

    answerScrubberCheckpoints(result, [true, true])
    expect(result.current.isComplete).toBe(true)
    // Commit has already happened (see the dedicated
    // "firstRunCompleted flips at commit time" test below) but phase is
    // still 'playing' — handleContinue is what ends the sequence.
    expect(result.current.phase).toBe('playing')

    act(() => {
      result.current.handleContinue()
    })
    expect(result.current.phase).toBe('ended')
  })

  it('is a normal rated Practice attempt: rates every puzzle, including wrong answers, with mode "practice"', async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const before = result.current.profile
    if (!before) throw new Error('expected a profile to be loaded')
    const expectedNewRating = updateRating(
      before.rating,
      TAP_LINE_PUZZLE.difficulty_rating,
      false,
      before.ratedAttemptCount,
    )
    const expectedDelta = roundForDisplay(expectedNewRating) - roundForDisplay(before.rating)

    act(() => {
      result.current.handleAnswered({ correct: false, choiceIndex: 1 })
    })

    expect(result.current.ratingDelta).toBe(expectedDelta)
    expect(result.current.profile?.rating).toBe(expectedNewRating)
    expect(result.current.profile?.ratedAttemptCount).toBe(1)
    expect(appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'practice', puzzleId: TAP_LINE_PUZZLE.id, correct: false }),
    )
    expect(trackAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        puzzle_id: TAP_LINE_PUZZLE.id,
        correct: false,
        mode: 'practice',
        interaction: 'tap-line',
        user_rating_before: before.rating,
        user_rating_after: expectedNewRating,
      }),
    )
  })

  it('fires first_run_step_complete once per puzzle position, with the right position/puzzle_id/interaction/correct', async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    expect(trackFirstRunStepComplete).toHaveBeenNthCalledWith(1, {
      position: 1,
      puzzle_id: TAP_LINE_PUZZLE.id,
      interaction: 'tap-line',
      correct: true,
    })

    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.position).toBe(3)
    })
    expect(trackFirstRunStepComplete).toHaveBeenNthCalledWith(2, {
      position: 2,
      puzzle_id: DRAG_ORDER_PUZZLE.id,
      interaction: 'drag-order',
      correct: false,
    })

    answerScrubberCheckpoints(result, [true, true])
    expect(trackFirstRunStepComplete).toHaveBeenNthCalledWith(3, {
      position: 3,
      puzzle_id: SCRUBBER_PUZZLE.id,
      interaction: 'scrubber',
      correct: true,
    })
    expect(trackFirstRunStepComplete).toHaveBeenCalledTimes(3)
  })

  it("fires first_run_completed exactly once, at puzzle 3's commit, with the correct_count tally", async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    expect(trackFirstRunCompleted).not.toHaveBeenCalled()

    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.position).toBe(3)
    })
    expect(trackFirstRunCompleted).not.toHaveBeenCalled()

    answerScrubberCheckpoints(result, [true, true])
    expect(trackFirstRunCompleted).toHaveBeenCalledTimes(1)
    expect(trackFirstRunCompleted).toHaveBeenCalledWith({ correct_count: 2 })
  })

  it("flips profile.firstRunCompleted to true at puzzle 3's COMMIT time (onCheckpointAnswered), not at handleContinue / the payoff screen tap", async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    expect(result.current.profile?.firstRunCompleted).toBe(false)

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(3)
    })
    expect(result.current.profile?.firstRunCompleted).toBe(false)

    // The final checkpoint's commit — not handleContinue, which hasn't
    // fired yet — is what flips this. phase is still 'playing' here.
    answerScrubberCheckpoints(result, [true, true])
    expect(result.current.phase).toBe('playing')
    expect(result.current.profile?.firstRunCompleted).toBe(true)
    expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ firstRunCompleted: true }))
  })

  it('accumulates every puzzle result into runAttempts, in play order — feeds the payoff screen ChallengeButton', async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    answerAndContinue(result, false)
    await waitFor(() => {
      expect(result.current.position).toBe(3)
    })
    answerScrubberCheckpoints(result, [true, true])

    expect(result.current.runAttempts).toEqual([
      { puzzleId: TAP_LINE_PUZZLE.id, correct: true, time_ms: expect.any(Number) as number },
      { puzzleId: DRAG_ORDER_PUZZLE.id, correct: false, time_ms: expect.any(Number) as number },
      { puzzleId: SCRUBBER_PUZZLE.id, correct: true, time_ms: expect.any(Number) as number },
    ])
  })

  it('any missed checkpoint on puzzle 3 fails the whole attempt (scoreScrubberAttempt semantics)', async () => {
    const { result } = renderHook(() => useFirstRunSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(2)
    })
    answerAndContinue(result, true)
    await waitFor(() => {
      expect(result.current.position).toBe(3)
    })

    answerScrubberCheckpoints(result, [true, false])
    expect(result.current.solved).toBe(false)
    expect(trackFirstRunCompleted).toHaveBeenCalledWith({ correct_count: 2 })
  })
})
