import type { InteractionBodyProps } from '../interactionTypes'
import type { SwipeBinaryPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'

/**
 * Non-gesture fallback for swipe-binary: `left_label` / `right_label` as
 * hints plus two labelled side buttons (danger-bordered left,
 * success-bordered right) that commit directly on click/tap. Drag physics
 * (`@use-gesture/react` + `framer-motion`) are concern (b)'s job, built ON
 * TOP of this fallback — this component must stay fully playable via the
 * buttons alone, since it is not replaced, only augmented.
 *
 * `CommitPayload.choiceIndex` is `null` for swipe-binary by contract — but
 * since this is a strictly binary choice, `correct` + `puzzle.correct_direction`
 * is always enough to reconstruct which side was actually picked (if
 * correct, the pick was `correct_direction`; if not, it was the other one),
 * so no additional field is needed to render "you picked X" post-commit.
 */
export function SwipeBinary({
  puzzle,
  committed,
  committedPayload,
  onCommit,
}: InteractionBodyProps<SwipeBinaryPuzzle>) {
  const handlePick = (direction: 'left' | 'right') => {
    if (committed) return
    onCommit({ correct: direction === puzzle.correct_direction, choiceIndex: null })
  }

  const chosenDirection: 'left' | 'right' | null =
    committed && committedPayload
      ? committedPayload.correct
        ? puzzle.correct_direction
        : puzzle.correct_direction === 'left'
          ? 'right'
          : 'left'
      : null

  const stateFor = (direction: 'left' | 'right'): AnswerState => {
    if (!committed || !committedPayload) return 'default'
    if (direction === chosenDirection) return committedPayload.correct ? 'correct' : 'wrong'
    if (direction === puzzle.correct_direction) return 'reveal-correct'
    return 'default'
  }

  const classFor = (direction: 'left' | 'right') => {
    const state = stateFor(direction)
    return [
      'swipe-fallback__button',
      `swipe-fallback__button--${direction}`,
      state !== 'default' && `swipe-fallback__button--${state}`,
    ]
      .filter(Boolean)
      .join(' ')
  }

  return (
    <div className="swipe-fallback">
      <p className="swipe-fallback__hint">Pick a side — drag gestures land in a later phase.</p>
      <div className="swipe-fallback__buttons">
        <button
          type="button"
          className={classFor('left')}
          onClick={() => {
            handlePick('left')
          }}
          disabled={committed}
        >
          {puzzle.left_label}
        </button>
        <button
          type="button"
          className={classFor('right')}
          onClick={() => {
            handlePick('right')
          }}
          disabled={committed}
        >
          {puzzle.right_label}
        </button>
      </div>
    </div>
  )
}
