import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SWIPE_THRESHOLD,
  RECENT_VELOCITY_WINDOW_MS,
  recentVelocity,
  resolveSwipeCommit,
  type GestureTrailSample,
  type SwipeSample,
  type SwipeThresholdConfig,
} from './gestureThreshold'

const config: SwipeThresholdConfig = {
  commitDistance: 120,
  flickDistance: 45,
  flickVelocity: 0.5,
}

/** Builds a trail of evenly-spaced samples travelling `dx` px over `durationMs`. */
function trailFor(dx: number, durationMs: number, samples = 8): GestureTrailSample[] {
  const out: GestureTrailSample[] = []
  for (let i = 0; i <= samples; i++) {
    out.push({ x: (dx * i) / samples, t: (durationMs * i) / samples })
  }
  return out
}

describe('resolveSwipeCommit — distance branch', () => {
  it('commits right on a deliberate full-distance rightward drag', () => {
    const sample: SwipeSample = { dx: 180, velocityX: 0.6 }
    expect(resolveSwipeCommit(sample, config)).toBe('right')
  })

  it('commits left on a deliberate full-distance leftward drag', () => {
    const sample: SwipeSample = { dx: -180, velocityX: -0.6 }
    expect(resolveSwipeCommit(sample, config)).toBe('left')
  })

  it('commits a full-distance drag at ZERO velocity (OD-6 regression, 2026-08-21)', () => {
    // THE defect this rule change exists for. Captured against production:
    // a clean 160px drag released at 2558ms — axis resolved horizontal, the
    // card tracking the finger the whole way to 153px, preventDefault
    // succeeding on every event, touchend arriving normally — silently did
    // not commit, because the old rule ANDed distance with a whole-gesture
    // average velocity and 160/2558 = 0.063 px/ms fell under the 0.08 floor.
    // Distance now stands alone: pace is irrelevant once the user has
    // deliberately dragged this far, so even a velocity of exactly 0 (a
    // finger that came to a complete stop before lifting — the most common
    // real release habit there is) commits.
    expect(resolveSwipeCommit({ dx: 160, velocityX: 0 }, config)).toBe('right')
    expect(resolveSwipeCommit({ dx: -160, velocityX: 0 }, config)).toBe('left')
  })

  it('commits a full-distance drag whose tail velocity points the other way', () => {
    // A snap-back in the last few ms before release does not undo 150px of
    // deliberate travel. Direction agreement is a FLICK-branch rule only —
    // it exists to stop a rebound being read as a throw, not to veto a
    // completed drag.
    expect(resolveSwipeCommit({ dx: 150, velocityX: -0.6 }, config)).toBe('right')
  })

  it('treats the commit distance itself as sufficient (>=, not >)', () => {
    const atThreshold: SwipeSample = { dx: config.commitDistance, velocityX: 0 }
    expect(resolveSwipeCommit(atThreshold, config)).toBe('right')
  })
})

describe('resolveSwipeCommit — flick branch', () => {
  it('commits a short, fast throw before it reaches the full commit distance', () => {
    // The reason the flick branch exists at all: a real throw shouldn't have
    // to be dragged the whole way.
    expect(resolveSwipeCommit({ dx: 60, velocityX: 0.9 }, config)).toBe('right')
    expect(resolveSwipeCommit({ dx: -60, velocityX: -0.9 }, config)).toBe('left')
  })

  it('does not commit a short, high-velocity accidental flick', () => {
    // The failure mode the module doc names by name, and the one thing
    // flickDistance exists to prevent: a stray few-pixel touch-drag that
    // happens to move fast must never fire a rating update.
    expect(resolveSwipeCommit({ dx: 15, velocityX: 0.8 }, config)).toBeNull()
    expect(resolveSwipeCommit({ dx: 44, velocityX: 5 }, config)).toBeNull()
  })

  it('does not commit a short drag that is merely fast-ish', () => {
    // Past flickDistance, but nowhere near throw speed — a partial drag the
    // user thought better of, which must spring back.
    expect(resolveSwipeCommit({ dx: 60, velocityX: 0.2 }, config)).toBeNull()
  })

  it('does not commit a short drag whose velocity opposes its displacement', () => {
    // A rebound at the tail of an aborted half-drag: displacement still to
    // the right, but the finger is travelling left at release. Not a throw
    // in either direction.
    expect(resolveSwipeCommit({ dx: 60, velocityX: -0.9 }, config)).toBeNull()
  })

  it('does not commit a slow, incomplete drag', () => {
    expect(resolveSwipeCommit({ dx: 40, velocityX: 0.05 }, config)).toBeNull()
  })

  it('does not commit idle drift', () => {
    // Well under flickDistance and orders of magnitude under flick speed.
    expect(resolveSwipeCommit({ dx: 8, velocityX: 0.02 }, config)).toBeNull()
  })

  it('does not commit a zero-displacement sample in either direction', () => {
    expect(resolveSwipeCommit({ dx: 0, velocityX: 0 }, config)).toBeNull()
    expect(resolveSwipeCommit({ dx: 0, velocityX: 5 }, config)).toBeNull()
  })

  it('treats both flick thresholds as inclusive (>=, not >)', () => {
    const atBoth: SwipeSample = { dx: config.flickDistance, velocityX: config.flickVelocity }
    expect(resolveSwipeCommit(atBoth, config)).toBe('right')

    expect(
      resolveSwipeCommit({ dx: config.flickDistance - 1, velocityX: config.flickVelocity }, config),
    ).toBeNull()
    expect(
      resolveSwipeCommit(
        { dx: config.flickDistance, velocityX: config.flickVelocity - 0.01 },
        config,
      ),
    ).toBeNull()
  })
})

