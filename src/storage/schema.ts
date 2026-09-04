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
export const CURRENT_SCHEMA_VERSION = 13

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

/**
 * Boss's persisted best-ever stats (v3 Phase 1) — mirrors RushStatsSchema's
 * shape and null-until-first-run convention. `bestDepth` is the deepest any
 * run has ever reached (1-10, see useBossSession's own doc comment for the
 * "depth reached" definition); `clears` counts full completions (depth
 * reached === active set length) separately from `runs` (every run, cleared
 * or struck out) because a future mission-progression trigger (Phase 2)
 * needs "has this player ever cleared a boss run" as a queryable fact
 * without re-deriving it from raw attempt history.
 *
 * `bestRunSplits` (engagement pass, v8): elapsed-ms-per-position for the run
 * that set the CURRENT `bestDepth`, length === bestDepth, index i = time from
 * run start to answering the puzzle at position i+1. Null until the first
 * run that sets a best depth; overwritten wholesale (never merged/appended)
 * whenever a run beats the existing bestDepth, and left untouched by every
 * ordinary (non-record) run — see useBossSession's own doc comment for why
 * "only the run that actually set bestDepth" is the one invariant this field
 * must never violate. Powers the post-run "ghost pace" comparison
 * (bossPage's runSummary): this run's per-position splits vs. the
 * all-time-best run's, surfaced once the run ends. Deliberately NOT a live
 * race/animated ghost — see the Boss engagement pass's locked decisions.
 */
export const BossStatsSchema = z.object({
  bestDepth: z.number().int().nonnegative(),
  clears: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  lastRunAt: z.string().nullable(),
  bestRunSplits: z.array(z.number().nonnegative()).nullable(),
})

export interface BossStats {
  bestDepth: number
  clears: number
  runs: number
  lastRunAt: string | null
  bestRunSplits: number[] | null
}

/**
 * v3 Phase 2: the mission chain's three stages, in play order. Exported as a
 * const tuple (not just the union) so useMissionSession's orchestrator can
 * iterate/index it directly rather than hand-maintaining a parallel array —
 * see docs/design/click-meaningfulness.md §3 for the chain itself.
 */
export const MISSION_STAGE_ORDER = ['trace', 'speed', 'boss'] as const
export type MissionStageId = (typeof MISSION_STAGE_ORDER)[number]

/**
 * One stage's own result, shaped per-stage (discriminated on `stageId`)
 * because each mode tracks a different "how did it go" — Trace has no
 * native end condition so its shape is just a tally, while Speed/Boss
 * mirror the fields their own standalone summaries already report
 * (RushRunSummary.solvedCount/bestStreakThisRun, BossRunSummary's
 * depthReached/cleared) rather than inventing a new vocabulary.
 */
export const MissionStageStatsSchema = z.discriminatedUnion('stageId', [
  z.object({
    stageId: z.literal('trace'),
    puzzlesCompleted: z.number().int().nonnegative(),
    solvedCount: z.number().int().nonnegative(),
  }),
  z.object({
    stageId: z.literal('speed'),
    solvedCount: z.number().int().nonnegative(),
    bestStreakThisRun: z.number().int().nonnegative(),
  }),
  z.object({
    stageId: z.literal('boss'),
    depthReached: z.number().int().nonnegative(),
    cleared: z.boolean(),
  }),
])

export type MissionStageStats =
  | { stageId: 'trace'; puzzlesCompleted: number; solvedCount: number }
  | { stageId: 'speed'; solvedCount: number; bestStreakThisRun: number }
  | { stageId: 'boss'; depthReached: number; cleared: boolean }

/**
 * `endedReason` records which of Missions' two stage-end conditions
 * actually fired (see the design doc's §3) — `'native'` only when the
 * mode's own real end condition (Rush's 3 strikes, Boss's 3
 * strikes/depth-10) beat the shared 60s clock; `'timer'` otherwise
 * (always `'timer'` for the Trace stage, which has no native end at all).
 */
export const MissionStageSummarySchema = z.object({
  stats: MissionStageStatsSchema,
  endedReason: z.enum(['timer', 'native']),
  completedAt: z.string().min(1),
})

export interface MissionStageSummary {
  stats: MissionStageStats
  endedReason: 'timer' | 'native'
  completedAt: string
}

