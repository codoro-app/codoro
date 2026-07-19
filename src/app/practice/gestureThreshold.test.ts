import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SWIPE_THRESHOLD,
  resolveSwipeCommit,
  type SwipeSample,
  type SwipeThresholdConfig,
} from './gestureThreshold'

const config: SwipeThresholdConfig = { minDistance: 120, minVelocity: 0.3 }

describe('resolveSwipeCommit', () => {
  it('commits right on a deliberate full-distance, real-velocity rightward drag', () => {
    // Mirrors the DoD's "20 deliberate swipes all commit": a real swipe
    // covers well past minDistance in well past minVelocity.
    const sample: SwipeSample = { dx: 180, velocityX: 0.6 }
    expect(resolveSwipeCommit(sample, config)).toBe('right')
  })

  it('commits left on a deliberate full-distance, real-velocity leftward drag', () => {
    const sample: SwipeSample = { dx: -180, velocityX: -0.6 }
    expect(resolveSwipeCommit(sample, config)).toBe('left')
  })

  it('does not commit a short, high-velocity accidental flick', () => {
    // Distance below threshold, velocity above threshold — exactly the
    // failure mode named in the spec: a stray touch-drag of a few pixels
    // that happens to move fast must not fire a rating update.
    const sample: SwipeSample = { dx: 15, velocityX: 0.8 }
    expect(resolveSwipeCommit(sample, config)).toBeNull()
  })

  it('does not commit a slow, incomplete drag', () => {
    // Distance below threshold, velocity below threshold — mirrors "10
    // lazy half-drags all spring back".
    const sample: SwipeSample = { dx: 40, velocityX: 0.05 }
    expect(resolveSwipeCommit(sample, config)).toBeNull()
  })

  it('does not commit a full-distance drag released very slowly', () => {
    // Distance above threshold, velocity below threshold. Under the locked
    // AND semantics this must NOT commit even though the drag "finished" —
    // distance alone is not sufficient. This is a theoretical edge case: a
    // real human dragging 120+px across a phone-width card in one gesture
    // naturally produces velocity well above 0.3 px/ms (120px in under
    // ~400ms already clears it), so this scenario is not expected to bite
    // real users, but the AND semantics must hold regardless.
    const sample: SwipeSample = { dx: 150, velocityX: 0.1 }
    expect(resolveSwipeCommit(sample, config)).toBeNull()
  })

  it('does not commit when distance and velocity point in opposite directions', () => {
    // Defensive case not called out explicitly by the DoD, but required by
    // "both conditions... in the same direction": a drag that ends up past
    // both thresholds in magnitude, but where the sign of dx and the sign
    // of velocityX disagree (e.g. a fast snap-back at the very end of a
    // gesture), must not be treated as a deliberate commit in either
    // direction.
    const sample: SwipeSample = { dx: 150, velocityX: -0.6 }
    expect(resolveSwipeCommit(sample, config)).toBeNull()
  })

  it('does not commit on zero movement', () => {
    const sample: SwipeSample = { dx: 0, velocityX: 0 }
    expect(resolveSwipeCommit(sample, config)).toBeNull()
  })

  it('treats the boundary values themselves as meeting the threshold (commits)', () => {
    // Documented choice: comparisons use >= (not strictly >), so a sample
    // that lands exactly on minDistance/minVelocity commits. Consistent for
    // both distance and velocity.
    const sample: SwipeSample = { dx: config.minDistance, velocityX: config.minVelocity }
    expect(resolveSwipeCommit(sample, config)).toBe('right')
  })

  it('does not commit one unit below either boundary', () => {
    const belowDistance: SwipeSample = {
      dx: config.minDistance - 1,
      velocityX: config.minVelocity + 1,
    }
    expect(resolveSwipeCommit(belowDistance, config)).toBeNull()

    const belowVelocity: SwipeSample = {
      dx: config.minDistance + 100,
      velocityX: config.minVelocity - 0.01,
    }
    expect(resolveSwipeCommit(belowVelocity, config)).toBeNull()
  })

  it('exposes sane, documented default constants', () => {
    expect(DEFAULT_SWIPE_THRESHOLD.minDistance).toBeGreaterThan(0)
    expect(DEFAULT_SWIPE_THRESHOLD.minVelocity).toBeGreaterThan(0)
    // Sanity-check the defaults land in the ranges the brief calls out for a
    // ~300-400px-wide card: 30-50% of container width, 0.2-0.5 px/ms floor.
    expect(DEFAULT_SWIPE_THRESHOLD.minDistance).toBeGreaterThanOrEqual(90)
    expect(DEFAULT_SWIPE_THRESHOLD.minDistance).toBeLessThanOrEqual(200)
    expect(DEFAULT_SWIPE_THRESHOLD.minVelocity).toBeGreaterThanOrEqual(0.2)
    expect(DEFAULT_SWIPE_THRESHOLD.minVelocity).toBeLessThanOrEqual(0.5)
  })
})
