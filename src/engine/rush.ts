/**
 * Rush-mode serving: escalating-difficulty puzzle selection with a
 * swipe-binary-weighted interaction mix. Pure functions, no I/O — mirrors
 * selection.ts's Rng-injection convention (Math.random is never called
 * internally, deterministic under test). Deliberately does not import from
 * or modify selection.ts: practice/daily selection semantics are locked, and
 * selection.ts's own window-widening/sampling helpers are private (not
 * exported), so there is nothing to share without duplicating a few lines —
 * see widenedEligible/sample below.
 *
 * Rush never touches rating (rating.ts's shouldRateAttempt('rush', _) is
 * hardcoded false) — this module only decides *which* puzzle to serve next
 * and at what difficulty, nothing rating-related.
 */
import { RATING_FLOOR } from './rating'
import type { Rng } from './selection'

/** How far below the user's rating a Rush run starts (chess.com-style ramp). */
export const RUSH_RATING_OFFSET = 400

/**
 * Difficulty increase per correct answer. A named, exported constant (not
 * inlined) since Thomas tunes it after play-testing at both low and high
 * starting ratings — see the PR description for the play-test override
 * instructions.
 */
export const RUSH_DIFFICULTY_STEP = 40

/** Fraction of puzzles served from the swipe-binary bucket when it's non-empty. */
export const RUSH_SWIPE_WEIGHT = 0.7

/**
 * Strikes (wrong answers, including a per-puzzle clock timing out — see
 * useRushSession's RUSH_PUZZLE_TIME_LIMIT_MS) that end a run. This
 * supersedes the prior "3-strikes, no countdown timer" lock: Phase 5b
 * Item 6 adds a flat 15s per-puzzle clock, so a run now ends either by 3
 * strikes or by that clock running out on a puzzle — a timeout counts as a
 * strike rather than opening a separate ending mechanism, so this constant
 * and the ending logic around it are unchanged; only the sources that can
 * push toward it grew by one. See the build plan's Phase 5 amendment.
 */
export const RUSH_STRIKE_LIMIT = 3

const MIN_ELIGIBLE = 1
const BASE_HALF_WINDOW = 200
const WIDEN_STEP = 100

/**
 * `drag-order` (Phase 5b Item 5) is deliberately excluded from this union,
 * not an oversight: a multi-block drag-to-reorder interaction needs more
 * precise, slower pointer control than a tap/swipe/mcq pick — a bad fit for
 * Rush's timed, phone-first speed format. `useRushSession.ts`'s
 * `isRushEligible` guard whitelists exactly these three values by name, so
 * a drag-order puzzle can never enter Rush's pool.
 */
export type RushInteraction = 'mcq' | 'swipe-binary' | 'tap-line'

/** Minimal shape rush.ts needs — mirrors selection.ts's own minimal Puzzle, plus the interaction discriminant Rush weights on. */
export interface RushPuzzle {
  id: string
  rating: number
  interaction: RushInteraction
}

export interface RushSelectionInput {
  readonly pool: readonly RushPuzzle[]
  readonly difficulty: number
  /** Puzzle ids already served this run — no-repeat-within-run preference, see the pool-exhaustion fallback below. */
  readonly usedIds: ReadonlySet<string>
  readonly rng: Rng
}

export interface RushSelectionResult {
  readonly puzzle: RushPuzzle
}

/** userRating - RUSH_RATING_OFFSET, respecting the same floor practice/daily ratings never go below. */
export function startingRushDifficulty(userRating: number): number {
  return Math.max(userRating - RUSH_RATING_OFFSET, RATING_FLOOR)
}

/** Called after every CORRECT answer only — a miss never changes the difficulty (3 strikes ends the run instead of stepping down). */
export function stepDifficulty(current: number): number {
  return current + RUSH_DIFFICULTY_STEP
}

/**
 * Select the next Rush puzzle. Returns null only when the whole pool is
 * empty — mirrors selection.ts's selectNext contract.
 *
 * Widening: like selection.ts, the ±200 window around `difficulty` widens by
 * WIDEN_STEP until at least one UNUSED puzzle is eligible (MIN_ELIGIBLE=1,
 * not selection.ts's 10 — Rush serves at the rating extremes where a small
 * pool is expected, and a run must never stall for lack of content).
 *
 * Pool-exhaustion fallback: if every puzzle in the entire pool has already
 * been served this run (no unused puzzle exists anywhere, even after
 * widening to the full pool), no-repeat-within-run is deliberately dropped
 * for this one pick — the eligible set falls back to every in-window
 * puzzle regardless of `usedIds`. A run must only end by strikes (per the
 * build plan), never by running out of fresh content.
 */
export function selectRushPuzzle(input: RushSelectionInput): RushSelectionResult | null {
  const { pool, difficulty, usedIds, rng } = input
  if (pool.length === 0) {
    return null
  }

  const eligible = widenedEligible(pool, difficulty, usedIds)
  return { puzzle: pickWeighted(eligible, rng) }
}

function widenedEligible(
  pool: readonly RushPuzzle[],
  difficulty: number,
  usedIds: ReadonlySet<string>,
): readonly RushPuzzle[] {
  const maxDistance = Math.max(...pool.map((puzzle) => Math.abs(puzzle.rating - difficulty)))

  let half = BASE_HALF_WINDOW
  let eligible = unusedWithinWindow(pool, difficulty, half, usedIds)
  while (eligible.length < MIN_ELIGIBLE && half <= maxDistance) {
    half += WIDEN_STEP
    eligible = unusedWithinWindow(pool, difficulty, half, usedIds)
  }

  // Pool-exhaustion fallback: every puzzle in the pool has already been
  // served this run. A repeat is preferable to ending the run.
  if (eligible.length === 0) {
    return withinWindow(pool, difficulty, half)
  }
  return eligible
}

function withinWindow(
  pool: readonly RushPuzzle[],
  difficulty: number,
  half: number,
): readonly RushPuzzle[] {
  return pool.filter((puzzle) => Math.abs(puzzle.rating - difficulty) <= half)
}

function unusedWithinWindow(
  pool: readonly RushPuzzle[],
  difficulty: number,
  half: number,
  usedIds: ReadonlySet<string>,
): readonly RushPuzzle[] {
  return withinWindow(pool, difficulty, half).filter((puzzle) => !usedIds.has(puzzle.id))
}

/**
 * Weighted sample: RUSH_SWIPE_WEIGHT of draws come from the swipe-binary
 * bucket when it's non-empty. Degrades gracefully in both directions — no
 * swipe-binary puzzles at this difficulty serves from whatever else is
 * eligible instead of ever stalling the run, and vice versa.
 */
function pickWeighted(eligible: readonly RushPuzzle[], rng: Rng): RushPuzzle {
  const swipe = eligible.filter((puzzle) => puzzle.interaction === 'swipe-binary')
  const rest = eligible.filter((puzzle) => puzzle.interaction !== 'swipe-binary')

  const wantsSwipe = rng() < RUSH_SWIPE_WEIGHT
  if (wantsSwipe && swipe.length > 0) {
    return sample(swipe, rng)
  }
  if (rest.length > 0) {
    return sample(rest, rng)
  }
  return sample(swipe, rng)
}

function sample(items: readonly RushPuzzle[], rng: Rng): RushPuzzle {
  const item = items[Math.floor(rng() * items.length)]
  // Guards noUncheckedIndexedAccess. Unreachable for a non-empty `items` and
  // an in-contract rng (return in [0, 1)); an out-of-range rng lands here.
  if (item === undefined) {
    throw new Error('sample: index out of range (rng returned a value >= 1?)')
  }
  return item
}
