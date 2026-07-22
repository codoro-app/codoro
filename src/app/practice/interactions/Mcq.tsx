import { useState } from 'react'
import type { InteractionBodyProps } from '../interactionTypes'
import type { McqPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'
import { shuffledIndices } from './shuffleChoices'

/**
 * Leading A/B/C/D badge per choice (v2 Arena design, purely presentational
 * — see task-4 brief's decision to key the letter off on-screen *position*,
 * not the original authored index, so it always reads A/B/C/D top-to-bottom
 * regardless of the per-attempt shuffle below). Once committed, the chosen
 * choice's badge swaps to a checkmark/X (matching the feedback panel's icon
 * treatment) instead of a persistent glyph. `aria-hidden` because the
 * letter/icon carries no information the choice's own text doesn't already
 * give a screen reader — it must not affect the button's accessible name.
 */
function ChoiceBadge({ state, letter }: { state: AnswerState; letter: string }) {
  if (state === 'correct' || state === 'reveal-correct') {
    return (
      <span className="mcq-choice__badge" aria-hidden="true">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    )
  }
  if (state === 'wrong') {
    return (
      <span className="mcq-choice__badge" aria-hidden="true">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    )
  }
  return (
    <span className="mcq-choice__badge" aria-hidden="true">
      {letter}
    </span>
  )
}

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
      {displayOrder.map((originalIndex, position) => {
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
            <ChoiceBadge state={state} letter={String.fromCharCode(65 + position)} />
            {choiceText}
          </button>
        )
      })}
    </div>
  )
}
