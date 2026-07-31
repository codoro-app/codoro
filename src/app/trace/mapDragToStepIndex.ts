/**
 * Pure horizontal-drag-delta -> step-index mapping for the Trace scrub
 * control — the one piece of Scrubber.tsx's drag gesture that is
 * meaningfully unit-testable in isolation from `@use-gesture/react`.
 * Gesture physics itself (the actual `useDrag` binding, momentum, real
 * touch events) cannot be unit-tested; it is only exercised by this
 * function's own tests plus manual verification. Zero DOM/gesture-library
 * dependencies by design, same rationale as gestureThreshold.ts.
 */

export interface MapDragToStepIndexArgs {
  /** The step index the drag gesture started from. */
  readonly startIndex: number
  /** Signed net horizontal displacement (px) since the drag started. */
  readonly deltaPx: number
  /** Pixels of drag distance that correspond to moving exactly one step. */
  readonly pxPerStep: number
  /** Total number of steps in the trace. */
  readonly stepCount: number
  /** The furthest step index the player may currently scrub forward to. */
  readonly maxAllowedIndex: number
}

/**
 * Maps a drag delta to a step index, clamped to
 * `[0, min(stepCount - 1, maxAllowedIndex)]` — the lower bound because
 * there is no step before the first, the upper bound because a step past
 * `maxAllowedIndex` hasn't been reached yet (the next unanswered checkpoint
 * gates how far forward a drag may go, exactly like the prev/next tap
 * targets and arrow keys).
 */
export function mapDragToStepIndex({
  startIndex,
  deltaPx,
  pxPerStep,
  stepCount,
  maxAllowedIndex,
}: MapDragToStepIndexArgs): number {
  if (stepCount <= 0) return 0

  const upperBound = Math.max(0, Math.min(stepCount - 1, maxAllowedIndex))

  // A not-yet-measured (or zero-width) track can't map a pixel delta to a
  // step delta at all; degrade to "no movement" (stay at startIndex,
  // clamped below) rather than dividing by zero.
  const rawIndex = pxPerStep > 0 ? startIndex + deltaPx / pxPerStep : startIndex

  const clamped = Math.min(Math.max(rawIndex, 0), upperBound)
  return Math.round(clamped)
}
