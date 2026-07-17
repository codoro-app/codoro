import type { InteractionBodyProps } from '../interactionTypes'
import type { McqPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'

/**
 * Vertical list of full-width tappable choice buttons. Close to final —
 * mcq doesn't need gesture work, unlike swipe-binary/tap-line.
 */
export function Mcq({
  puzzle,
  committed,
  committedPayload,
  onCommit,
}: InteractionBodyProps<McqPuzzle>) {
  const chosenIndex = committedPayload?.choiceIndex ?? null

  const handleClick = (index: number) => {
    if (committed) return
    onCommit({ correct: index === puzzle.correct_choice, choiceIndex: index })
  }

  const stateFor = (index: number): AnswerState => {
    if (!committed) return 'default'
    const isChosen = chosenIndex === index
    const isCorrectChoice = index === puzzle.correct_choice
    if (isChosen) return isCorrectChoice ? 'correct' : 'wrong'
    if (isCorrectChoice) return 'reveal-correct'
    return 'default'
  }

  return (
    <div className="mcq-choices">
      {puzzle.choices.map((choice, index) => {
        const state = stateFor(index)
        const className = ['mcq-choice', state !== 'default' && `mcq-choice--${state}`]
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={index}
            type="button"
            className={className}
            onClick={() => {
              handleClick(index)
            }}
            disabled={committed}
          >
            {choice}
          </button>
        )
      })}
    </div>
  )
}
