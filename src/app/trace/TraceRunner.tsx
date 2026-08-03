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
 * Masking a pending checkpoint is not just "mask the target row at the exact
 * pause step": backward scrubbing is unbounded (OD-3, docs/v2-build-plan.md)
 * — a player can always tap "Previous step" back toward step 0 — so the
 * answer value must stay masked at *every* step the player can currently
 * reach, not just the one where the checkpoint's `afterStep` happens to sit.
 * Confirmed live on `tc-009`: checkpoint 1's answer ("3") sits unmasked in
 * sibling row `v` as early as step 12, four steps before its `afterStep`
 * (16) pause — a "mask one step back" rule would still miss it.
 *
 * The fix: compute the pending checkpoint's *answer value* once, by reading
 * `puzzle.steps[pendingCheckpoint.afterStep]` directly (not the currently
 * displayed step) — for `var-value` that's the target's value at the pause
 * step, for `output` it's the pause step's `output` string. Then, for
 * whichever step is *actually* on screen right now (`stepIndex`, which can
 * be anywhere in `[0, pendingCheckpoint.afterStep]` since forward scrubbing
 * is already capped there), mask every cell — variable row or output line —
 * whose value equals that answer value. This is deliberately narrow, per
 * the locked decision: it masks the specific co-valued *cells* wherever
 * they recur across the reachable range, not whole rows and not whole
 * steps, so a player scrubbing backward to re-read unrelated state can
 * still do so. It also subsumes the Phase 3 corrective's co-valued-row fix
 * (Finding 2) as the special case `stepIndex === pendingCheckpoint.afterStep`,
 * so that fix's own behavior at the exact pause is unchanged, not
 * superseded by a second mechanism.
 *
 * First-try-only scoring: `CheckpointPanel` commits a choice immediately —
 * there is no retry UI, matching `scoreScrubberAttempt`'s "each checkpoint
 * accepts exactly one answer" contract that `useTraceSession.
 * handleCheckpointAnswered` already enforces server-side (no-ops once the
 * puzzle is complete). See CheckpointPanel.tsx's doc comment for how the
 * choice list itself makes re-answering unreachable, not just disabled.
 *
 * Per-checkpoint clock (Phase 5b Item 6, decision 7) lives here, not in
 * useTraceSession — the session hook has no concept of `stepIndex` (that's
 * purely local UI state, below), and "is a checkpoint on screen and
 * unanswered right now" is a `stepIndex`-dependent question the hook
 * structurally can't answer. `src/engine/` still stays untouched either
 * way. The clock runs only while `checkpointAtStep` is the pending
 * (unanswered) checkpoint — scrubbing away to an earlier step, or back to
 * an already-answered one, pauses it; scrubbing back to the SAME still-
 * pending checkpoint resumes from wherever it was, rather than granting a
 * fresh 30s (a reset-on-return would let a player about to time out just
 * scrub away and back for a free extension). A checkpoint timeout produces
 * `{ correct: false, choiceIndex: null }` — the exact CheckpointResult
 * shape a real answer produces, no third state (decision 7's explicit
 * requirement) — via `onCheckpointAnswered` directly, not through
 * CheckpointPanel (which only ever fires from a real tap).
 */
import { useEffect, useRef, useState } from 'react'
import { Scrubber } from './Scrubber'
import { CheckpointPanel } from './CheckpointPanel'
import { useTraceSession } from './useTraceSession'
import { hapticTick } from '../practice/haptics'
import type { CheckpointResult } from '../../engine'
import type { ScrubberPuzzle } from '../../content'
import '../tokens.css'
import './scrubber.css'

/**
 * Untuned — no production telemetry has ever fired (docs/v2-backlog.md), so
 * there's no attempt-duration distribution to size this against. Per
 * checkpoint, not per puzzle (decision 7): a whole-puzzle budget would
 * punish a player for using Trace's own core interaction (scrubbing), and
 * one number can't serve both a 3-checkpoint and a 4-checkpoint puzzle
 * fairly. Play-test and adjust.
 */
export const TRACE_CHECKPOINT_TIME_LIMIT_MS = 30_000

/** How often the on-screen countdown updates — render smoothness only, unrelated to TRACE_CHECKPOINT_TIME_LIMIT_MS's own tuning. */
const TRACE_TIMER_TICK_MS = 100

export interface TraceRunnerPuzzleProps {
  puzzle: ScrubberPuzzle
  checkpointResults: readonly CheckpointResult[]
  isComplete: boolean
  solved: boolean | null
  ratingDelta: number | null
  onCheckpointAnswered: (result: CheckpointResult) => void
  onContinue: () => void
  /**
   * Whether the per-checkpoint clock runs at all. Defaults to true (real
   * Trace mode); `/puzzle/:id` passes `false` — decision 7's explicit call
   * that a stranger following a shared link cold, on a puzzle they didn't
   * choose, unrated, shouldn't also be timed.
   */
  timed?: boolean
}

export function TraceRunnerPuzzle({
  puzzle,
  checkpointResults,
  isComplete,
  solved,
  ratingDelta,
  onCheckpointAnswered,
  onContinue,
  timed = true,
}: TraceRunnerPuzzleProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [remainingMs, setRemainingMs] = useState(TRACE_CHECKPOINT_TIME_LIMIT_MS)

  const checkpoints = puzzle.checkpoints
  const answeredCount = checkpointResults.length
  const pendingCheckpoint =
    answeredCount < checkpoints.length ? checkpoints[answeredCount] : undefined
  const maxAllowedIndex = pendingCheckpoint ? pendingCheckpoint.afterStep : puzzle.steps.length - 1

  const checkpointIndexAtStep = checkpoints.findIndex((cp) => cp.afterStep === stepIndex)
  const checkpointAtStep =
    checkpointIndexAtStep === -1 ? undefined : checkpoints[checkpointIndexAtStep]
  const isAnsweredAtStep = checkpointIndexAtStep !== -1 && checkpointIndexAtStep < answeredCount
  const resultAtStep = isAnsweredAtStep ? checkpointResults[checkpointIndexAtStep] : undefined

  // The clock is "live" only while the pending (unanswered) checkpoint is
  // the one actually on screen right now — see this file's own doc comment.
  const pendingActive = timed && checkpointAtStep !== undefined && resultAtStep === undefined

  const activeCheckpointKeyRef = useRef<number | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const deadlineRef = useRef(0)
  const answeredRef = useRef(false)

  useEffect(() => {
    // TS narrows checkpointAtStep as defined below via pendingActive's own
    // definition (`timed && checkpointAtStep !== undefined && ...`) — an
    // aliased-condition narrow, not a second explicit undefined check.
    if (!pendingActive) {
      // Scrubbed away from the pending checkpoint (or nothing pending) —
      // if a clock was running, mark the moment it paused so a later
      // return to the SAME checkpoint can push the deadline forward by
      // exactly how long we were away, not lose that time twice.
      if (activeCheckpointKeyRef.current !== null && pausedAtRef.current === null) {
        pausedAtRef.current = Date.now()
      }
      return
    }

    const key = checkpointAtStep.afterStep
    if (activeCheckpointKeyRef.current !== key) {
      // A genuinely new checkpoint became pending — fresh clock.
      activeCheckpointKeyRef.current = key
      deadlineRef.current = Date.now() + TRACE_CHECKPOINT_TIME_LIMIT_MS
      pausedAtRef.current = null
    } else if (pausedAtRef.current !== null) {
      // Resuming the SAME checkpoint after scrubbing away and back.
      deadlineRef.current += Date.now() - pausedAtRef.current
      pausedAtRef.current = null
    }

    answeredRef.current = false
    setRemainingMs(Math.max(0, deadlineRef.current - Date.now()))

    const interval = setInterval(() => {
      if (answeredRef.current) return
      // See useRushSession.ts's identical guard: a backgrounded tab isn't
      // guaranteed to have its intervals throttled/paused by the browser,
      // so this can't rely on that to keep the clock from expiring on
      // ticks that fire anyway. The separate visibilitychange effect below
      // pushes the deadline forward once the tab becomes visible again.
      if (document.hidden) return
      const left = Math.max(0, deadlineRef.current - Date.now())
      setRemainingMs(left)
      if (left <= 0) {
        answeredRef.current = true
        onCheckpointAnswered({ correct: false, choiceIndex: null })
      }
    }, TRACE_TIMER_TICK_MS)

    return () => {
      clearInterval(interval)
    }
    // checkpointAtStep is read only for its own .afterStep (a primitive);
    // depending on the primitive rather than the object avoids re-running
    // this effect on every render when the object reference changes but
    // afterStep doesn't.
  }, [pendingActive, checkpointAtStep?.afterStep, onCheckpointAnswered])

  // A backgrounded tab must not silently drain the clock (decision 6) —
  // pushes the deadline forward by however long the tab was hidden, same
  // technique useRushSession.ts uses for its own per-puzzle clock.
  useEffect(() => {
    let hiddenAt: number | null = null
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
      } else if (hiddenAt !== null) {
        deadlineRef.current += Date.now() - hiddenAt
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const step = puzzle.steps[stepIndex]

  // Answer value is read from the checkpoint's own pause step
  // (pendingCheckpoint.afterStep), never from `step` (the currently
  // displayed step) — those coincide only when stepIndex === afterStep.
  // Forward scrubbing is already capped at maxAllowedIndex === afterStep,
  // so stepIndex is always <= afterStep whenever pendingCheckpoint exists;
  // the explicit comparison below is a defensive match to that invariant,
  // not a range restriction of its own.
  let maskedVarNames: readonly string[] | undefined
  let maskOutput = false
  if (pendingCheckpoint && stepIndex <= pendingCheckpoint.afterStep) {
    const answerStep = puzzle.steps[pendingCheckpoint.afterStep]
    if (pendingCheckpoint.question === 'var-value' && pendingCheckpoint.target && answerStep) {
      const answerValue = answerStep.vars[pendingCheckpoint.target]
      maskedVarNames = step
        ? Object.keys(step.vars).filter((name) => step.vars[name] === answerValue)
        : undefined
      // Symmetric with the output-checkpoint branch below: if this step's
      // output happens to equal the target's answer value, that value
      // would otherwise sit unmasked in the output line even though
      // maskedVarNames already hides every co-valued *variable* row.
      maskOutput = step?.output === answerValue
    } else if (pendingCheckpoint.question === 'output' && answerStep) {
      const answerValue = answerStep.output
      maskOutput = step?.output === answerValue
      maskedVarNames =
        answerValue !== undefined && step
          ? Object.keys(step.vars).filter((name) => step.vars[name] === answerValue)
          : []
    }
  }

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
        {...(maskedVarNames !== undefined ? { maskedVarNames } : {})}
      />

      {checkpointAtStep && (
        <>
          {pendingActive && (
            // No aria-live role: a countdown ticking every
            // TRACE_TIMER_TICK_MS would spam a screen reader with constant
            // announcements — a purely visual supplement, not the kind of
            // status change that needs narrating.
            <p className="checkpoint-timer" aria-hidden="true">
              {Math.ceil(remainingMs / 1000)}s
            </p>
          )}
          <CheckpointPanel
            key={checkpointAtStep.afterStep}
            checkpoint={checkpointAtStep}
            steps={puzzle.steps}
            result={resultAtStep}
            onAnswer={handleAnswer}
          />
        </>
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
