import { useMemo } from 'react'
import type { InteractionBodyProps } from '../interactionTypes'
import type { TapLinePuzzle } from '../../../content'
import type { AnswerState } from '../answerState'
import { highlightSnippet } from '../highlightSnippet'
import { CodeSnippet } from '../CodeSnippet'

/**
 * Every snippet line is the tap target — a plain click handler per line, no
 * drag gesture (tap-line was never a gesture interaction). Reuses
 * {@link CodeSnippet}, the same syntax-highlighted line renderer
 * PuzzleCardShell uses for the static (mcq/swipe-binary) snippet view.
 */
export function TapLine({
  puzzle,
  committed,
  committedPayload,
  onCommit,
}: InteractionBodyProps<TapLinePuzzle>) {
  const lines = useMemo(
    () => highlightSnippet(puzzle.snippet, puzzle.language),
    [puzzle.snippet, puzzle.language],
  )

  const handleLineClick = (index: number) => {
    if (committed) return
    onCommit({ correct: index === puzzle.correct_line, choiceIndex: index })
  }

  const stateFor = (index: number): AnswerState => {
    if (!committed) return 'default'
    const chosenIndex = committedPayload?.choiceIndex ?? null
    const isCorrectLine = index === puzzle.correct_line
    if (chosenIndex === index) return isCorrectLine ? 'correct' : 'wrong'
    if (isCorrectLine) return 'reveal-correct'
    return 'default'
  }

  return (
    <CodeSnippet
      lines={lines}
      onLineClick={committed ? undefined : handleLineClick}
      lineState={stateFor}
    />
  )
}
