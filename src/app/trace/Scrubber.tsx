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
 * `afterStep`) and which single value on the current step, if any, is
 * masked (`maskedTarget`/`maskOutput` — both absent means "not currently
 * at a checkpoint pause", not "checkpoint pause with nothing masked").
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
import './scrubber.css'

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
  /** A variable name in the current step's `vars` to render masked instead of its value. Absent = render every variable normally (not currently at a checkpoint pause). */
  maskedTarget?: string
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
  maskedTarget,
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

  return (
    <div className="scrubber">
      <div className="scrubber__code" aria-label="Code">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              i === step.line
                ? 'scrubber__code-line scrubber__code-line--current'
                : 'scrubber__code-line'
            }
          >
            <span className="scrubber__code-line-number" aria-hidden="true">
              {i + 1}
            </span>
            <span
              className="scrubber__code-line-code"
              dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }}
            />
          </div>
        ))}
      </div>

      <dl className="scrubber__vars" aria-label="Variables">
        {Object.entries(step.vars).map(([name, value]) => (
          <div className="scrubber__vars-row" key={name}>
            <dt className="scrubber__vars-name">{name}</dt>
            <dd className="scrubber__vars-value">{name === maskedTarget ? MASK_MARKER : value}</dd>
          </div>
        ))}
      </dl>

      {step.output !== undefined && (
        <p className="scrubber__output">
          <span className="scrubber__output-label">Output since previous step:</span>{' '}
          <span className="scrubber__output-value">{maskOutput ? MASK_MARKER : step.output}</span>
        </p>
      )}

      <div className="scrubber__transport">
        <button
          type="button"
          className="scrubber__tap-target"
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
          className="scrubber__track"
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
          <div className="scrubber__track-fill" style={{ width: `${String(progressPercent)}%` }} />
          <div className="scrubber__track-thumb" style={{ left: `${String(progressPercent)}%` }} />
        </div>

        <button
          type="button"
          className="scrubber__tap-target"
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
