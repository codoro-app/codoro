import type { Puzzle } from '../../content'

/** What an interaction body reports back to the shell when the user commits an answer. */
export interface CommitPayload {
  correct: boolean
  /** Index into `choices` (mcq) or the snippet's lines (tap-line). null for swipe-binary. */
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
