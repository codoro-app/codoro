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

export const DEV_STUB_PUZZLES: Puzzle[] = BANDS.flatMap((rating, i) => [
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
    explanation: `DEV STUB (swipe-binary, ${String(rating)}) — always swipe right.`,
    prompt: 'DEV STUB — swipe right for correct.',
    language: 'javascript',
    snippet: `// dev stub swipe #${String(i)}`,
    interaction: 'swipe-binary',
    left_label: 'Incorrect',
    right_label: 'Correct',
    correct_direction: 'right',
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
])
