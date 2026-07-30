/**
 * Renders exactly one checkpoint's answer UI for whichever checkpoint sits
 * at the trace's current pause step — TraceRunner mounts this only when
 * `stepIndex` equals a checkpoint's `afterStep`, keyed by that `afterStep`
 * so a fresh instance (fresh shuffle) is used per checkpoint.
 *
 * Two states, both driven purely off `result` (undefined = unanswered),
 * both rendering the *same* `displayOrder.map(...)` choice list — the
 * buttons never leave the tree, `committed` only toggles their `disabled`
 * attribute and color classes:
 *  - Unanswered: a vertical choice list, adapted from Mcq.tsx's
 *    ChoiceBadge + shuffledIndices pattern (same aria/interaction
 *    conventions — reuses `shuffledIndices` directly since it's a pure,
 *    puzzle-shape-agnostic algorithm; the badge/list JSX is a new local
 *    component since the commit shape here is per-checkpoint, not
 *    per-puzzle CommitPayload). Tapping a choice commits immediately —
 *    there is no retry path: `handleClick`'s guard (`committed ||
 *    lockedRef.current`) blocks any further click synchronously, and once
 *    `onAnswer` fires the parent flips `result` to defined on its next
 *    render, which re-renders this same list disabled (see below) — no
 *    enabled control is ever left that could re-submit a different answer.
 *  - Answered: the same choice list re-rendered disabled with
 *    correct/wrong/reveal-correct coloring (mirrors Mcq's post-commit
 *    state), plus a one-line state-diff summary of what the trace actually
 *    did at this step (previous -> new value for var-value, the produced
 *    output for output, the resulting next line for next-line) — the
 *    "reveal the correct value/output, show the state diff" requirement.
 *    `steps[checkpoint.afterStep + 1]` (next-line's answer) is only ever
 *    read inside this branch, which only renders once `result` is defined.
 */
import { useRef, useState } from 'react'
import type { CheckpointResult } from '../../engine'
import type { ScrubberPuzzle } from '../../content'
import type { AnswerState } from '../practice/answerState'
import { shuffledIndices } from '../practice/interactions/shuffleChoices'

type Checkpoint = ScrubberPuzzle['checkpoints'][number]

export interface CheckpointPanelProps {
  checkpoint: Checkpoint
  steps: ScrubberPuzzle['steps']
  /** This checkpoint's recorded result, once answered. undefined = not yet answered. */
  result: CheckpointResult | undefined
  onAnswer: (result: CheckpointResult) => void
}

/** Leading A/B/C/D badge per choice, swapping to a check/x once committed — adapted from Mcq.tsx's ChoiceBadge (see this file's doc comment for why it's a local copy, not an import). */
function ChoiceBadge({ state, letter }: { state: AnswerState; letter: string }) {
  if (state === 'correct' || state === 'reveal-correct') {
    return (
      <span className="checkpoint-choice__badge" aria-hidden="true">
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
      <span className="checkpoint-choice__badge" aria-hidden="true">
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
    <span className="checkpoint-choice__badge" aria-hidden="true">
      {letter}
    </span>
  )
}

function questionLabel(question: Checkpoint['question']): string {
  if (question === 'var-value') return 'What is its value?'
  if (question === 'output') return 'What did this line print?'
  return 'Which line runs next?'
}

/** The trace's own state-diff summary for this checkpoint's step transition, shown only once answered. */
function StateDiff({
  checkpoint,
  steps,
}: {
  checkpoint: Checkpoint
  steps: ScrubberPuzzle['steps']
}) {
  const step = steps[checkpoint.afterStep]
  if (!step) return null

  if (checkpoint.question === 'var-value' && checkpoint.target) {
    const target = checkpoint.target
    const previousStep = checkpoint.afterStep > 0 ? steps[checkpoint.afterStep - 1] : undefined
    const previousValue =
      previousStep && Object.hasOwn(previousStep.vars, target)
        ? (previousStep.vars[target] ?? '(not yet set)')
        : '(not yet set)'
    const newValue = step.vars[target] ?? ''
    return (
      <p className="checkpoint-diff">
        <span className="checkpoint-diff__label">{checkpoint.target}:</span>{' '}
        <span className="checkpoint-diff__from">{previousValue}</span>
        {' → '}
        <span className="checkpoint-diff__to">{newValue}</span>
      </p>
    )
  }

  if (checkpoint.question === 'output' && step.output !== undefined) {
    return (
      <p className="checkpoint-diff">
        <span className="checkpoint-diff__label">Printed:</span>{' '}
        <span className="checkpoint-diff__to">{step.output}</span>
      </p>
    )
  }

  if (checkpoint.question === 'next-line') {
    const nextStep = steps[checkpoint.afterStep + 1]
    if (!nextStep) return null
    return (
      <p className="checkpoint-diff">
        <span className="checkpoint-diff__label">Next:</span>{' '}
        <span className="checkpoint-diff__to">Line {nextStep.line + 1}</span>
      </p>
    )
  }

  return null
}

export function CheckpointPanel({ checkpoint, steps, result, onAnswer }: CheckpointPanelProps) {
  const [displayOrder] = useState(() => shuffledIndices(checkpoint.choices.length))
  // The actual re-entry guard is `lockedRef`, a mutable ref, not the
  // `locked` state below: two click events dispatched synchronously
  // back-to-back (no yield between them, e.g. a double-fire bug or a
  // fast synthetic double-click) both run inside the same React batch,
  // before any re-render — every closure captured in that batch still
  // sees whatever `useState` value was current at the *start* of the
  // batch, so a `useState`-only guard cannot actually stop the second
  // call from also invoking `onAnswer`. A ref sidesteps that: mutating
  // `lockedRef.current` takes effect immediately, synchronously, so the
  // second invocation (even within the same unflushed batch) observes
  // the first invocation's write. `locked` state still exists purely to
  // drive the disabled/visual styling below (a ref mutation alone
  // doesn't trigger a re-render).
  const lockedRef = useRef(false)
  const [locked, setLocked] = useState(false)
  const committed = result !== undefined

  const handleClick = (index: number) => {
    if (committed || lockedRef.current) return
    lockedRef.current = true
    setLocked(true)
    onAnswer({ correct: index === checkpoint.correct, choiceIndex: index })
  }

  const stateFor = (index: number): AnswerState => {
    if (!committed) return 'default'
    const isChosen = result.choiceIndex === index
    const isCorrectChoice = index === checkpoint.correct
    if (isChosen) return isCorrectChoice ? 'correct' : 'wrong'
    if (isCorrectChoice) return 'reveal-correct'
    return 'default'
  }

  return (
    <div className="checkpoint-panel" role="group" aria-label="Checkpoint">
      <p className="checkpoint-panel__question">{questionLabel(checkpoint.question)}</p>
      <div className="checkpoint-choices">
        {displayOrder.map((originalIndex, position) => {
          const choiceText = checkpoint.choices[originalIndex]
          if (choiceText === undefined) {
            throw new Error(`CheckpointPanel: shuffled index ${String(originalIndex)} out of range`)
          }
          const state = stateFor(originalIndex)
          const className = [
            'checkpoint-choice',
            state !== 'default' && `checkpoint-choice--${state}`,
          ]
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
              disabled={committed || locked}
            >
              <ChoiceBadge state={state} letter={String.fromCharCode(65 + position)} />
              {choiceText}
            </button>
          )
        })}
      </div>
      {committed && <StateDiff checkpoint={checkpoint} steps={steps} />}
    </div>
  )
}
