import { useState } from 'react'
import type { InteractionBodyProps } from '../interactionTypes'
import type { McqPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'
import { shuffledIndices } from './shuffleChoices'

/**
 * Vertical list of full-width tappable choice buttons. Close to final —
 * mcq doesn't need gesture work, unlike swipe-binary/tap-line.
 *
 * Choices render in a shuffled order (see shuffleChoices.ts), computed
 * once via lazy useState init — PuzzleCardShell keys its interaction body
 * by puzzle.id, so this component fully remounts per attempt, giving a
 * fresh shuffle each time a puzzle is served (including a repeat serving
 * of the same puzzle later) rather than a fixed order per puzzle.
 * `choiceIndex` (in the commit payload, and every index passed to
 * handleClick/stateFor below) always refers to the *original* authored
 * index, matching `puzzle.correct_choice` — only the on-screen position
 * is shuffled.
 */
export function Mcq({
  puzzle,
  committed,
  committedPayload,
  onCommit,
}: InteractionBodyProps<McqPuzzle>) {
  const [displayOrder] = useState(() => shuffledIndices(puzzle.choices.length))
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
      {displayOrder.map((originalIndex) => {
        const choiceText = puzzle.choices[originalIndex]
        if (choiceText === undefined) {
          throw new Error(`Mcq: shuffled index ${String(originalIndex)} out of range`)
        }
        const state = stateFor(originalIndex)
        const className = ['mcq-choice', state !== 'default' && `mcq-choice--${state}`]
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={originalIndex}
            type="button"
            className={className}
            onClick={() => {
              handleClick(originalIndex)
            }}
            disabled={committed}
          >
            {choiceText}
          </button>
        )
      })}
    </div>
  )
}
