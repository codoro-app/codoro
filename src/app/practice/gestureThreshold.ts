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
