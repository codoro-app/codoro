/**
 * Pure trace-viewing display for Trace (scrubber) mode: a syntax-highlighted
 * code pane with the current step's line highlighted, a live variable
 * panel (first-seen/JSON key order, no sorting — see `ScrubberStepSchema`'s
 * doc comment in src/content/schema.ts, stable since the Phase 2
 * corrective), the current step's output (if any), and a scrub control
 * that lets the player move between steps.
 *
 * This component owns none of the checkpoint-answer lifecycle — it is
 * fully controlled by its caller (`stepIndex`/`onScrub`), and the caller
 * (Task 3) decides how far forward scrubbing is allowed
 * (`maxAllowedIndex`, normally the next unanswered checkpoint's
 * `afterStep`) and which values on the current step, if any, are masked
 * (`maskedVarNames`/`maskOutput` — both absent/empty means "not currently
 * at a checkpoint pause", not "checkpoint pause with nothing masked").
 * `maskedVarNames` is a full *set* of variable row names to mask, not a
 * single target — the Phase 3 corrective's co-valued-row fix: two distinct
 * variables can hold the identical display string (aliasing, or just
 * coincidence), so masking only the checkpoint's own target can leave its
 * answer readable verbatim in a sibling row. This component still owns none
 * of that reasoning — it just paints every row named in the set it's
 * handed; the caller (`TraceRunner.tsx`) is what computes which names
 * belong in it.
 *
 * Scrub interactions:
 *   - A horizontal drag surface (chess.com-analysis-style continuous scrub
 *     — drag distance maps directly to a step position, not discrete
 *     tap-only) built on `@use-gesture/react`'s `useDrag`, `axis: 'x'` +
 *     `axisThreshold: { touch: 20 }` — the same real-hardware fix
 *     `SwipeBinary.tsx` uses (its own doc comment explains the
 *     default-0-tolerance bug this works around); reproduced here as new
 *     code, not imported from that file. `touchAction: 'pan-y'` on the
 *     track keeps vertical page scroll working during a mostly-vertical
 *     touch that hasn't locked to the horizontal axis yet.
 *   - Prev/next tap targets (>= --tap-target-min).
 *   - Arrow-key stepping on the track once it has focus: ArrowLeft/
 *     ArrowRight step by one. (Not ArrowUp/ArrowDown — the scrub axis is
 *     horizontal, matching the drag gesture's own axis, so the horizontal
 *     arrow keys are the more consistent choice.)
 * All three call `onScrub` with a value already clamped to
 * `[0, min(steps.length - 1, maxAllowedIndex)]` — the actual pixel-delta ->
 * step-index math for the drag surface is `mapDragToStepIndex.ts`, a pure
 * function kept independent of the gesture library specifically so it can
 * be unit-tested; the `useDrag` binding itself (gesture physics, momentum,
 * real touch events) cannot be meaningfully unit-tested and is only
 * exercised by that function's tests plus manual verification.
 *
 * Haptics: `hapticTick()` (src/app/practice/haptics.ts) is deliberately NOT
 * called from here. The brief that scopes this component leaves the
 * decision of *when* to fire it (on checkpoint result) to Task 3, which
 * owns the checkpoint-answer lifecycle this component doesn't — wiring a
 * tick to plain step navigation here would fire it on scrubbing alone,
 * which is not what Task 3's "on checkpoint result" trigger means.
 */
import { useMemo, useRef, type KeyboardEvent } from 'react'
import { useDrag } from '@use-gesture/react'
import type { ScrubberPuzzle } from '../../content'
import { highlightSnippet } from '../practice/highlightSnippet'
import { mapDragToStepIndex } from './mapDragToStepIndex'
import '../tokens.css'

/** Rendered in place of a masked variable value or output string. */
const MASK_MARKER = '?'