/**
 * A mission run's live progress — written to storage ONLY at stage
 * boundaries, never mid-stage (see the design doc's §3 resume/abandon
 * mechanism: this write-timing discipline, not a separate detector, is
 * what makes a bare tab close silently resumable while an explicit "Exit
 * mission" tap is the only path that clears this early). `null` when no
 * mission is in progress. `completedStages` holds 0-2 entries during an
 * active run — a 3rd would mean the run finished, at which point this
 * resets to `null` and `missionStats` records the completion instead.
 */
export const MissionProgressSchema = z.object({
  runId: z.string().min(1),
  currentStage: z.enum(['trace', 'speed', 'boss']),
  completedStages: z.array(MissionStageSummarySchema),
  startedAt: z.string().min(1),
})

export interface MissionProgress {
  runId: string
  currentStage: MissionStageId
  completedStages: MissionStageSummary[]
  startedAt: string
}

/**
 * Cross-run mission stats — mirrors RushStats'/BossStats' null-until-first-
 * completion convention. Deliberately minimal: no composite "best arc"
 * scalar — a single number combining three stages' different units would
 * itself be exactly the kind of invented-number mechanic the design doc's
 * payoff decision (§3) bans. Richer cross-run stats are a stated fast-follow
 * candidate, not silently dropped — see the implementation plan.
 */
export const MissionStatsSchema = z.object({
  completions: z.number().int().nonnegative(),
  lastRunAt: z.string().nullable(),
  lastCompletedAt: z.string().nullable(),
})

export interface MissionStats {
  completions: number
  lastRunAt: string | null
  lastCompletedAt: string | null
}

/**
 * v4 Phase 4.1 ("Settings, for real"): device/UX preferences, versioned and
 * carried through export/import like every other UserProfile field — the
 * whole point being that v5's account sync picks these up for free without
 * a separate preferences payload. Each field earns its place:
 *
 * - `timerOnTrace`: makes todo 14's "no timer on regular trace mode"
 *   (TracePage.tsx's hardcoded `timed={false}`) a preference instead of a
 *   hardcode, so a player who wants the per-checkpoint clock can opt in.
 * - `reducedMotion`: an app-level override independent of the OS's own
 *   `prefers-reduced-motion` — the codebase has no reduced-motion handling
 *   of any kind today (grep-verified), so this is the first place it's
 *   respected at all.
 * - `codeFontSize`: drives the single global `--font-size-code` token every
 *   code surface already reads (CodeSnippet.tsx, practice.css) — one token,
 *   zero per-component changes needed.
 * - `theme`: which accent/surface palette applies app-wide (`index.css`'s
 *   `[data-app-theme]` overrides) — 'default' is exactly today's shipped
 *   lime-on-near-black look; 'blue'/'slate' are new dark directions and
 *   'light' is a light-surfaced variant of the same brand accent (deepened
 *   to a legible shade for light backgrounds — see index.css's own comment
 *   on why the raw neon lime can't just be reused as-is).
 * - `sound` (practice feedback loop, v13): Practice's synthesized impact
 *   audio (feedbackSound.ts) — added because Practice now has audio at
 *   all, where before this repo had none anywhere (grep-verified at the
 *   time). Defaults `true`; the escape hatch is a one-tap mute in
 *   StatusBar (something that makes noise unprompted needs a kill switch
 *   in the moment, not just a settings toggle) — see StatusBar.tsx.
 * - `autoAdvance` (practice feedback loop, v13): whether a correct commit
 *   auto-advances Practice's PuzzleCardShell after a beat instead of
 *   waiting for a Continue tap — see PuzzleCardShell.tsx's `autoAdvanceMs`
 *   prop. Defaults `true`.
 */
export const PreferencesSchema = z.object({
  timerOnTrace: z.boolean(),
  reducedMotion: z.boolean(),
  codeFontSize: z.enum(['sm', 'md', 'lg']),
  theme: z.enum(['default', 'blue', 'slate', 'light']),
  sound: z.boolean(),
  autoAdvance: z.boolean(),
})

export interface Preferences {
  timerOnTrace: boolean
  reducedMotion: boolean
  codeFontSize: 'sm' | 'md' | 'lg'
  theme: 'default' | 'blue' | 'slate' | 'light'
  sound: boolean
  autoAdvance: boolean
}

