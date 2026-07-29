/**
 * Pure TS: rating, selection, streak, requeue.
 * NO React or DOM imports — enforced by eslint.config.js's
 * no-restricted-imports rule scoped to this folder.
 *
 * Barrel exports only — no logic lives here.
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new Error('clamp: min must be <= max')
  }
  return Math.min(Math.max(value, min), max)
}

export {
  INITIAL_RATING,
  RATING_FLOOR,
  expectedScore,
  getK,
  updateRating,
  roundForDisplay,
  shouldRateAttempt,
} from './rating'
export type { AttemptMode } from './rating'

export { selectNext } from './selection'
export type { Puzzle, Rng, SelectionSource, SelectionResult, SelectionInput } from './selection'

export { emptyRequeueState, recordMiss, advance, resurface } from './requeue'
export type { RequeueStage, RequeueEntry, RequeueState, AdvanceResult } from './requeue'

export { daysBetween, recordActivity } from './streak'
export type { StreakState } from './streak'

export { getDailyCalendarIndex, getDailyNumber, DAILY_EPOCH } from './daily'

export {
  RUSH_RATING_OFFSET,
  RUSH_DIFFICULTY_STEP,
  RUSH_SWIPE_WEIGHT,
  RUSH_STRIKE_LIMIT,
  startingRushDifficulty,
  stepDifficulty,
  selectRushPuzzle,
} from './rush'
export type { RushInteraction, RushPuzzle, RushSelectionInput, RushSelectionResult } from './rush'

export { scoreScrubberAttempt } from './scrubber'
export type { CheckpointResult } from './scrubber'
