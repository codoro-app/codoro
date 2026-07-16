/**
 * Zod schemas + TS types for everything persisted to IndexedDB.
 *
 * The runtime source of truth is the Zod schema (it validates untrusted stored
 * bytes on load); the hand-written interfaces keep an explicit type-level link
 * to the engine's own types (StreakState, RequeueState, AttemptMode) so a change
 * in engine surfaces here as a type error rather than silent drift.
 */
import { z } from 'zod'
import type { AttemptMode, RequeueState, StreakState } from '../engine'
import { INITIAL_RATING, emptyRequeueState } from '../engine'

/**
 * Version of the persisted profile shape. Bumped only when a stored-shape change
 * needs a migration (see migrations.ts). A fully-validated profile is always on
 * this exact version — migration runs before schema validation, never after.
 */
export const CURRENT_SCHEMA_VERSION = 1

/** Mirrors engine's StreakState shape. */
export const StreakStateSchema = z.object({
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),
  lastActiveDate: z.string().nullable(),
})

/** One entry in the requeue ladder; mirrors engine's RequeueEntry shape. */
export const RequeueEntrySchema = z.object({
  puzzleId: z.string(),
  stage: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  served: z.number().int().nonnegative(),
})

export const RequeueStateSchema = z.array(RequeueEntrySchema)

export const UserProfileSchema = z.object({
  // z.literal, not z.number(): reaching full validation implies migration has
  // already brought the record onto the current version.
  schema_version: z.literal(CURRENT_SCHEMA_VERSION),
  rating: z.number(),
  ratedAttemptCount: z.number().int().nonnegative(),
  streak: StreakStateSchema,
  requeueState: RequeueStateSchema,
  storagePersisted: z.boolean().nullable(),
})

export interface UserProfile {
  schema_version: number
  rating: number
  /** Feeds engine's getK as priorRatedAttemptCount. */
  ratedAttemptCount: number
  streak: StreakState
  requeueState: RequeueState
  storagePersisted: boolean | null
}

export const AttemptSchema = z.object({
  id: z.string().min(1),
  puzzleId: z.string().min(1),
  puzzleRating: z.number(),
  // Literal values must stay in sync with engine's AttemptMode union.
  mode: z.enum(['practice', 'daily', 'rush']),
  correct: z.boolean(),
  time_ms: z.number().nonnegative(),
  // Nullable: not every interaction type has a choice index (e.g. swipe-binary).
  choice_index: z.number().int().nonnegative().nullable(),
  userRatingBefore: z.number(),
  userRatingAfter: z.number(),
  // Local calendar-date string (YYYY-MM-DD); feeds engine's recordActivity.
  localDateString: z.string().min(1),
  createdAt: z.string().min(1),
})

export interface Attempt {
  id: string
  puzzleId: string
  puzzleRating: number
  mode: AttemptMode
  correct: boolean
  time_ms: number
  choice_index: number | null
  userRatingBefore: number
  userRatingAfter: number
  localDateString: string
  createdAt: string
}

/** Factory for a brand-new user's profile. */
export function createDefaultProfile(): UserProfile {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    rating: INITIAL_RATING,
    ratedAttemptCount: 0,
    streak: { currentStreak: 0, longestStreak: 0, lastActiveDate: null },
    requeueState: emptyRequeueState,
    storagePersisted: null,
  }
}
