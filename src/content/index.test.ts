import { describe, expect, it } from 'vitest'
import { getPuzzleBody, puzzleMeta, puzzlePool, quizPool, scrubberPool } from './index'

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

/**
 * P0 regression coverage over the real pool (not a fixture): a scrubber
 * puzzle reaching Practice/Daily/Rush rendered an empty, un-escapable
 * interaction div (no case for it in PuzzleCardShell's old &&-chain) — see
 * docs/v2-phase2-review.md. `quizPool`/`scrubberPool` are the fix; this
 * pins the partition against the actual shipped content so it fails the
 * moment either filter's condition is loosened or inverted.
 */
describe('quizPool / scrubberPool — pool split', () => {
  it('quizPool contains no scrubber puzzles', () => {
    // Cast to a wider element type for this one check: `quizPool`'s own
    // type (QuizPuzzle[]) already statically excludes 'scrubber', so
    // comparing the narrowed field directly is flagged as a no-op
    // comparison by tsc — this widens back to the runtime string field the
    // filter predicate actually checks, so a predicate that silently lied
    // about its type guard would still be caught here.
    const interactions = (quizPool as readonly { interaction: string }[]).map(
      (puzzle) => puzzle.interaction,
    )
    expect(interactions).not.toContain('scrubber')
  })

  it('scrubberPool contains only scrubber puzzles, and at least one (Phase 2 pilots)', () => {
    expect(scrubberPool.length).toBeGreaterThan(0)
    // Same widen-then-check as quizPool's test above — scrubberPool's own
    // type already guarantees this statically.
    const interactions = (scrubberPool as readonly { interaction: string }[]).map(
      (puzzle) => puzzle.interaction,
    )
    expect(interactions.every((interaction) => interaction === 'scrubber')).toBe(true)
  })

  it('quizPool and scrubberPool partition puzzlePool exactly, with no overlap', () => {
    expect(quizPool.length + scrubberPool.length).toBe(puzzlePool.length)
    const scrubberIds = new Set(scrubberPool.map((puzzle) => puzzle.id))
    expect(quizPool.some((puzzle) => scrubberIds.has(puzzle.id))).toBe(false)
  })
})

describe('puzzleMeta', () => {
  it('has one entry per puzzlePool entry, with matching id/pattern/difficulty_rating/interaction', () => {
    expect(puzzleMeta.length).toBe(puzzlePool.length)
    const byId = new Map(puzzlePool.map((p) => [p.id, p]))
    for (const meta of puzzleMeta) {
      const full = byId.get(meta.id)
      expect(full, `${meta.id} missing from puzzlePool`).toBeDefined()
      expect(meta.pattern).toBe(full?.pattern)
      expect(meta.difficulty_rating).toBe(full?.difficulty_rating)
      expect(meta.interaction).toBe(full?.interaction)
    }
  })
})

describe('getPuzzleBody', () => {
  it('resolves the real, fully-validated puzzle for a known id', async () => {
    const known = puzzlePool[0]
    if (!known) throw new Error('puzzlePool is empty in test env')
    const body = await getPuzzleBody(known.id)
    expect(body).toEqual(known)
  })

  it('resolves undefined for an unknown id', async () => {
    const body = await getPuzzleBody('nonexistent-id-xyz')
    expect(body).toBeUndefined()
  })
})
