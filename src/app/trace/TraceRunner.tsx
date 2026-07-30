/**
 * Container that composes `useTraceSession` (Task 1) with `Scrubber` (Task
 * 2) and `CheckpointPanel` into the real, playable Trace loop: gate
 * forward-scrubbing at the next unanswered checkpoint, mask that
 * checkpoint's answer while it's unanswered, reveal it (plus a state-diff
 * summary) once answered, and show the solve/explanation screen once every
 * checkpoint on the current puzzle has been answered.
 *
 * Split into an outer `TraceRunner` (owns the `useTraceSession` instance,
 * one per mount) and an inner `TraceRunnerPuzzle` (owns per-puzzle UI state
 * — `stepIndex` — and is remounted via `key={puzzle.id}` on every new
 * puzzle, same convention PracticePage uses for `PuzzleCardShell`). This is
 * what guarantees `stepIndex` resets to 0 for a freshly-served puzzle
 * without any extra effect/reset wiring.
 *
 * Gating/masking model: at most one checkpoint is ever "at" the current
 * step (`checkpoints[i].afterStep` values are strictly ordered, no
 * duplicates — enforced by ScrubberSchema). Scrubbing forward is capped at
 * the next *unanswered* checkpoint's `afterStep` via `maxAllowedIndex`, so
 * the player physically cannot reach `afterStep + 1` until that checkpoint
 * is answered — this is what keeps a `next-line` checkpoint's answer
 * (`steps[afterStep + 1]`) out of the DOM entirely rather than merely
 * hidden. Whichever checkpoint's `afterStep` equals the current `stepIndex`
 * (if any) gets its `CheckpointPanel` rendered below the trace — masked/
 * interactive if it's still the pending (next-to-answer) checkpoint,
 * revealed if it's already been answered (including checkpoints the player
 * scrubs back to after answering).
 *
 * First-try-only scoring: `CheckpointPanel` commits a choice immediately —
 * there is no retry UI, matching `scoreScrubberAttempt`'s "each checkpoint
 * accepts exactly one answer" contract that `useTraceSession.
 * handleCheckpointAnswered` already enforces server-side (no-ops once the
 * puzzle is complete). See CheckpointPanel.tsx's doc comment for how the
 * choice list itself makes re-answering unreachable, not just disabled.
 */
import { useState } from 'react'
import { Scrubber } from './Scrubber'
import { CheckpointPanel } from './CheckpointPanel'
import { useTraceSession } from './useTraceSession'
import { hapticTick } from '../practice/haptics'
import type { CheckpointResult } from '../../engine'
import type { ScrubberPuzzle } from '../../content'
import '../tokens.css'
import './scrubber.css'

interface TraceRunnerPuzzleProps {
  puzzle: ScrubberPuzzle
  checkpointResults: readonly CheckpointResult[]
  isComplete: boolean
  solved: boolean | null
  ratingDelta: number | null
  onCheckpointAnswered: (result: CheckpointResult) => void
  onContinue: () => void
}

function TraceRunnerPuzzle({
  puzzle,
  checkpointResults,
  isComplete,
  solved,
  ratingDelta,
  onCheckpointAnswered,
  onContinue,
}: TraceRunnerPuzzleProps) {
  const [stepIndex, setStepIndex] = useState(0)

  const checkpoints = puzzle.checkpoints
  const answeredCount = checkpointResults.length
  const pendingCheckpoint =
    answeredCount < checkpoints.length ? checkpoints[answeredCount] : undefined
  const maxAllowedIndex = pendingCheckpoint ? pendingCheckpoint.afterStep : puzzle.steps.length - 1

  const checkpointIndexAtStep = checkpoints.findIndex((cp) => cp.afterStep === stepIndex)
  const checkpointAtStep =
    checkpointIndexAtStep === -1 ? undefined : checkpoints[checkpointIndexAtStep]
  const isPendingAtStep = checkpointIndexAtStep !== -1 && checkpointIndexAtStep === answeredCount
  const isAnsweredAtStep = checkpointIndexAtStep !== -1 && checkpointIndexAtStep < answeredCount
  const resultAtStep = isAnsweredAtStep ? checkpointResults[checkpointIndexAtStep] : undefined

  const maskedTarget =
    isPendingAtStep && checkpointAtStep?.question === 'var-value'
      ? checkpointAtStep.target
      : undefined
  const maskOutput = isPendingAtStep && checkpointAtStep?.question === 'output'

  const handleAnswer = (result: CheckpointResult) => {
    onCheckpointAnswered(result)
    hapticTick()
  }

  return (
    <div className="trace-runner">
      <p className="trace-runner__prompt">{puzzle.prompt}</p>

      <Scrubber
        snippet={puzzle.snippet}
        language={puzzle.language}
        steps={puzzle.steps}
        stepIndex={stepIndex}
        onScrub={setStepIndex}
        maxAllowedIndex={maxAllowedIndex}
        maskOutput={maskOutput}
        {...(maskedTarget !== undefined ? { maskedTarget } : {})}
      />

      {checkpointAtStep && (
        <CheckpointPanel
          key={checkpointAtStep.afterStep}
          checkpoint={checkpointAtStep}
          steps={puzzle.steps}
          result={resultAtStep}
          onAnswer={handleAnswer}
        />
      )}

      {isComplete && (
        <div
          className={`feedback-panel feedback-panel--${solved ? 'correct' : 'wrong'}`}
          role="status"
        >
          <div className="feedback-panel__header">
            <span className="feedback-panel__icon" aria-hidden="true">
              {solved ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--danger)"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </span>
            <span className="feedback-panel__verdict">
              {solved ? 'Nice — fully traced' : 'Not quite'}
            </span>
            {ratingDelta !== null && (
              <span className="feedback-panel__delta">
                {ratingDelta > 0 ? `+${String(ratingDelta)}` : String(ratingDelta)}
              </span>
            )}
          </div>
          <p className="feedback-panel__explanation">{puzzle.explanation}</p>
          <button type="button" className="feedback-panel__continue" onClick={onContinue}>
            Continue
          </button>
        </div>
      )}
    </div>
  )
}

export function TraceRunner() {
  const session = useTraceSession()

  if (session.status === 'error') {
    return (
      <div className="trace-runner__status">
        <p>We couldn&apos;t load your trace session. Please try again.</p>
        <button type="button" className="trace-runner__link" onClick={session.retryLoad}>
          Try again
        </button>
      </div>
    )
  }

  if (session.status === 'loading' || session.profile === null) {
    return (
      <div className="trace-runner__status">
        <p>Loading your trace session…</p>
      </div>
    )
  }

  if (session.status === 'empty' || session.puzzle === null) {
    return (
      <div className="trace-runner__status">
        <p>No trace puzzles available yet.</p>
      </div>
    )
  }

  return (
    <TraceRunnerPuzzle
      key={session.puzzle.id}
      puzzle={session.puzzle}
      checkpointResults={session.checkpointResults}
      isComplete={session.isComplete}
      solved={session.solved}
      ratingDelta={session.ratingDelta}
      onCheckpointAnswered={session.handleCheckpointAnswered}
      onContinue={session.handleContinue}
    />
  )
}
