/**
 * The fixture-based CheckpointPanel.test.tsx hand-builds its steps/checkpoint
 * data, so it can never catch a mismatch between the *real* content's
 * 0-indexed `line`/choice convention and the UI's 1-indexed display
 * convention — that mismatch is exactly what shipped to production
 * undetected (mut-009, oob-009, scl-009). This file runs the same
 * assertions against every `next-line` checkpoint in the real
 * `scrubberPool` instead of a synthetic fixture.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CheckpointPanel } from './CheckpointPanel'
import { scrubberPool } from '../../content'

describe('CheckpointPanel — real scrubberPool next-line checkpoints', () => {
  for (const puzzle of scrubberPool) {
    puzzle.checkpoints.forEach((checkpoint, checkpointIndex) => {
      if (checkpoint.question !== 'next-line') return

      // The convention under test: choices are raw 0-indexed `line`
      // strings; the gutter/StateDiff display 1-indexed line numbers.
      const expectedLabels = checkpoint.choices.map((raw) => String(Number(raw) + 1))

      it(`${puzzle.id} checkpoint[${String(checkpointIndex)}] (afterStep ${String(checkpoint.afterStep)}): every choice label is the 1-indexed conversion of its raw choice`, () => {
        const { unmount } = render(
          <CheckpointPanel
            checkpoint={checkpoint}
            steps={puzzle.steps}
            result={undefined}
            onAnswer={vi.fn()}
          />,
        )

        for (const label of expectedLabels) {
          expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
        }

        unmount()
      })

      it(`${puzzle.id} checkpoint[${String(checkpointIndex)}] (afterStep ${String(checkpoint.afterStep)}): the reveal's "Next: Line N" agrees with the correct choice's actual rendered label`, () => {
        // Independent oracle for the correct choice specifically, derived
        // straight from the puzzle's own step data rather than the same
        // N+1 formula the implementation uses — this is what lets the test
        // catch a *wrong* conversion, not just a missing one.
        const nextStep = puzzle.steps[checkpoint.afterStep + 1]
        expect(nextStep).toBeDefined()
        const oracleLabel = String((nextStep?.line ?? 0) + 1)

        const { container } = render(
          <CheckpointPanel
            checkpoint={checkpoint}
            steps={puzzle.steps}
            result={{ correct: true, choiceIndex: checkpoint.correct }}
            onAnswer={vi.fn()}
          />,
        )

        // The actual rendered choice-list label for the correct choice
        // (stateFor gives exactly one button this class once answered
        // correctly) — not a recomputed value, the real DOM text.
        const correctButton = container.querySelector('.checkpoint-choice--correct')
        expect(correctButton).not.toBeNull()
        const renderedCorrectLabel = correctButton?.textContent ?? ''
        expect(renderedCorrectLabel).toBe(oracleLabel)

        const diffText = container.querySelector('.checkpoint-diff')?.textContent ?? ''
        const match = /Line (\d+)/.exec(diffText)
        expect(match).not.toBeNull()
        const revealedLine = match?.[1]

        // The property that was violated: the rendered choice list and the
        // rendered reveal must agree on which line number is "correct".
        expect(revealedLine).toBe(renderedCorrectLabel)
      })
    })
  }
})
