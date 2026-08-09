/**
 * Zod schemas + TS types for everything persisted to IndexedDB.
 *
 * The runtime source of truth is the Zod schema (it validates untrusted stored
 * bytes on load); the hand-written interfaces keep an explicit type-level link
 * to the engine's own types (StreakState, RequeueState, AttemptMode) so a change
 * in engine surfaces here as a type error rather than silent drift.
 */
import { z } from 'zod'
import type { AttemptMode, CheckpointResult, RequeueState, StreakState } from '../engine'
import { INITIAL_RATING, emptyRequeueState } from '../engine'
import { generateAnonId } from './anonId'

/**
 * Version of the persisted profile shape. Bumped only when a stored-shape change
 * needs a migration (see migrations.ts). A fully-validated profile is always on
 * this exact version — migration runs before schema validation, never after.
 *
 * Note this versions UserProfile specifically, not the whole storage layer:
 * AttemptSchema (below) has never carried its own schema_version and isn't
 * migrated through migrations.ts — see AttemptSchema's own doc comment for
 * why `checkpoint_results` (the v4 addition) doesn't go through this chain.
 */
export const CURRENT_SCHEMA_VERSION = 6

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

/** Which daily puzzle (by calendar date) already has a recorded first attempt this day — the rating/streak/share gate for Daily mode. */
export const DailyCompletionSchema = z.object({
  date: z.string().min(1),
  attemptId: z.string().min(1),
  correct: z.boolean(),
})

export interface DailyCompletion {
  date: string
  attemptId: string
  correct: boolean
}

/**
 * Rush's persisted best-ever stats — the retention hook the build plan
 * calls out. Non-null once at least one Rush run has completed; bestScore/
 * bestStreak are all-time highs across every run, updated only when a
 * finished run beats the existing value (see useRushSession's endRun).
 */
export const RushStatsSchema = z.object({
  bestScore: z.number().int().nonnegative(),
  bestStreak: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  lastRunAt: z.string().nullable(),
})

export interface RushStats {
  bestScore: number
  bestStreak: number
  runs: number
  lastRunAt: string | null
}

export const UserProfileSchema = z.object({
  // z.literal, not z.number(): reaching full validation implies migration has
  // already brought the record onto the current version.
  schema_version: z.literal(CURRENT_SCHEMA_VERSION),
  rating: z.number(),
  ratedAttemptCount: z.number().int().nonnegative(),
  streak: StreakStateSchema,
  requeueState: RequeueStateSchema,
  storagePersisted: z.boolean().nullable(),
  dailyCompletion: DailyCompletionSchema.nullable(),
  rushStats: RushStatsSchema.nullable(),
  bestRunStreak: z.number().int().nonnegative(),
  // Phase 7 Item 6: app-generated, contains no personal information — see
  // migrations.ts's migrateV5ToV6 doc comment for the full context. Exists
  // to let telemetry count returning visits (retention) without knowing
  // who anyone is. Deliberately NOT applied from an imported file on
  // import — see exportImport.ts's commitImport for why (the "import
  // collision": two different people's data landing on one device must
  // not silently merge their identities in PostHog).
  anonId: z.string().min(1),
})

export interface UserProfile {
  schema_version: number
  rating: number
  /** Feeds engine's getK as priorRatedAttemptCount. */
  ratedAttemptCount: number
  streak: StreakState
  requeueState: RequeueState
  storagePersisted: boolean | null
  /** Non-null once today's Daily puzzle has a recorded first (rated) attempt. Date-scoped: a stale date from a previous day means "not completed today" even though the field is non-null. */
  dailyCompletion: DailyCompletion | null
  /** Non-null once at least one Rush run has completed — see RushStatsSchema's doc comment. */
  rushStats: RushStats | null
  /** All-time best in-session correct-answer streak, Practice and Trace combined (Phase 5b Item 8) — the same two modes the streak-pause moment fires in (decision 8). 0 until the first streak-pause fires; unlike rushStats there's no "no data yet" state worth a null for a single counter. */
  bestRunStreak: number
  /** Stable anonymous ID (Phase 7 Item 6) — see UserProfileSchema's own doc comment on this field. */
  anonId: string
}

/**
 * Mirrors engine's CheckpointResult shape (src/engine/scrubber.ts).
 * `choiceIndex` is nullable — Phase 5b's per-checkpoint timer (Item 6, decision
 * 7) needs a "no answer was given" outcome that produces this exact shape
 * (`{ correct: false, choiceIndex: null }`), not a third state. `null` is
 * already this schema's convention for "no real choice exists" (see
 * AttemptSchema's `choice_index` below); a widened, still-optional field
 * reads every choiceIndex ever actually stored (always a real nonnegative
 * int) as valid without a migration — only new timeout records use `null`.
 */
export const CheckpointResultSchema = z.object({
  correct: z.boolean(),
  choiceIndex: z.number().int().nonnegative().nullable(),
})

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
  // Nullable: only a scrubber attempt has per-checkpoint results — null for
  // every other interaction type, same pattern as choice_index above.
  //
  // Considered three shapes for this (see docs/v2-build-plan.md's Phase 2
  // section): (a) this nullable array field, (b) a separate IndexedDB store
  // keyed by attemptId, (c) not recording it at all. Chose (a): a separate
  // store buys nothing at this content volume (Phase 4 targets 40-60
  // scrubber puzzles total) and adds real complexity (a new db.ts store,
  // cross-store joins at read time) with no precedent elsewhere in this
  // schema; not recording it contradicts the DoD's explicit ask for
  // per-checkpoint attempt-log data and throws away exactly the signal
  // Phase 6 wants for future partial-credit tuning, for zero cost savings.
  //
  // Deliberately NOT part of the CURRENT_SCHEMA_VERSION/migrations.ts chain
  // above, unlike a literal reading of "bump the version with a forward-only
  // migration" might suggest: that chain has only ever versioned
  // UserProfile (see CURRENT_SCHEMA_VERSION's doc comment) — AttemptSchema
  // has never carried its own schema_version, and retrofitting per-record
  // migration infrastructure onto a type that never had it, just for one
  // nullable field, is disproportionate. `.nullable().default(null)` gets
  // the same real-world outcome — "every existing record reads as null" —
  // for every already-stored attempt, on every read, forever, without a
  // one-time migration pass: Zod's default fires when the key is absent
  // (true for every attempt written before this field existed), and passes
  // an explicit `null` through unchanged (true for every new non-scrubber
  // attempt going forward). CURRENT_SCHEMA_VERSION is still bumped to 4
  // with a genuine no-op UserProfile migration (see migrations.ts) so v4
  // has a real, distinct meaning across the persisted data as a whole,
  // rather than leaving that number to mean two different things.
  checkpoint_results: z.array(CheckpointResultSchema).nullable().default(null),
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
  checkpoint_results: CheckpointResult[] | null
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
    dailyCompletion: null,
    rushStats: null,
    bestRunStreak: 0,
    anonId: generateAnonId(),
  }
}
