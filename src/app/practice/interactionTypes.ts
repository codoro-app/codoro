import type { Puzzle, QuizPuzzle } from '../../content'

/**
 * Human label per `QuizPuzzle['interaction']` value — the source for
 * Practice's `?interaction=` filter (Phase 5 Item 4). `scrubber` is
 * deliberately absent: Practice/Daily/Rush all serve from `quizPool`, which
 * already statically excludes it (see content/index.ts's own doc comment).
 * A `Record` over the real union, not a hand-written array of keys — adding
 * a fourth quiz interaction to the schema fails this object to compile
 * until a label is added, which QUIZ_INTERACTIONS below then picks up for
 * free (a hand-written array wouldn't have grown automatically).
 */
export const QUIZ_INTERACTION_LABELS: Record<QuizPuzzle['interaction'], string> = {
  mcq: 'Multiple choice',
  'swipe-binary': 'Swipe',
  'tap-line': 'Tap the line',
  'drag-order': 'Drag to reorder',
}

export const QUIZ_INTERACTIONS = Object.keys(
  QUIZ_INTERACTION_LABELS,
) as readonly QuizPuzzle['interaction'][]

/** What an interaction body reports back to the shell when the user commits an answer. */
export interface CommitPayload {
  correct: boolean
  /** Index into `choices` (mcq) or the snippet's lines (tap-line). null for swipe-binary and drag-order (correctness is holistic across the whole arrangement, not a single index). */
  choiceIndex: number | null
}

/** Props every interaction-body component (one per `Puzzle['interaction']` variant) receives. */
export interface InteractionBodyProps<P extends Puzzle = Puzzle> {
  puzzle: P
  /** True once the shell has received a commit — body must stop accepting input and show its own answered state (e.g. highlight the chosen + correct choice). */
  committed: boolean
  /** The payload the body itself last reported, once committed (undefined before commit). Lets the body render "you picked X, the right answer was Y" without re-deriving it. */
  committedPayload: CommitPayload | undefined
  onCommit: (payload: CommitPayload) => void
}
