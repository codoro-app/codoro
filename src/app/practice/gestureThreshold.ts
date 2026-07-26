/**
 * Pure gesture-threshold math for `SwipeBinary`'s drag interaction. Zero
 * React/DOM dependencies by design — this is a correctness-critical piece
 * (committing an answer fires a rating update), not polish, so it must be
 * fully unit-testable in isolation from any gesture library or component.
 *
 * Locked semantics: a drag commits only when BOTH a minimum horizontal
 * distance AND a minimum horizontal velocity are exceeded, in the same
 * direction. Neither condition alone is sufficient:
 *   - Distance-only would let a slow, incomplete drag "cross the finish
 *     line" by accident during idle finger movement (a lazy half-drag that
 *     happens to end past the line while the finger is still just resting
 *     there).
 *   - Velocity-only would let a brief, high-velocity accidental flick (a
 *     stray touch-drag of a few pixels) commit an answer — this is exactly
 *     the failure mode the spec calls out by name.
 * The two signals must also agree on direction: a sample whose displacement
 * and velocity point opposite ways (e.g. a fast snap-back at the tail end
 * of a gesture) does not commit in either direction.
 */

/** Threshold configuration a drag sample is checked against. */
export interface SwipeThresholdConfig {
  /** Minimum |dx| in px to count as a real drag. */
  readonly minDistance: number
  /** Minimum |velocity| in px/ms to count as deliberate. */
  readonly minVelocity: number
}

/**
 * What a drag gesture library naturally reports at drag-end: net horizontal
 * offset and instantaneous horizontal velocity, both signed so their sign
 * carries direction (negative = left, positive = right).
 */
export interface SwipeSample {
  readonly dx: number
  readonly velocityX: number
}

export type SwipeCommitDirection = 'left' | 'right' | null

/**
 * Default thresholds, chosen for a practice card ~300-400px wide on a phone
 * screen (see `practice.css`'s `.puzzle-card { max-width: 480px }`, and
 * that real phone viewports below that are typically 340-390px wide):
 *
 * - `minDistance: 120` — roughly 30-35% of a ~340-390px-wide card. Below
 *   the 30-50%-of-container-width range many swipe-to-dismiss UIs use as a
 *   starting point, but toward the low end of it deliberately: swipe-binary
 *   cards are answered dozens of times per session, so the gesture should
 *   feel light rather than requiring a near-full-width drag every time,
 *   while still being far enough past accidental-scroll/mis-tap noise
 *   (usually well under 20px) to be an unambiguous "the user meant this".
 * - `minVelocity: 0.3` px/ms — inside the 0.2-0.5 px/ms range cited as a
 *   starting point. A deliberate swipe that covers `minDistance` (120px)
 *   in a natural, unhurried ~300-400ms already produces ~0.3-0.4 px/ms, so
 *   this floor sits right at what a normal complete drag produces rather
 *   than demanding a rushed flick — while still being well above the
 *   near-zero velocity of a finger that's resting/creeping (idle drift is
 *   typically under 0.05 px/ms).
 *
 * Both conditions must hold simultaneously (see module doc), so these two
 * numbers work together: `minDistance` alone rules out mis-taps and short
 * jitters, `minVelocity` alone rules out slow idle drift, and requiring
 * both is what specifically rules out the short-but-fast accidental flick
 * that either threshold alone would miss.
 */
export const DEFAULT_SWIPE_THRESHOLD: SwipeThresholdConfig = {
  minDistance: 120,
  minVelocity: 0.3,
}

/**
 * Resolves a completed drag sample to a commit direction, or `null` if the
 * drag does not meet the locked "distance AND velocity, same direction"
 * bar.
 *
 * Boundary values count as meeting the threshold: comparisons use `>=`
 * (i.e. a sample landing exactly on `minDistance`/`minVelocity` commits),
 * applied consistently to both distance and velocity.
 */
export function resolveSwipeCommit(
  sample: SwipeSample,
  config: SwipeThresholdConfig,
): SwipeCommitDirection {
  const { dx, velocityX } = sample
  const { minDistance, minVelocity } = config

  if (Math.abs(dx) < minDistance) return null
  if (Math.abs(velocityX) < minVelocity) return null

  const distanceDirection: 'left' | 'right' = dx > 0 ? 'right' : 'left'
  const velocityDirection: 'left' | 'right' = velocityX > 0 ? 'right' : 'left'

  if (distanceDirection !== velocityDirection) return null

  return distanceDirection
}

/**
 * Raw per-axis gesture totals as reported by `@use-gesture/react`'s
 * `useDrag` callback across the WHOLE gesture, not any single frame:
 * `movement` is signed net displacement (px) since the drag started,
 * `elapsedTime` is milliseconds since the drag started.
 */
export interface RawDragGesture {
  readonly movement: number
  readonly elapsedTime: number
}

/**
 * Derives a signed velocity (px/ms, sign matching `movement`'s) averaged
 * over the ENTIRE gesture, instead of trusting `@use-gesture`'s own
 * final-frame `velocity`/`direction` state the way `SwipeBinary.tsx` used to
 * (`vx * dirX`, where `vx` and `dirX` came straight from the drag-end
 * callback).
 *
 * That approach inherited a real bug in `@use-gesture/core` (v10.3.1,
 * confirmed by reading its source): the library only recomputes
 * `direction`/`velocity` on the gesture's last frame when the gap since the
 * previous frame exceeds an internal 32ms threshold
 * (`BEFORE_LAST_KINEMATICS_DELAY`). A real finger naturally slows down —
 * often to a dead stop — for a beat before lifting off the screen, which is
 * exactly the >32ms-gap case. When that happens, `@use-gesture` recomputes
 * `direction`/`velocity` from the movement delta SINCE THE PAUSE STARTED,
 * not from the whole gesture: if the finger was genuinely still during that
 * pause, that delta is ~0, so both `direction` (sign) and `velocity`
 * (magnitude) collapse toward zero — regardless of how far or fast the drag
 * traveled overall. Multiplying those two together doesn't fail gracefully;
 * it reproduces the same collapse. The observable symptom is "my swipe did
 * nothing and I had to tap the button" on a real phone, since a deliberate,
 * full-distance, fast swipe that happens to settle for >32ms before release
 * (common — most people ease into letting go) silently fails
 * `resolveSwipeCommit`'s velocity check.
 *
 * Averaging over the gesture's own `movement`/`elapsedTime` (both tracked
 * from drag-start, immune to any single frame's timing) sidesteps that
 * staleness window entirely rather than special-casing it.
 */
export function signedVelocityFromGesture({ movement, elapsedTime }: RawDragGesture): number {
  if (elapsedTime <= 0) return 0
  return movement / elapsedTime
}
