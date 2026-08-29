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
import { StreakPause } from '../StreakPause'
import { useMediaQuery } from '../useMediaQuery'
import { RouteSkeleton } from '../RouteSkeleton'
import '../tokens.css'

// 2b.0: was `.feedback-panel--correct`/`--wrong` + descendant color
// overrides (tokens.css) — same helpers as PuzzleCardShell.tsx (duplicated,
// not extracted — no shared module for this exists, matching this file's
// own established convention of duplicating rather than cross-importing
// route-chunk-specific styling).
const FEEDBACK_BASE = 'feedback-panel flex flex-col gap-3 p-4 rounded-xl border-[1.5px]'
function feedbackPanelClass(correct: boolean): string {
  return correct
    ? `${FEEDBACK_BASE} border-accent [background:linear-gradient(160deg,var(--ok-dim),var(--surface-1))]`
    : `${FEEDBACK_BASE} border-danger [background:linear-gradient(160deg,var(--danger-dim),var(--surface-1))]`
}
function feedbackAccentClass(correct: boolean): string {
  return correct ? 'text-accent' : 'text-danger'
}
const FEEDBACK_CONTINUE_CLASS =
  'flex items-center justify-center gap-2 min-h-11 w-full py-3.5 px-4 border-0 rounded-md bg-accent text-accent-ink text-base font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

// 2b.9 (feedback-fit bug, 2026-08-21): same shape as PuzzleCardShell.tsx's
// own FEEDBACK_DRAWER_CLASS (duplicated, not imported — matches this file's
// own established convention of duplicating rather than cross-importing
// route-chunk-specific styling, per its module doc comment). Result +
// explanation + Continue are one pinned drawer instead of a normal-flow
// panel plus a separate sticky button-only bar — see PuzzleCardShell.tsx's
// identical constant for the full rationale (duplicated, same convention as
// above). Bottom offset stays flush `bottom-0` here (not
// `bottom-[var(--bottom-nav-height)]`) — unchanged from this constant's
// pre-existing value, out of scope for this pass.
const FEEDBACK_DRAWER_CLASS = 'sticky bottom-0 z-10 bg-surface-0 border-t border-border'

// See PuzzleCardShell.tsx's identical `drawerPanelClass` for why the panel
// is height-capped with only its explanation paragraph scrolling.
function drawerPanelClass(correct: boolean): string {
  return `${feedbackPanelClass(correct)} min-h-[128px] max-h-[46dvh]`
}

// Desktop's inline placement — see PuzzleCardShell.tsx's identical constant.
const DESKTOP_CONTINUE_CLASS =
  'flex items-center justify-center gap-2 min-h-11 py-3 px-6 border-0 rounded-md bg-accent text-accent-ink text-base font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

/** Trace's Continue always means "next puzzle" — Trace has no native end (docs/design/click-meaningfulness.md §3), so unlike PuzzleCardShell's Rush/Boss callers this never branches to a "results" preview. */
function ContinueIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

/** The Continue button itself — shared by both of its placements below, same reasoning as PuzzleCardShell.tsx's identical ContinueCta. */
function ContinueCta({
  className,
  onContinue,
  label,
}: {
  className: string
  onContinue: () => void
  label: string
}) {
  return (
    <button type="button" className={className} onClick={onContinue}>
      {label}
      <ContinueIcon />
    </button>
  )
}

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

/** A character that can appear inside an identifier/number/string-literal token. */
const TOKEN_CHAR = /[A-Za-z0-9_]/

/**
 * OD-4 (docs/v2-build-plan.md, "Known open defects"): a currently-visible
 * cell's value leaks a checkpoint's answer not just when it *equals* the
 * answer (the OD-3 co-valued-cell case), but also when it appears as a
 * whole token *inside* a compound answer — e.g. an `output` checkpoint
 * whose answer is a printed line like `"initial window sum:" 9` embeds the
 * bare value `9`, which a visible `windowSum` row showing `"9"` reveals
 * just as surely as an exact match would, even though `"9" !== '"initial
 * window sum:" 9'`. Same shape for a `var-value` checkpoint whose answer is
 * itself a compound value, e.g. an array `[6, 14]` embedding a sibling
 * row's bare `"6"`.
 *
 * Deliberately a *token*-boundary match, not a raw substring search: a raw
 * `answer.includes(value)` also fires on coincidental digit overlap that
 * isn't a real leak at all (a `"0"` cell reads as contained in an unrelated
 * answer `"40"` merely because they share a trailing digit, not because the
 * `0` is legible as the value `40`). Requiring the match not be glued to
 * another identifier/number/string character on either side is what tells
 * a genuinely embedded value apart from that kind of noise — confirmed
 * empirically via a full-pool sweep (Phase 8) before this landed: raw
 * substring matching over-fires on dozens of additional cases the
 * token-boundary version correctly excludes.
 */