describe('DEFAULT_SWIPE_THRESHOLD', () => {
  it('is a usable config', () => {
    expect(DEFAULT_SWIPE_THRESHOLD.commitDistance).toBeGreaterThan(0)
    expect(DEFAULT_SWIPE_THRESHOLD.flickDistance).toBeGreaterThan(0)
    expect(DEFAULT_SWIPE_THRESHOLD.flickVelocity).toBeGreaterThan(0)
  })

  it('keeps the flick distance well below the commit distance', () => {
    // The flick branch is an early-out for throws, not a second, easier way
    // to satisfy the same gesture — if these converged, flickVelocity would
    // be the only thing left guarding a full commit.
    expect(DEFAULT_SWIPE_THRESHOLD.flickDistance).toBeLessThanOrEqual(
      DEFAULT_SWIPE_THRESHOLD.commitDistance / 2,
    )
  })

  it('keeps the commit distance in a sane band for a phone-width card', () => {
    // Roughly 30-35% of a ~340-390px card. Deliberately NOT lowered when the
    // rule was loosened to OR: this is the only thing standing between a
    // resting finger and a committed answer.
    expect(DEFAULT_SWIPE_THRESHOLD.commitDistance).toBeGreaterThanOrEqual(90)
    expect(DEFAULT_SWIPE_THRESHOLD.commitDistance).toBeLessThanOrEqual(200)
  })

  it('keeps the flick velocity at genuine throw speed, far above idle drift', () => {
    // Idle finger drift sits under ~0.05 px/ms. The flick gate can afford to
    // be strict precisely because it no longer gates the distance branch.
    expect(DEFAULT_SWIPE_THRESHOLD.flickVelocity).toBeGreaterThanOrEqual(0.3)
    expect(DEFAULT_SWIPE_THRESHOLD.flickVelocity).toBeLessThanOrEqual(1)
  })

  it('commits the captured 160px / 2558ms slow drag (OD-6 regression)', () => {
    // The exact gesture from docs/od-6-swipe-capture-2026-08-21.md, driven
    // end to end through the real trail -> velocity -> commit path.
    const trail = trailFor(160, 2558, 24)
    const velocityX = recentVelocity(trail, RECENT_VELOCITY_WINDOW_MS)
    expect(resolveSwipeCommit({ dx: 160, velocityX }, DEFAULT_SWIPE_THRESHOLD)).toBe('right')
  })

  it('commits an unhurried 130px / 900ms drag (mobile bug report, 2026-08-19)', () => {
    const trail = trailFor(130, 900)
    const velocityX = recentVelocity(trail, RECENT_VELOCITY_WINDOW_MS)
    expect(resolveSwipeCommit({ dx: 130, velocityX }, DEFAULT_SWIPE_THRESHOLD)).toBe('right')
  })

  it('still refuses a half-drag that stalls short of the commit distance', () => {
    // 80px over 3s: past flickDistance, but far under commitDistance and
    // nowhere near flick speed. Loosening to OR must not turn a hesitant,
    // abandoned drag into a committed answer.
    const trail = trailFor(80, 3000)
    const velocityX = recentVelocity(trail, RECENT_VELOCITY_WINDOW_MS)
    expect(resolveSwipeCommit({ dx: 80, velocityX }, DEFAULT_SWIPE_THRESHOLD)).toBeNull()
  })
})

describe('recentVelocity', () => {
  it('measures px/ms across the recent window, signed by direction of travel', () => {
    const trail: GestureTrailSample[] = [
      { x: 0, t: 0 },
      { x: 50, t: 100 },
      { x: 100, t: 150 },
      { x: 160, t: 200 },
    ]
    // Window covers t=100..200: 110px over 100ms.
    expect(recentVelocity(trail, 100)).toBeCloseTo(1.1)
  })

  it('carries a negative sign for leftward travel', () => {
    const trail: GestureTrailSample[] = [
      { x: 0, t: 0 },
      { x: -60, t: 50 },
      { x: -120, t: 100 },
    ]
    expect(recentVelocity(trail, 100)).toBeCloseTo(-1.2)
  })

  it('reports 0 for a gesture that came to a stop before release', () => {
    // The pause-before-release habit. Harmless now: this only feeds the
    // flick branch, and a gesture that stopped genuinely is not a flick.
    const trail: GestureTrailSample[] = [
      { x: 0, t: 0 },
      { x: 150, t: 300 },
      { x: 150, t: 400 },
      { x: 150, t: 500 },
    ]
    expect(recentVelocity(trail, RECENT_VELOCITY_WINDOW_MS)).toBe(0)
  })

  it('reaches past the window rather than reporting a meaningless zero on sparse samples', () => {
    // A slow drag can produce fewer than two samples inside a 100ms window.
    // Measuring across the last two is honest; returning 0 would not be.
    const trail: GestureTrailSample[] = [
      { x: 0, t: 0 },
      { x: 100, t: 400 },
      { x: 200, t: 800 },
    ]
    expect(recentVelocity(trail, 100)).toBeCloseTo(0.25)
  })

  it('returns 0 for a trail too short to have a velocity', () => {
    expect(recentVelocity([], 100)).toBe(0)
    expect(recentVelocity([{ x: 10, t: 5 }], 100)).toBe(0)
  })

  it('returns 0 rather than dividing by a zero or inverted time delta', () => {
    expect(
      recentVelocity(
        [
          { x: 0, t: 100 },
          { x: 50, t: 100 },
        ],
        100,
      ),
    ).toBe(0)
  })

  it('defaults to RECENT_VELOCITY_WINDOW_MS when no window is given', () => {
    const trail = trailFor(200, 400, 8)
    expect(recentVelocity(trail)).toBeCloseTo(recentVelocity(trail, RECENT_VELOCITY_WINDOW_MS))
  })
})
