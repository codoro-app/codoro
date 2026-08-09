/**
 * A tiny, hand-written set of trivial "obviously correct/incorrect" puzzles
 * used ONLY by the dev puzzle-mode switch (src/app/devTools/devPuzzleMode.ts)
 * — never part of the real content pool, never touched by
 * `validate:content`/`content:stats`, never shipped to a production build in
 * a reachable way (the switch that serves these is hard-gated to
 * `import.meta.env.DEV`, see devPuzzleMode.ts).
 *
 * Purpose: let Thomas smash through Practice/Daily/Rush's correct/incorrect
 * flows (rating updates, streaks, Rush strikes, share cards) fast, without
 * reading real puzzle content each time. Every puzzle's answer is
 * unambiguous by design — "Correct" is always the right choice/side/line —
 * so a run can be played by pattern-matching the label, not by thinking.
 *
 * Still schema-valid (PuzzleSchema) — see devPuzzles.test.ts — so every
 * consumer (selection.ts's rating-window, rush.ts's difficulty ramp) sees
 * ordinary, well-formed Puzzle objects and needs no special-casing beyond
 * "which array to read from." Three difficulty bands per interaction type
 * (800/1600/2400 — schema's min/max and the midpoint) so Rush's difficulty
 * ramp and Practice's rating-window widening both have something to chew on
 * instead of collapsing to a single puzzle.
 */
import type { Puzzle } from './schema'

const BANDS = [800, 1600, 2400] as const

export const DEV_STUB_PUZZLES: Puzzle[] = BANDS.flatMap((rating, i) => {
  // Alternates which side is correct per band, rather than hardcoding
  // 'right' for every stub — see docs/v2-build-plan.md Phase 0: the real
  // puzzle library anchored all 39 swipe-binary puzzles to correct_direction
  // 'right' because every worked example (here and in generatePuzzles.ts)
  // used only 'right'. Alternating here also means smoke-testing dev mode
  // exercises both swipe directions, not just one.
  const swipeCorrectDirection: 'left' | 'right' = i % 2 === 0 ? 'right' : 'left'

  return [
    {
      id: `dev-mcq-${String(rating)}`,
      pattern: 'off-by-one',
      difficulty_rating: rating,
      explanation: `DEV STUB (mcq, ${String(rating)}) — always answer "Correct answer".`,
      prompt: 'DEV STUB — pick the correct answer.',
      language: 'javascript',
      snippet: `// dev stub mcq #${String(i)}`,
      interaction: 'mcq',
      choices: ['Correct answer', 'Wrong answer'],
      correct_choice: 0,
    },
    {
      id: `dev-swipe-${String(rating)}`,
      pattern: 'mutable-state',
      difficulty_rating: rating,
      explanation: `DEV STUB (swipe-binary, ${String(rating)}) — always swipe ${swipeCorrectDirection}.`,
      prompt: `DEV STUB — swipe ${swipeCorrectDirection} for correct.`,
      language: 'javascript',
      snippet: `// dev stub swipe #${String(i)}`,
      interaction: 'swipe-binary',
      left_label: swipeCorrectDirection === 'left' ? 'Correct' : 'Incorrect',
      right_label: swipeCorrectDirection === 'right' ? 'Correct' : 'Incorrect',
      correct_direction: swipeCorrectDirection,
      correct_verdict: 'bug',
    },
    {
      id: `dev-tap-${String(rating)}`,
      pattern: 'control-flow',
      difficulty_rating: rating,
      explanation: `DEV STUB (tap-line, ${String(rating)}) — always tap the first line.`,
      prompt: 'DEV STUB — tap the correct line.',
      language: 'javascript',
      snippet: 'line 0 — correct\nline 1 — wrong\nline 2 — wrong',
      interaction: 'tap-line',
      correct_line: 0,
    },
    {
      id: `dev-drag-${String(rating)}`,
      pattern: 'recursion-termination',
      difficulty_rating: rating,
      explanation: `DEV STUB (drag-order, ${String(rating)}) — every block states its own correct position; drag them into 1, 2, 3 order.`,
      prompt: 'DEV STUB — drag the blocks into the correct order.',
      language: 'javascript',
      snippet: `// dev stub drag-order #${String(i)}`,
      interaction: 'drag-order',
      // 'output': these blocks are descriptive labels, not fragments of
      // `snippet` (a throwaway comment) — the format that shows the static
      // snippet alongside the drag targets. Unambiguous by design (same
      // convention as the other three stubs above, see this file's module
      // doc) without being the identity permutation — PuzzleSchema now
      // rejects identity correct_order (a puzzle that's already solved on
      // load isn't a puzzle). Each block literally names its own correct
      // position, so it stays trivial to solve by reading alone.
      format: 'output',
      blocks: ['Correct order: 2', 'Correct order: 3', 'Correct order: 1'],
      correct_order: [2, 0, 1],
    },
  ]
})
