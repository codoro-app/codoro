import { describe, expect, it } from 'vitest'
import { puzzlePool } from './index'

/**
 * Rating-integrity regression: a `swipe-binary` puzzle whose `correct_direction`
 * always lands on the same side lets a player who swipes that side blindly,
 * without reading the snippet, climb Elo for free — rated attempts on those
 * puzzles carry no signal. This is a content defect (all 39 puzzles authored
 * with `correct_direction: "right"`, zero `"left"`), not a component defect —
 * `SwipeBinary.tsx`/`gestureThreshold.ts` resolve direction correctly; see
 * docs/v2-build-plan.md Phase 0. Asserted here over the real `puzzlePool`
 * (not a fixture) so this fails against the actual shipped content until the
 * library is rebalanced, and stays green afterward. `validatePuzzles.ts`
 * enforces the same 65/35 bound as a hard build-time failure — this test
 * covers the content itself, independent of that CLI gate.
 */
describe('puzzlePool — swipe-binary direction distribution', () => {
  it('does not skew correct_direction to a single side across the swipe-binary library', () => {
    const swipeBinaryPuzzles = puzzlePool.filter((puzzle) => puzzle.interaction === 'swipe-binary')
    expect(swipeBinaryPuzzles.length).toBeGreaterThan(0)

    const rightCount = swipeBinaryPuzzles.filter(
      (puzzle) => puzzle.correct_direction === 'right',
    ).length
    const leftCount = swipeBinaryPuzzles.length - rightCount
    const rightRatio = rightCount / swipeBinaryPuzzles.length

    expect(leftCount).toBeGreaterThan(0)
    expect(rightRatio).toBeGreaterThanOrEqual(0.35)
    expect(rightRatio).toBeLessThanOrEqual(0.65)
  })
})
