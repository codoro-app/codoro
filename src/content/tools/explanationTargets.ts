/**
 * Shared "what are this puzzle's wrong-answer targets" logic between
 * generateExplanations.ts and validateExplanations.ts. Both must agree
 * exactly on this or the generator's idea of "covered" and the validator's
 * idea of "covered" drift apart. F35 applies here too: mcq's targets key
 * into `puzzle.choices` by canonical index, never a shuffled on-screen
 * position (Mcq.tsx's `shuffledIndices`/`originalIndex`).
 */
import type { Puzzle } from '../schema'

/**
 * Every wrong-answer target for `puzzle`, by canonical index. Returns null
 * for an interaction this pipeline doesn't explain (drag-order, scrubber —
 * spec §10).
 */
export function wrongTargetsFor(puzzle: Puzzle): number[] | null {
  if (puzzle.interaction === 'mcq') {
    return puzzle.choices
      .map((_, index) => index)
      .filter((index) => index !== puzzle.correct_choice)
  }
  if (puzzle.interaction === 'tap-line') {
    const lineCount = puzzle.snippet.split('\n').length
    return Array.from({ length: lineCount }, (_, index) => index).filter(
      (index) => index !== puzzle.correct_line,
    )
  }
  if (puzzle.interaction === 'swipe-binary') {
    return [0]
  }
  return null
}
