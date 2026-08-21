/**
 * Pure gesture-threshold math for `SwipeBinary`'s drag interaction. Zero
 * React/DOM dependencies by design — this is a correctness-critical piece
 * (committing an answer fires a rating update), not polish, so it must be
 * fully unit-testable in isolation from any gesture library or component.
 *
 * ## Commit rule (revised 2026-08-21, OD-6 — see docs/od-6-swipe-capture-2026-08-21.md)
 *
 * A drag commits when EITHER of two independent conditions holds:
 *
 *   1. **Distance.** `|dx| >= commitDistance` — a deliberate, full-length drag
 *      commits at any pace. No speed requirement at all.
 *   2. **Flick.** `|dx| >= flickDistance` AND `|velocityX| >= flickVelocity`
 *      AND both point the same way — a short, fast throw commits early,
 *      before it has travelled the full distance.
 *
 * This replaces the previous locked semantics ("distance AND velocity, same
 * direction"), which a captured reproduction proved was rejecting the single
 * most common real gesture. The old rule's `velocityX` was an average over
 * the WHOLE gesture, which made `minVelocity` not a speed floor but a hard
 * **ceiling on how long a drag was allowed to take**: `|dx| / minVelocity`
 * ms, total. At the shipped `minVelocity: 0.08`, a 120px drag had to finish
 * within 1500ms. The capture (2026-08-21, production, desktop Chrome) shows a
 * clean 160px drag released at 2558ms — axis resolved horizontal, card
 * tracking the finger the whole way to 153px, `preventDefault()` succeeding
 * on every event, `touchend` arriving normally — silently not committing.
 *
 * The AND rule's stated justification was blocking "a brief, high-velocity
 * accidental flick (a stray touch-drag of a few pixels)". That case is
 * already excluded by the distance floor — a few-pixel flick cannot also be a
 * 120px drag — so the AND was doing essentially no work against its own
 * stated threat while rejecting deliberate slow swipes. `flickDistance`
 * keeps that protection explicitly and cheaply: velocity may only commit a
 * gesture that has already travelled past mis-tap/jitter noise.
 *
 * What the two branches actually guard, stated plainly so a future retune
 * knows what it is trading against:
 *   - `commitDistance` rules out mis-taps, jitter, and idle drift, and is the
 *     ONLY thing standing between a resting finger and a committed answer.
 *     Lowering it is the change that makes accidental commits likely — treat
 *     it as the safety-critical number here.
 *   - `flickDistance` + `flickVelocity` exist purely so a fast throw doesn't
 *     have to be dragged the full distance. They cannot commit anything the
 *     user has not already deliberately moved.
 *
 * Because the distance branch stands alone, this rule also makes the card's
 * own visual feedback honest for the first time: `SwipeBinary`'s tilt and
 * side-preview reach full strength at exactly `commitDistance`, so "the card
 * looks finished" and "releasing here commits" are now the same point,
 * regardless of pace. Under the AND rule they could never be made to agree,
 * because velocity is unknowable until release.
 */

/** Threshold configuration a completed drag is checked against. */
export interface SwipeThresholdConfig {
  /** Minimum |dx| in px that commits on its own, at any pace. */
  readonly commitDistance: number
  /** Minimum |dx| in px a gesture must travel before velocity is allowed to commit it. */
  readonly flickDistance: number
  /** Minimum |velocity| in px/ms (over the recent window — see `recentVelocity`) for the flick branch. */
  readonly flickVelocity: number
}

/**
 * A completed drag: net horizontal offset, and horizontal velocity over the
 * gesture's RECENT window (see `recentVelocity`), both signed so their sign
 * carries direction (negative = left, positive = right).
 */
export interface SwipeSample {
  readonly dx: number
  readonly velocityX: number
}

export type SwipeCommitDirection = 'left' | 'right' | null