function valueLeaksAnswer(value: string | undefined, answerValue: string | undefined): boolean {
  if (value === undefined || answerValue === undefined || value.length === 0) return false
  if (value === answerValue) return true
  let from = 0
  for (;;) {
    const idx = answerValue.indexOf(value, from)
    if (idx === -1) return false
    const before = answerValue.charAt(idx - 1)
    const after = answerValue.charAt(idx + value.length)
    if (!TOKEN_CHAR.test(before) && !TOKEN_CHAR.test(after)) return true
    from = idx + 1
  }
}

export interface TraceRunnerPuzzleProps {
  puzzle: ScrubberPuzzle
  checkpointResults: readonly CheckpointResult[]
  isComplete: boolean
  solved: boolean | null
  ratingDelta: number | null
  onCheckpointAnswered: (result: CheckpointResult) => void
  onContinue: () => void
  /**
   * Whether the per-checkpoint clock runs at all. Defaults to `true`, but
   * every real call site now passes `false` explicitly: `/puzzle/:id` and
   * `/challenge` (5b decision 7 — a stranger on a link they didn't choose,
   * unrated, shouldn't also be timed), and `/trace` itself since Phase 7
   * (reversing 5b decision 7's "real Trace mode is timed" by direct user
   * preference — scrubbing is Trace's core interaction, and a clock
   * discourages exactly that). The clock (`TRACE_CHECKPOINT_TIME_LIMIT_MS`)
   * and this whole timed path stay live and tested for future consumers
   * (Phase 6b's boss run, 6c's speed round) — see docs/v2-build-plan.md's
   * Phase 7 amendment.
   */
  timed?: boolean
  /**
   * Label for the Continue button. Defaults to `'Next puzzle'` (this
   * component's original, and still correct, behavior for every existing
   * call site — /trace, /puzzle/:id, /challenge, and the Missions trace
   * stage all genuinely advance to a different puzzle on Continue). Daily
   * (fix-wave, v4 Phase 4.3 final review finding I4) is the one exception:
   * it serves exactly one puzzle per day, so its scrubber-day Continue is
   * actually a retry, not an advance — Daily passes `continueLabel="Try
   * again"` to match `PuzzleCardShell`'s own retry-destination label.
   */
  continueLabel?: string
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
  continueLabel = 'Next puzzle',
}: TraceRunnerPuzzleProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [remainingMs, setRemainingMs] = useState(TRACE_CHECKPOINT_TIME_LIMIT_MS)
  // Continue-button placement switch — see PuzzleCardShell.tsx's identical
  // `isDesktop` for the full rationale.
  const isDesktop = useMediaQuery('(min-width: 1024px)')

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
    let answerValue: string | undefined
    if (pendingCheckpoint.question === 'var-value' && pendingCheckpoint.target && answerStep) {
      answerValue = answerStep.vars[pendingCheckpoint.target]
    } else if (pendingCheckpoint.question === 'output' && answerStep) {
      answerValue = answerStep.output
    }
    // Both branches above resolve to the same downstream check — a cell
    // leaks whether it's the target of a var-value checkpoint or the whole
    // line of an output checkpoint, equality and token-containment apply
    // identically either way (valueLeaksAnswer's own doc comment).
    if (answerValue !== undefined) {
      maskedVarNames = step
        ? Object.keys(step.vars).filter((name) => valueLeaksAnswer(step.vars[name], answerValue))
        : undefined
      maskOutput = valueLeaksAnswer(step?.output, answerValue)
    }
  }

  const handleAnswer = (result: CheckpointResult) => {
    onCheckpointAnswered(result)
    hapticTick()
  }

  return (
    <>
      <div className="trace-runner flex flex-col gap-4">
        <p className="m-0 text-text-0 text-md font-semibold">{puzzle.prompt}</p>

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
              <p className="m-0 self-end font-mono text-sm text-text-1" aria-hidden="true">
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

        {isComplete && isDesktop && (
          <>
            <div className="flex justify-end">
              <ContinueCta
                className={DESKTOP_CONTINUE_CLASS}
                onContinue={onContinue}
                label={continueLabel}
              />
            </div>
            <div className={feedbackPanelClass(solved ?? false)} role="status">
              <div className="flex items-center gap-2">
                <span
                  className={`flex items-center ${feedbackAccentClass(solved ?? false)}`}
                  aria-hidden="true"
                >
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
                <span
                  className={`flex-1 font-bold text-base ${feedbackAccentClass(solved ?? false)}`}
                >
                  {solved ? 'Nice — fully traced' : 'Not quite'}
                </span>
                {ratingDelta !== null && (
                  <span
                    className={`feedback-panel__delta font-mono font-bold tabular-nums ${feedbackAccentClass(solved ?? false)}`}
                  >
                    {ratingDelta > 0 ? `+${String(ratingDelta)}` : String(ratingDelta)}
                  </span>
                )}
              </div>
              <p className="m-0 text-text-0 text-[0.9375rem] leading-[1.45]">
                {puzzle.explanation}
              </p>
            </div>
          </>
        )}
      </div>

      {isComplete && !isDesktop && (
        <div className={FEEDBACK_DRAWER_CLASS}>
          <div className="w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto px-4 py-3">
            <div className={drawerPanelClass(solved ?? false)} role="status">
              <div className="flex items-center gap-2 flex-none">
                <span
                  className={`flex items-center ${feedbackAccentClass(solved ?? false)}`}
                  aria-hidden="true"
                >
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
                <span
                  className={`flex-1 font-bold text-base ${feedbackAccentClass(solved ?? false)}`}
                >
                  {solved ? 'Nice — fully traced' : 'Not quite'}
                </span>
                {ratingDelta !== null && (
                  <span
                    className={`feedback-panel__delta font-mono font-bold tabular-nums ${feedbackAccentClass(solved ?? false)}`}
                  >
                    {ratingDelta > 0 ? `+${String(ratingDelta)}` : String(ratingDelta)}
                  </span>
                )}
              </div>
              {/* flex-1 min-h-0 lets this shrink and scroll inside the
                  panel's flex column instead of forcing the panel past its
                  max-height cap — see drawerPanelClass's doc comment. */}
              <p
                className="m-0 flex-1 min-h-0 overflow-y-auto text-text-0 text-[0.9375rem] leading-[1.45]"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {puzzle.explanation}
              </p>
              <ContinueCta
                className={`${FEEDBACK_CONTINUE_CLASS} flex-none`}
                onContinue={onContinue}
                label={continueLabel}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export interface TraceRunnerProps {
  /**
   * Forwarded to the inner `TraceRunnerPuzzle` — see its own doc comment.
   * Defaults to `true`; `/trace` (`TracePage.tsx`) is the one caller of
   * this outer component and passes `false` explicitly (Phase 7).
   */
  timed?: boolean
}

export function TraceRunner({ timed = true }: TraceRunnerProps = {}) {
  const session = useTraceSession()

  if (session.status === 'error') {
    return (
      <div className="text-center text-text-1 py-8">
        <p>We couldn&apos;t load your trace session. Please try again.</p>
        <button
          type="button"
          className="min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer"
          onClick={session.retryLoad}
        >
          Try again
        </button>
      </div>
    )
  }

  // True cold boot only — see usePracticeSession.ts's identical branch/
  // RouteSkeleton reasoning; useTraceSession.ts mirrors it exactly.
  if (session.status === 'loading' || session.profile === null) {
    return <RouteSkeleton />
  }

  if (session.status === 'empty' || session.puzzle === null) {
    return (
      <div className="text-center text-text-1 py-8">
        <p>No trace puzzles available yet.</p>
      </div>
    )
  }

  return (
    <>
      {session.streakPause && (
        <StreakPause
          streak={session.streakPause.streak}
          isNewBest={session.streakPause.isNewBest}
          onKeepGoing={session.handleStreakPauseKeepGoing}
          onDoneForNow={session.handleStreakPauseDoneForNow}
        />
      )}
      <TraceRunnerPuzzle
        key={session.puzzle.id}
        puzzle={session.puzzle}
        checkpointResults={session.checkpointResults}
        isComplete={session.isComplete}
        solved={session.solved}
        ratingDelta={session.ratingDelta}
        onCheckpointAnswered={session.handleCheckpointAnswered}
        onContinue={session.handleContinue}
        timed={timed}
      />
    </>
  )
}