/** Every default matches today's actual shipped behavior EXCEPT sound/autoAdvance, which are new mechanics defaulted on — see PreferencesSchema's own doc comment for why. */
export const DEFAULT_PREFERENCES: Preferences = {
  timerOnTrace: false,
  reducedMotion: false,
  codeFontSize: 'md',
  theme: 'default',
  sound: true,
  autoAdvance: true,
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
  /** Non-null once at least one Boss run has completed — see BossStatsSchema's doc comment. */
  bossStats: BossStatsSchema.nullable(),
  /** Non-null only while a mission run is actively in progress — see MissionProgressSchema's doc comment. */
  missionProgress: MissionProgressSchema.nullable(),
  /** Non-null once at least one mission has ever completed — see MissionStatsSchema's doc comment. */
  missionStats: MissionStatsSchema.nullable(),
  /** v4 Phase 4.1 — see PreferencesSchema's own doc comment. */
  preferences: PreferencesSchema,
  // Phase 7 Item 6: app-generated, contains no personal information — see
  // migrations.ts's migrateV5ToV6 doc comment for the full context. Exists
  // to let telemetry count returning visits (retention) without knowing
  // who anyone is. Deliberately NOT applied from an imported file on
  // import — see exportImport.ts's commitImport for why (the "import
  // collision": two different people's data landing on one device must
  // not silently merge their identities in PostHog).
  anonId: z.string().min(1),
  // Challenge redesign: the display name threaded into every challenge link
  // this device creates ("Joe challenged you!" on the recipient's landing
  // hero — see src/challenge/schema.ts's ChallengePayloadSchema doc
  // comment). Mirrors `anonId`'s on-device-only, never-sent-to-telemetry
  // posture — this is a player-typed value, not app-generated, so unlike
  // anonId it's never registered as a telemetry super property. Set once via
  // ChallengerNameSheet.tsx (first-ever challenge creation), reused after
  // that, editable in Settings later (not this PR — see the design doc's
  // decision record). `null` until set; a blank/skipped prompt never blocks
  // sharing (ChallengeButton falls back to the generic "A friend" copy).
  challengerName: z.string().min(1).max(40).nullable(),
  // First-run sequence: true once this profile has completed (or, per
  // migrateV11ToV12's own doc comment, is assumed to have already completed)
  // its curated 3-puzzle first-run sequence (src/content/firstRun.ts) —
  // Home.tsx's gate is `attempts.length === 0 && !firstRunCompleted`. Flips
  // at the 3rd puzzle's COMMIT time (useFirstRunSession.ts), not at the
  // payoff screen's own render — a visitor who solves puzzle 3 and closes
  // the tab before seeing the payoff screen must still never see first-run
  // again. `createDefaultProfile()` starts every genuinely new profile at
  // `false`.
  firstRunCompleted: z.boolean(),
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
  /** Non-null once at least one Boss run has completed — see BossStats's doc comment. */
  bossStats: BossStats | null
  /** Non-null only while a mission run is actively in progress — see MissionProgress's doc comment. */
  missionProgress: MissionProgress | null
  /** Non-null once at least one mission has ever completed — see MissionStats's doc comment. */
  missionStats: MissionStats | null
  /** v4 Phase 4.1 — see PreferencesSchema's own doc comment. */
  preferences: Preferences
  /** Stable anonymous ID (Phase 7 Item 6) — see UserProfileSchema's own doc comment on this field. */
  anonId: string
  /** Player-set display name for outgoing challenge links, or null if never set/skipped — see UserProfileSchema's own doc comment on this field. */
  challengerName: string | null
  /** True once this profile has completed the curated first-run sequence (or is assumed to have — see UserProfileSchema's own doc comment on this field). */
  firstRunCompleted: boolean
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
  mode: z.enum(['practice', 'daily', 'rush', 'boss']),
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
    bossStats: null,
    missionProgress: null,
    missionStats: null,
    preferences: { ...DEFAULT_PREFERENCES },
    anonId: generateAnonId(),
    challengerName: null,
    // A genuinely new profile hasn't played the first-run sequence yet —
    // Home's gate (attempts.length === 0 && !firstRunCompleted) is what
    // actually serves it. See UserProfileSchema's own doc comment.
    firstRunCompleted: false,
  }
}