/**
 * Default thresholds, for a practice card ~300-400px wide on a phone screen
 * (see `practice.css`'s `.puzzle-card { max-width: 480px }`, and that real
 * phone viewports below that are typically 340-390px wide):
 *
 * - `commitDistance: 120` — unchanged from the previous rule's `minDistance`,
 *   and deliberately NOT lowered while making the rule easier to satisfy
 *   overall. Roughly 30-35% of a ~340-390px-wide card: far enough past
 *   accidental-scroll/mis-tap noise (usually well under 20px) to be an
 *   unambiguous "the user meant this", while light enough for a gesture
 *   performed dozens of times per session.
 * - `flickDistance: 60` — half the commit distance: unmistakably past
 *   jitter and mis-tap range (3x the 20px axis-resolution tolerance
 *   `SwipeBinary` uses), while still letting a genuine throw register
 *   without a full drag. Deliberately not lower. This card owns 100% of a
 *   touch that starts on it (OD-5), so a user who meant to scroll the page
 *   from the card produces a real, unyielded gesture here; at a smaller
 *   flick distance a fast, slightly-horizontal-dominant scroll attempt could
 *   clear the flick bar and commit an answer nobody meant to give.
 * - `flickVelocity: 0.6` px/ms measured over the last
 *   `RECENT_VELOCITY_WINDOW_MS` — genuinely flick-speed, an order of
 *   magnitude above idle finger drift (typically under 0.05 px/ms). It can
 *   safely be this strict now precisely BECAUSE it no longer gates the
 *   distance branch: a slow drag that never reaches flick speed still
 *   commits on distance alone, so nothing is lost by demanding that an
 *   early commit actually look like a throw.
 */
export const DEFAULT_SWIPE_THRESHOLD: SwipeThresholdConfig = {
  commitDistance: 120,
  flickDistance: 60,
  flickVelocity: 0.6,
}

/**
 * Resolves a completed drag to a commit direction, or `null` if it meets
 * neither the distance nor the flick bar (see the module doc).
 *
 * Boundary values count as meeting a threshold: comparisons use `>=`,
 * applied consistently to distance and velocity alike.
 */
export function resolveSwipeCommit(
  sample: SwipeSample,
  config: SwipeThresholdConfig,
): SwipeCommitDirection {
  const { dx, velocityX } = sample
  const { commitDistance, flickDistance, flickVelocity } = config

  if (dx === 0) return null
  const distanceDirection: 'left' | 'right' = dx > 0 ? 'right' : 'left'

  if (Math.abs(dx) >= commitDistance) return distanceDirection

  if (Math.abs(dx) < flickDistance) return null
  if (Math.abs(velocityX) < flickVelocity) return null

  // A velocity pointing against the displacement is a snap-back at the tail
  // of a gesture, not a throw in that direction — never commit on it.
  const velocityDirection: 'left' | 'right' = velocityX > 0 ? 'right' : 'left'
  if (distanceDirection !== velocityDirection) return null

  return distanceDirection
}

/** One position sample from a live gesture: `x` in px (client coords), `t` in ms. */
export interface GestureTrailSample {
  readonly x: number
  readonly t: number
}

/**
 * How far back (ms) `recentVelocity` looks. Long enough to span several move
 * samples at any realistic touch sampling rate (60-120Hz gives 6-12 samples),
 * short enough that it measures how the gesture is moving AT RELEASE rather
 * than how it averaged out over its whole life.
 */
export const RECENT_VELOCITY_WINDOW_MS = 100

/**
 * Signed velocity (px/ms) over the last `windowMs` of a gesture, derived from
 * its position trail. Sign matches the direction of travel across that
 * window.
 *
 * Deliberately a RECENT window, not the whole-gesture average the previous
 * implementation (`signedVelocityFromGesture`) used. That average existed to
 * work around a real bug in `@use-gesture/core` v10.3.1, which recomputed
 * final-frame velocity from the movement since a >32ms pause and so collapsed
 * to ~0 whenever a finger settled before lifting — a near-universal habit.
 * Averaging sidestepped that, but bought it at the cost of making velocity a
 * proxy for gesture duration, which is what OD-6 proved was rejecting
 * deliberate slow swipes.
 *
 * A recent window is safe here only because of the new commit rule: velocity
 * no longer gates a full-distance drag at all, so the pause-before-release
 * case — which drives a recent-window velocity toward zero — can no longer
 * block a genuine swipe. It only affects the flick branch, where a gesture
 * that came to a dead stop before release genuinely is not a flick and
 * genuinely should not commit early.
 *
 * Always measures across at least two samples: if only one sample falls
 * inside the window (a slow gesture with sparse samples), it reaches one
 * sample further back rather than reporting a meaningless zero.
 */
export function recentVelocity(
  trail: readonly GestureTrailSample[],
  windowMs: number = RECENT_VELOCITY_WINDOW_MS,
): number {
  if (trail.length < 2) return 0
  const end = trail[trail.length - 1]
  if (!end) return 0

  let startIndex = trail.length - 2
  for (let i = trail.length - 2; i >= 0; i--) {
    const sample = trail[i]
    if (!sample) break
    if (end.t - sample.t > windowMs) break
    startIndex = i
  }

  const start = trail[startIndex]
  if (!start) return 0
  const elapsed = end.t - start.t
  if (elapsed <= 0) return 0
  return (end.x - start.x) / elapsed
}