export interface ScrubberProps {
  /** Puzzle source, passed straight to highlightSnippet (same convention as CodeSnippet's caller). */
  snippet: string
  /** Puzzle source language, passed straight to highlightSnippet. */
  language: string
  steps: ScrubberPuzzle['steps']
  /** The currently displayed step. */
  stepIndex: number
  /** Called with a new, already-clamped step index whenever the player scrubs (drag, arrow keys, prev/next taps). */
  onScrub: (newIndex: number) => void
  /** The furthest step index the player may currently scrub forward to (normally the next unanswered checkpoint's `afterStep`, or `steps.length - 1` once none remain). */
  maxAllowedIndex: number
  /** The full set of variable names in the current step's `vars` to render masked instead of their value. Absent/empty = render every variable normally (not currently at a checkpoint pause). */
  maskedVarNames?: readonly string[]
  /** Render the current step's `output` masked instead of its text. Absent/false = render normally. */
  maskOutput?: boolean
}

export function Scrubber({
  snippet,
  language,
  steps,
  stepIndex,
  onScrub,
  maxAllowedIndex,
  maskedVarNames,
  maskOutput,
}: ScrubberProps) {
  // All hooks are called unconditionally, before the out-of-range guard
  // below — same convention as PuzzleCardShell's own "hooks first, throw
  // after" ordering, so a (should-never-happen) invalid stepIndex can never
  // leave this render having called a different set of hooks than the last
  // successful one.
  const lines = useMemo(() => highlightSnippet(snippet, language), [snippet, language])
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragStartIndexRef = useRef(stepIndex)

  const bind = useDrag(
    ({ first, movement: [mx] }) => {
      if (first) {
        dragStartIndexRef.current = stepIndex
      }
      const trackWidth = trackRef.current?.clientWidth ?? 0
      // One step per ~12% of the track's width, with a sane floor: on a
      // trace with very few steps a whole-track-width-per-step drag would
      // feel unusably heavy, and a not-yet-measured (zero-width, e.g. first
      // paint) track must not divide-by-zero — mapDragToStepIndex already
      // degrades to "no movement" in that case, this floor just keeps the
      // ratio sane once the track does have a real width.
      const pxPerStep = Math.max(trackWidth * 0.12, 24)
      const newIndex = mapDragToStepIndex({
        startIndex: dragStartIndexRef.current,
        deltaPx: mx,
        pxPerStep,
        stepCount: steps.length,
        maxAllowedIndex,
      })
      if (newIndex !== stepIndex) onScrub(newIndex)
    },
    {
      axis: 'x',
      // Same real-hardware fix as SwipeBinary.tsx: @use-gesture/core
      // defaults axisThreshold to { touch: 0 }, so the very first touchmove
      // sample (often slightly more vertical than horizontal from natural
      // finger jitter) can permanently lock the gesture's axis to 'y' and
      // silently drop the whole drag. A few pixels of touch tolerance
      // absorbs that jitter without weakening genuine vertical-scroll
      // detection. See gestureThreshold.ts's axisThreshold comment for the
      // full explanation (not imported from there — this is new code).
      axisThreshold: { touch: 20 },
      // @use-gesture's drag action has its own built-in arrow-key handling
      // (KEYS_DELTA_MAP in DragEngine.ts, on by default) that would
      // otherwise fire this same drag callback on every arrow-key press,
      // fighting the explicit, simpler +/-1-step handleTrackKeyDown below.
      // Turned off here so arrow-key stepping has exactly one code path.
      pointer: { keys: false },
    },
  )

  const step = steps[stepIndex]
  if (!step) {
    throw new Error(
      `Scrubber: stepIndex ${String(stepIndex)} out of range for ${String(steps.length)} steps`,
    )
  }

  const upperBound = Math.max(0, Math.min(steps.length - 1, maxAllowedIndex))
  // Thumb position along the FULL trace (0..steps.length - 1), not just the
  // currently-allowed range — the track shows where this step sits in the
  // whole trace; mapDragToStepIndex (and the prev/next/arrow-key handlers
  // below) are what actually stop a drag from reaching past maxAllowedIndex.
  const progress = steps.length > 1 ? stepIndex / (steps.length - 1) : 0
  const progressPercent = Math.min(100, Math.max(0, progress * 100))

  const handleTrackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const newIndex = Math.max(0, stepIndex - 1)
      if (newIndex !== stepIndex) onScrub(newIndex)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      const newIndex = Math.min(upperBound, stepIndex + 1)
      if (newIndex !== stepIndex) onScrub(newIndex)
    }
  }

  // 2b.0: was `.scrubber__tap-target` (scrubber.css) — `:not(:disabled):hover`
  // needs an arbitrary variant since Tailwind has no canned "not-disabled"
  // combinator.
  const tapTargetClass =
    'shrink-0 w-11 h-11 flex items-center justify-center border border-border-strong rounded-full bg-surface-1 text-text-0 text-xl cursor-pointer disabled:text-text-2 disabled:border-border disabled:cursor-default [&:not(:disabled):hover]:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

  return (
    <div className="flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto">
      <div
        className="bg-surface-code border border-border rounded-md py-2.5 overflow-x-auto font-mono text-sm leading-[1.5]"
        aria-label="Code"
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              i === step.line
                ? 'scrubber__code-line--current flex items-center gap-3 w-full py-px px-4 whitespace-pre bg-accent-dim-2 shadow-[inset_2px_0_0_var(--accent)]'
                : 'flex items-center gap-3 w-full py-px px-4 whitespace-pre'
            }
          >
            <span
              className="min-w-6 shrink-0 text-right text-text-2 select-none"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span
              className="whitespace-pre"
              dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }}
            />
          </div>
        ))}
      </div>

      <dl
        className="flex flex-col gap-1 m-0 p-3 bg-surface-1 border border-border rounded-md"
        aria-label="Variables"
      >
        {Object.entries(step.vars).map(([name, value]) => (
          <div
            className="scrubber__vars-row flex items-baseline gap-2 font-mono text-base"
            key={name}
          >
            <dt className="scrubber__vars-name m-0 text-text-1">{name}</dt>
            <dd className="scrubber__vars-value m-0 text-text-0 font-medium">
              {maskedVarNames?.includes(name) ? MASK_MARKER : value}
            </dd>
          </div>
        ))}
      </dl>

      {step.output !== undefined && (
        <p className="m-0 py-2.5 px-3 bg-surface-1 border border-border rounded-md text-sm">
          <span className="text-text-1">Output since previous step:</span>{' '}
          <span className="scrubber__output-value text-text-0 font-mono">
            {maskOutput ? MASK_MARKER : step.output}
          </span>
        </p>
      )}

      <div className="flex items-center gap-3 pl-[max(var(--space-2),env(safe-area-inset-left))] pr-[max(var(--space-2),env(safe-area-inset-right))]">
        <button
          type="button"
          className={tapTargetClass}
          aria-label="Previous step"
          disabled={stepIndex <= 0}
          onClick={() => {
            onScrub(Math.max(0, stepIndex - 1))
          }}
        >
          &#8249;
        </button>

        <div
          ref={trackRef}
          className="relative flex-1 h-11 flex items-center cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 focus-visible:rounded-full before:content-[''] before:absolute before:inset-x-0 before:h-1 before:rounded-full before:bg-surface-2"
          role="slider"
          tabIndex={0}
          aria-label="Step"
          aria-valuemin={0}
          aria-valuemax={upperBound}
          aria-valuenow={stepIndex}
          aria-valuetext={`Step ${String(stepIndex + 1)} of ${String(steps.length)}`}
          onKeyDown={handleTrackKeyDown}
          style={{ touchAction: 'pan-y' }}
          {...bind()}
        >
          <div
            className="absolute left-0 h-1 rounded-full bg-accent-dim pointer-events-none"
            style={{ width: `${String(progressPercent)}%` }}
          />
          <div
            className="absolute w-4 h-4 rounded-full bg-accent -translate-x-1/2 pointer-events-none transition-[left] duration-[120ms] [transition-timing-function:ease]"
            style={{ left: `${String(progressPercent)}%` }}
          />
        </div>

        <button
          type="button"
          className={tapTargetClass}
          aria-label="Next step"
          disabled={stepIndex >= upperBound}
          onClick={() => {
            onScrub(Math.min(upperBound, stepIndex + 1))
          }}
        >
          &#8250;
        </button>
      </div>
    </div>
  )
}
