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
import { useRovingFocus } from '../practice/useRovingFocus'

type Checkpoint = ScrubberPuzzle['checkpoints'][number]

export interface CheckpointPanelProps {
  checkpoint: Checkpoint
  steps: ScrubberPuzzle['steps']
  /** This checkpoint's recorded result, once answered. undefined = not yet answered. */
  result: CheckpointResult | undefined
  onAnswer: (result: CheckpointResult) => void
}

// 2b.0: was `.checkpoint-choice__badge` (base) + `.checkpoint-choice--correct
// .checkpoint-choice__badge`/`--reveal-correct`/`--wrong` descendant
// overrides (scrubber.css) — same shape as Mcq.tsx's ChoiceBadge equivalent.
const BADGE_BASE =
  'flex-none flex items-center justify-center rounded-xs font-mono font-bold text-xs py-0.5 px-2'
function badgeClass(state: AnswerState): string {
  if (state === 'correct' || state === 'reveal-correct')
    return `${BADGE_BASE} bg-accent text-accent-ink`
  if (state === 'wrong') return `${BADGE_BASE} bg-danger text-accent-ink`
  return `${BADGE_BASE} bg-surface-2 text-text-1`
}

/** Leading A/B/C/D badge per choice, swapping to a check/x once committed — adapted from Mcq.tsx's ChoiceBadge (see this file's doc comment for why it's a local copy, not an import). */
function ChoiceBadge({ state, letter }: { state: AnswerState; letter: string }) {
  if (state === 'correct' || state === 'reveal-correct') {
    return (
      <span className={badgeClass(state)} aria-hidden="true">
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
      <span className={badgeClass(state)} aria-hidden="true">
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
    <span className={badgeClass(state)} aria-hidden="true">
      {letter}
    </span>
  )
}

function questionLabel(question: Checkpoint['question']): string {
  if (question === 'var-value') return 'What is its value?'
  if (question === 'output') return 'What did this line print?'
  return 'Which line runs next?'
}

/**
 * `next-line` choices are raw 0-indexed `line` values (schema/validator
 * convention); the gutter and StateDiff both display 1-indexed line
 * numbers, so the choice label must match. Falls back to the raw string if
 * it isn't numeric (choices is `z.array(z.string())`, not guaranteed
 * numeric) so a player is never shown the literal text "NaN".
 */
function displayChoiceText(question: Checkpoint['question'], choiceText: string): string {
  if (question !== 'next-line') return choiceText
  const asNumber = Number(choiceText)
  return Number.isNaN(asNumber) ? choiceText : String(asNumber + 1)
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
      <p className="checkpoint-diff m-0 py-2.5 px-3 bg-surface-1 border border-border rounded-md text-sm font-mono text-text-1">
        <span className="text-text-1">{checkpoint.target}:</span>{' '}
        <span className="text-text-2 line-through">{previousValue}</span>
        {' → '}
        <span className="text-text-0 font-semibold">{newValue}</span>
      </p>
    )
  }

  if (checkpoint.question === 'output' && step.output !== undefined) {
    return (
      <p className="checkpoint-diff m-0 py-2.5 px-3 bg-surface-1 border border-border rounded-md text-sm font-mono text-text-1">
        <span className="text-text-1">Printed:</span>{' '}
        <span className="text-text-0 font-semibold">{step.output}</span>
      </p>
    )
  }

  if (checkpoint.question === 'next-line') {
    const nextStep = steps[checkpoint.afterStep + 1]
    if (!nextStep) return null
    return (
      <p className="checkpoint-diff m-0 py-2.5 px-3 bg-surface-1 border border-border rounded-md text-sm font-mono text-text-1">
        <span className="text-text-1">Next:</span>{' '}
        <span className="text-text-0 font-semibold">Line {nextStep.line + 1}</span>
      </p>
    )
  }

  return null
}

// 2b.0: was `.checkpoint-choice` base + `--correct`/`--reveal-correct`/
// `--wrong` state classes, plus a `:disabled:not(...)` chain in
// scrubber.css for the "committed but this wasn't the chosen/correct/wrong
// one" dimmed state — same shape as Mcq.tsx's choiceClass. Bare
// `checkpoint-choice`/`--correct`/`--wrong` markers stay literal
// (test-asserted: CheckpointPanel.test.tsx/.pool.test.tsx,
// TraceRunner.test.tsx's `querySelectorAll('.checkpoint-choice')`).
const CHOICE_BASE =
  'checkpoint-choice flex items-start gap-3 min-h-11 w-full py-3 px-4 rounded-md border text-sm font-mono text-left cursor-pointer disabled:cursor-default'
function choiceClass(committed: boolean, state: AnswerState): string {
  if (state === 'correct' || state === 'reveal-correct') {
    return `${CHOICE_BASE} checkpoint-choice--${state} border-[1.5px] border-accent bg-ok-dim text-text-0`
  }
  if (state === 'wrong') {
    return `${CHOICE_BASE} checkpoint-choice--wrong border-[1.5px] border-danger bg-danger-dim text-text-0`
  }
  return `${CHOICE_BASE} border-border bg-surface-1 text-text-0${committed ? ' opacity-55' : ''}`
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
  const { itemProps } = useRovingFocus(displayOrder.length, committed || locked)

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
    <div className="checkpoint-panel flex flex-col gap-3" role="group" aria-label="Checkpoint">
      <p className="m-0 text-text-1 text-sm">{questionLabel(checkpoint.question)}</p>
      <div className="flex flex-col gap-2">
        {displayOrder.map((originalIndex, position) => {
          const choiceText = checkpoint.choices[originalIndex]
          if (choiceText === undefined) {
            throw new Error(`CheckpointPanel: shuffled index ${String(originalIndex)} out of range`)
          }
          const state = stateFor(originalIndex)
          const className = choiceClass(committed, state)
          const roving = itemProps(position)
          return (
            <button
              key={originalIndex}
              type="button"
              className={className}
              onClick={() => {
                handleClick(originalIndex)
              }}
              disabled={committed || locked}
              tabIndex={roving.tabIndex}
              ref={roving.ref}
              onFocus={roving.onFocus}
              onKeyDown={roving.onKeyDown}
            >
              <ChoiceBadge state={state} letter={String.fromCharCode(65 + position)} />
              {displayChoiceText(checkpoint.question, choiceText)}
            </button>
          )
        })}
      </div>
      {committed && <StateDiff checkpoint={checkpoint} steps={steps} />}
    </div>
  )
}
