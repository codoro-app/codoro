/**
 * Fisher-Yates permutation of [0, count) — used by Mcq to randomize answer
 * display order per attempt. Every MCQ puzzle in the seed content happens
 * to author `correct_choice: 0`, so rendering choices in authored order
 * would make the correct answer's *screen position* perfectly predictable
 * across every puzzle, training players to pattern-match position instead
 * of reasoning about the bug. Zero React dependency by design, same
 * rationale as gestureThreshold.ts: correctness-adjacent randomness is
 * worth unit-testing in isolation from any component.
 */
export function shuffledIndices(count: number, rng: () => number = Math.random): number[] {
  const indices = Array.from({ length: count }, (_, i) => i)
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = indices[i]
    const b = indices[j]
    if (a === undefined || b === undefined) {
      throw new Error('shuffledIndices: index out of range')
    }
    indices[i] = b
    indices[j] = a
  }
  return indices
}
