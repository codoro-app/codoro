/**
 * Practice-mode "rating-matched next puzzle" selector.
 *
 * Every call corresponds to exactly one practice puzzle being served, so each
 * call advances the requeue ladder once (via `advance`) and returns the puzzle
 * to serve — either a due requeue puzzle (priority) or a fresh rating-window
 * pick. Daily/Rush modes do NOT go through here.
 *
 * Deterministic: randomness is injected as an `Rng`; `Math.random` is never
 * called internally.
 */
import type { RequeueState } from './requeue'
import { advance, resurface } from './requeue'

/**
 * Minimal Phase-1 puzzle shape. Later phases add more fields via the content
 * schema; the engine only needs an id and a difficulty rating.
 */
export interface Puzzle {
  id: string
  rating: number
}

/** Deterministic random source returning a float in [0, 1). */
export type Rng = () => number

export type SelectionSource = 'requeue' | 'window'

export interface SelectionResult {
  readonly puzzle: Puzzle
  readonly source: SelectionSource
  readonly newRequeueState: RequeueState
}

export interface SelectionInput {
  readonly pool: readonly Puzzle[]
  /** The user's current rating; the ±window is centred on this. */
  readonly rating: number
  /** Caller-supplied last-20 served puzzle ids (soft no-repeat preference). */
  readonly recentIds: readonly string[]
  readonly requeueState: RequeueState
  readonly rng: Rng
}

const MIN_ELIGIBLE = 10
const BASE_HALF_WINDOW = 200
const WIDEN_STEP = 100

/**
 * Select the next practice puzzle.
 *
 * Returns `null` only when the pool is empty (nothing can be served); in that
 * case the requeue ladder is deliberately NOT advanced, since no practice
 * puzzle was actually served this call.
 */
export function selectNext(input: SelectionInput): SelectionResult | null {
  const { pool, rating, recentIds, requeueState, rng } = input
  if (pool.length === 0) {
    return null
  }

  // One call == one practice puzzle served: advance the ladder once.
  const { state: ticked, due } = advance(requeueState)

  // Requeue injection: the highest-priority due entry whose puzzle still exists
  // in the pool takes precedence over a fresh window pick. If a due entry's
  // puzzle is no longer present (content changed/removed) we skip it gracefully
  // and leave it due for a following tick, falling through to a window pick.
  for (const entry of due) {
    const puzzle = pool.find((candidate) => candidate.id === entry.puzzleId)
    if (puzzle) {
      return {
        puzzle,
        source: 'requeue',
        newRequeueState: resurface(ticked, entry.puzzleId),
      }
    }
  }

  return {
    puzzle: pickFromWindow(pool, rating, recentIds, rng),
    source: 'window',
    newRequeueState: ticked,
  }
}

function pickFromWindow(
  pool: readonly Puzzle[],
  rating: number,
  recentIds: readonly string[],
  rng: Rng,
): Puzzle {
  const eligible = widenedEligible(pool, rating)

  // No-repeat-within-20 is a soft preference: exclude recently-served puzzles,
  // but if that would leave nothing, fall back to the full eligible set — the
  // selector must always return a puzzle when the pool is non-empty.
  const recent = new Set(recentIds)
  const notRecent = eligible.filter((puzzle) => !recent.has(puzzle.id))
  const candidates = notRecent.length > 0 ? notRecent : eligible

  return sample(candidates, rng)
}

/**
 * Eligible puzzles within the rating window, widening the window by WIDEN_STEP
 * on each side until at least MIN_ELIGIBLE are found or the window covers the
 * whole pool.
 *
 * Termination: the pool is finite, so once the half-window reaches the largest
 * rating-distance of any puzzle from `rating`, every puzzle is eligible and no
 * further widening can add more. We bound the loop by that `maxDistance`, so it
 * ends even when the entire pool has fewer than MIN_ELIGIBLE puzzles (in which
 * case we return whatever is eligible, i.e. all of them). `pool` is guaranteed
 * non-empty here (checked in `selectNext`).
 */
function widenedEligible(pool: readonly Puzzle[], rating: number): readonly Puzzle[] {
  const maxDistance = Math.max(...pool.map((puzzle) => Math.abs(puzzle.rating - rating)))

  let half = BASE_HALF_WINDOW
  let eligible = withinWindow(pool, rating, half)
  while (eligible.length < MIN_ELIGIBLE && half <= maxDistance) {
    half += WIDEN_STEP
    eligible = withinWindow(pool, rating, half)
  }
  return eligible
}

function withinWindow(pool: readonly Puzzle[], rating: number, half: number): readonly Puzzle[] {
  return pool.filter((puzzle) => Math.abs(puzzle.rating - rating) <= half)
}

function sample(items: readonly Puzzle[], rng: Rng): Puzzle {
  const item = items[Math.floor(rng() * items.length)]
  // Guards noUncheckedIndexedAccess. Unreachable for a non-empty `items` and an
  // in-contract rng (return in [0, 1)); an out-of-range rng lands here.
  if (item === undefined) {
    throw new Error('sample: index out of range (rng returned a value >= 1?)')
  }
  return item
}
