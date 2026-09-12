/**
 * T6 (v5 Phase 5.2): the sync merge engine. Pure logic only — no IndexedDB,
 * no fetch, no Clerk. Takes two `ExportedData`-shaped objects (a local
 * snapshot and a pulled-from-server snapshot) and returns one merged result.
 * T8 is the only thing that calls this against real data; this module never
 * decides *when* to sync, only *how* two snapshots combine.
 *
 * ## Field merge rules
 *
 * Every `UserProfile` key has an entry in `FIELD_MERGE_RULES` below — a
 * `Record<keyof UserProfile, MergeRuleTag>`, so a new profile field with no
 * assigned rule fails typecheck instead of silently falling through (the
 * table itself doesn't execute the merge — most tags are handled by direct,
 * explicit code further down; the table exists so completeness is checked by
 * the compiler, not left to someone remembering to update a comment).
 *
 * | Field | Rule |
 * | --- | --- |
 * | `schema_version` | not merged directly — governed by the schema-skew policy below; the result is always stamped `CURRENT_SCHEMA_VERSION` |
 * | `rating` | **recompute** from the merged `attempts` array (see "Recompute", below) |
 * | `ratedAttemptCount` | **recompute**, same pass as `rating` |
 * | `streak` | **recompute** from the merged attempts' Daily-mode activity dates |
 * | `requeueState` | **latest wins** (by which side's `exportedAt` is later) — session-local scheduling state, not history |
 * | `storagePersisted` | **latest wins** — a per-device capability flag, not something to union |
 * | `dailyCompletion` | **latest by date, then latest by `exportedAt`** on a same-date tie |
 * | `rushStats` | non-null wins over null; else per-sub-field max/latest (bests = max, `lastRunAt` = max) |
 * | `bestRunStreak` | **max** |
 * | `bossStats` | same shape as `rushStats`, plus `bestRunSplits` travels with whichever side's `bestDepth` wins (see the footgun note on `mergeBossStats`) |
 * | `missionProgress` | non-null wins over null; if both non-null, **latest wins** wholesale — an in-progress run is single-device state, never field-merged |
 * | `missionStats` | same shape as `rushStats`/`bossStats` |
 * | `preferences` | **latest wins** — true settings, last-write-wins |
 * | `anonId` | **keep local** — never overwritten by a pulled value (mirrors T7's server-side first-write-wins) |
 * | `challengerName` | **latest wins** |
 * | `firstRunCompleted` | **OR** — once true anywhere, true everywhere; no legitimate path back to false |
 *
 * `attempts` (a sibling of `UserProfile` in `ExportedData`, not a profile
 * field) is **unioned by `id`, then re-sorted by `createdAt`** — this has to
 * run before the `rating`/`ratedAttemptCount`/`streak` recompute above, not
 * after or in parallel (see F24 in the Phase 5.2 plan: recomputing from a
 * partially-merged attempts array silently drops one device's history from
 * the derived rating).
 *
 * Unknown keys (a field this build's `schema.ts` doesn't know about, present
 * because the payload came from a newer or differently-built client) are
 * preserved verbatim and round-tripped, never dropped — see
 * `mergeUnknownProfileKeys` below.
 *
 * ## What "latest wins" actually compares
 *
 * The original plan phrased several rules as "latest `clientUpdatedAt`
 * wins" — but `clientUpdatedAt` **does not exist** anywhere on `UserProfile`
 * or `ExportedData` (verified against `src/storage/schema.ts` before writing
 * this, not assumed). The one real clock `ExportedData` actually carries is
 * its own top-level `exportedAt` (the whole snapshot's export timestamp).
 * Every "latest wins" rule in this module compares `local.exportedAt` vs.
 * `remote.exportedAt` and swaps the *entire* field from whichever side is
 * later — a whole-snapshot granularity, not true per-field last-write. This
 * is coarser than the plan's language implied, but it's what the schema as
 * it exists today can actually support without inventing a new persisted
 * field outside this task's scope.
 *
 * ## Recompute
 *
 * `rating`/`ratedAttemptCount` are re-derived by replaying the merged,
 * chronologically-sorted `attempts` array through the same rating engine a
 * fresh attempt uses (`shouldRateAttempt`, `updateRating`, `getK` — all from
 * `../engine`), starting from `INITIAL_RATING`. `streak` is re-derived by
 * folding `recordActivity` over the distinct `localDateString`s of
 * first-of-day Daily attempts, same rule `useDailySession.ts` uses live
 * ("Daily anchors the streak now, not Practice").
 *
 * **A real, unavoidable approximation for Trace attempts:** the client
 * computes a Trace/scrubber attempt's rating credit via `scrubberActualScore`,
 * which needs `choiceCounts` (how many choices existed at each checkpoint) —
 * data that is **not** part of the persisted `Attempt`/`CheckpointResult`
 * shape (verified: `CheckpointResultSchema` only carries `correct` and
 * `choiceIndex`). A true byte-for-byte recompute of a historical Trace
 * attempt's original rating delta is therefore structurally impossible from
 * the export alone. This recompute uses the unadjusted raw ratio
 * (`correctCount / totalCheckpoints`) instead of the floor-adjusted score —
 * closer to the original signal than collapsing to a plain boolean, but a
 * deliberate, named approximation, not a bug. A profile whose entire rating
 * history is non-Trace attempts recomputes exactly.
 *
 * ## Schema skew
 *
 * | Pulled blob vs. `CURRENT_SCHEMA_VERSION` | Action |
 * | --- | --- |
 * | `remote.schema_version < CURRENT` | `remote.profile` is run through `runMigrations`/`MIGRATIONS` (imported from `../storage`, the same chain `loadProfile`/`resolveImportCandidate` already use) before merging normally. No sync-specific migrator. |
 * | `remote.schema_version === CURRENT` | merge normally, per the table above. |
 * | `remote.schema_version > CURRENT` | **read-only**: `merge` returns `{ kind: 'remote-ahead', remoteSchemaVersion }` instead of a merged result — T8's job to surface a "reload to update" notice and skip both merge and push. |
 *
 * `local` is always assumed to be at `CURRENT_SCHEMA_VERSION` — it's this
 * running build's own just-loaded/just-created profile, never a value this
 * module needs to skew-check.
 */
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, runMigrations, UserProfileSchema } from '../storage'
import type { Attempt, ExportedData, UserProfile } from '../storage'
import {
  INITIAL_RATING,
  TRACE_K_MULTIPLIER,
  recordActivity,
  shouldRateAttempt,
  updateRating,
} from '../engine'
import type { CheckpointResult, StreakState } from '../engine'

export type MergeRuleTag =
  | 'schema-version'
  | 'recompute'
  | 'latest-wins'
  | 'date-then-latest'
  | 'stats-block'
  | 'max'
  | 'non-null-then-latest'
  | 'keep-local'
  | 'or'

/**
 * Exhaustive by construction: `Record<keyof UserProfile, MergeRuleTag>`
 * means TypeScript rejects this object if a `UserProfile` field is missing
 * from it, or if it has an entry for a field that no longer exists. Doesn't
 * drive execution for every tag (`recompute` and `stats-block` fields are
 * handled by dedicated functions below, not a generic interpreter over this
 * table) — its job is compile-time completeness, not runtime dispatch.
 */
const FIELD_MERGE_RULES: Record<keyof UserProfile, MergeRuleTag> = {
  schema_version: 'schema-version',
  rating: 'recompute',
  ratedAttemptCount: 'recompute',
  streak: 'recompute',
  requeueState: 'latest-wins',
  storagePersisted: 'latest-wins',
  dailyCompletion: 'date-then-latest',
  rushStats: 'stats-block',
  bestRunStreak: 'max',
  bossStats: 'stats-block',
  missionProgress: 'non-null-then-latest',
  missionStats: 'stats-block',
  preferences: 'latest-wins',
  anonId: 'keep-local',
  challengerName: 'latest-wins',
  firstRunCompleted: 'or',
}

const KNOWN_PROFILE_KEYS = new Set<string>(Object.keys(FIELD_MERGE_RULES))

export type MergeOutcome =
  | { kind: 'merged'; data: ExportedData }
  /** `remote` is on a schema this build doesn't understand yet — read-only, T8 surfaces a reload notice and skips both merge and push. */
  | { kind: 'remote-ahead'; remoteSchemaVersion: number }

/** Null-safe max of two nullable ISO-8601 timestamp strings; non-null beats null, later beats earlier, both-null stays null. */
function laterNullableIso(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a >= b ? a : b
}

/**
 * Preserves any key neither side's `FIELD_MERGE_RULES` knows about (an
 * older client reading a newer payload) instead of silently dropping it —
 * the "unknown fields ... preserved verbatim, round-tripped" rule. Explicit
 * rather than relying on object-spread ordering, so it's correct regardless
 * of which side (or both) carries the unknown key.
 */
function mergeUnknownProfileKeys(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  localIsLater: boolean,
): Record<string, unknown> {
  const earlier = localIsLater ? remote : local
  const later = localIsLater ? local : remote
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(earlier)) {
    if (!KNOWN_PROFILE_KEYS.has(key)) result[key] = value
  }
  for (const [key, value] of Object.entries(later)) {
    if (!KNOWN_PROFILE_KEYS.has(key)) result[key] = value
  }
  return result
}

function mergeDailyCompletion(
  local: UserProfile['dailyCompletion'],
  remote: UserProfile['dailyCompletion'],
  localIsLater: boolean,
): UserProfile['dailyCompletion'] {
  if (local === null) return remote
  if (remote === null) return local
  if (local.date !== remote.date) return local.date > remote.date ? local : remote
  return localIsLater ? local : remote
}

function mergeRushStats(
  a: UserProfile['rushStats'],
  b: UserProfile['rushStats'],
): UserProfile['rushStats'] {
  if (a === null) return b
  if (b === null) return a
  return {
    bestScore: Math.max(a.bestScore, b.bestScore),
    bestStreak: Math.max(a.bestStreak, b.bestStreak),
    runs: Math.max(a.runs, b.runs),
    lastRunAt: laterNullableIso(a.lastRunAt, b.lastRunAt),
  }
}

/**
 * `bestRunSplits` is per-run data belonging to whichever run actually set
 * `bestDepth` (see BossStats's own doc comment in schema.ts) — it cannot be
 * independently maxed/latest-picked the way the scalar fields can, or a
 * merge could report a `bestDepth` from one run alongside `bestRunSplits`
 * from a *different* run that never reached that depth. Ties (equal
 * `bestDepth` on both sides) fall back to whichever run is more recent.
 */
function mergeBossStats(
  a: UserProfile['bossStats'],
  b: UserProfile['bossStats'],
): UserProfile['bossStats'] {
  if (a === null) return b
  if (b === null) return a
  const bestDepth = Math.max(a.bestDepth, b.bestDepth)
  let bestRunSplits: number[] | null
  if (a.bestDepth > b.bestDepth) bestRunSplits = a.bestRunSplits
  else if (b.bestDepth > a.bestDepth) bestRunSplits = b.bestRunSplits
  else
    bestRunSplits =
      laterNullableIso(a.lastRunAt, b.lastRunAt) === a.lastRunAt ? a.bestRunSplits : b.bestRunSplits
  return {
    bestDepth,
    clears: Math.max(a.clears, b.clears),
    runs: Math.max(a.runs, b.runs),
    lastRunAt: laterNullableIso(a.lastRunAt, b.lastRunAt),
    bestRunSplits,
  }
}

function mergeMissionStats(
  a: UserProfile['missionStats'],
  b: UserProfile['missionStats'],
): UserProfile['missionStats'] {
  if (a === null) return b
  if (b === null) return a
  return {
    completions: Math.max(a.completions, b.completions),
    lastRunAt: laterNullableIso(a.lastRunAt, b.lastRunAt),
    lastCompletedAt: laterNullableIso(a.lastCompletedAt, b.lastCompletedAt),
  }
}

function mergeMissionProgress(
  local: UserProfile['missionProgress'],
  remote: UserProfile['missionProgress'],
  localIsLater: boolean,
): UserProfile['missionProgress'] {
  if (local === null) return remote
  if (remote === null) return local
  return localIsLater ? local : remote
}

/** Union by `id` (later side wins on an exact-id collision, which shouldn't happen with real uuids), re-sorted by `createdAt`. Never drops an attempt. */
function mergeAttempts(a: readonly Attempt[], b: readonly Attempt[]): Attempt[] {
  const byId = new Map<string, Attempt>()
  for (const attempt of a) byId.set(attempt.id, attempt)
  for (const attempt of b) byId.set(attempt.id, attempt)
  return [...byId.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt))
}

/** See this module's own doc comment ("A real, unavoidable approximation for Trace attempts"). */
function rawScrubberRatio(results: readonly CheckpointResult[]): number {
  if (results.length === 0) return 0
  return results.filter((result) => result.correct).length / results.length
}

interface RecomputeResult {
  rating: number
  ratedAttemptCount: number
  streak: StreakState
}

/** `sortedAttempts` must already be the full merged history in chronological order — see F24 in the Phase 5.2 plan. */
function recomputeRatingAndStreak(sortedAttempts: readonly Attempt[]): RecomputeResult {
  let rating = INITIAL_RATING
  let ratedAttemptCount = 0
  let streak: StreakState = { currentStreak: 0, longestStreak: 0, lastActiveDate: null }
  const seenDailyDates = new Set<string>()

  for (const attempt of sortedAttempts) {
    const isFirstDailyOfDay =
      attempt.mode === 'daily' && !seenDailyDates.has(attempt.localDateString)
    if (attempt.mode === 'daily' && isFirstDailyOfDay) {
      seenDailyDates.add(attempt.localDateString)
    }

    if (shouldRateAttempt(attempt.mode, isFirstDailyOfDay)) {
      const { checkpoint_results: checkpointResults } = attempt
      const actual =
        checkpointResults !== null ? rawScrubberRatio(checkpointResults) : attempt.correct
      const kMultiplier = checkpointResults !== null ? TRACE_K_MULTIPLIER : 1
      rating = updateRating(rating, attempt.puzzleRating, actual, ratedAttemptCount, kMultiplier)
      ratedAttemptCount += 1
    }

    if (attempt.mode === 'daily' && isFirstDailyOfDay) {
      streak = recordActivity(streak, attempt.localDateString)
    }
  }

  return { rating, ratedAttemptCount, streak }
}

/**
 * Migrates `remote`'s profile forward through the existing chain when it's
 * behind `CURRENT_SCHEMA_VERSION`. Re-validates the result via
 * `UserProfileSchema` (same posture as `loadProfile`/`resolveImportCandidate`
 * — a blob that fails to migrate cleanly is a real error, not something to
 * merge around) — this throws on a genuinely malformed migration result;
 * T8 catches it like any other pull failure per I2.
 */
function migrateRemoteProfileIfBehind(remote: ExportedData): UserProfile {
  if (remote.schema_version === CURRENT_SCHEMA_VERSION) return remote.profile
  const migrated = runMigrations(
    remote.profile as unknown as Record<string, unknown>,
    remote.schema_version,
    MIGRATIONS,
  )
  return UserProfileSchema.parse(migrated)
}

export function merge(local: ExportedData, remote: ExportedData): MergeOutcome {
  if (remote.schema_version > CURRENT_SCHEMA_VERSION) {
    return { kind: 'remote-ahead', remoteSchemaVersion: remote.schema_version }
  }

  const remoteProfile = migrateRemoteProfileIfBehind(remote)
  const localIsLater = local.exportedAt >= remote.exportedAt

  const attempts = mergeAttempts(local.attempts, remote.attempts)
  const { rating, ratedAttemptCount, streak } = recomputeRatingAndStreak(attempts)

  const mergedProfile: UserProfile = {
    ...mergeUnknownProfileKeys(
      local.profile as unknown as Record<string, unknown>,
      remoteProfile as unknown as Record<string, unknown>,
      localIsLater,
    ),
    schema_version: CURRENT_SCHEMA_VERSION,
    rating,
    ratedAttemptCount,
    streak,
    requeueState: localIsLater ? local.profile.requeueState : remoteProfile.requeueState,
    storagePersisted: localIsLater
      ? local.profile.storagePersisted
      : remoteProfile.storagePersisted,
    dailyCompletion: mergeDailyCompletion(
      local.profile.dailyCompletion,
      remoteProfile.dailyCompletion,
      localIsLater,
    ),
    rushStats: mergeRushStats(local.profile.rushStats, remoteProfile.rushStats),
    bestRunStreak: Math.max(local.profile.bestRunStreak, remoteProfile.bestRunStreak),
    bossStats: mergeBossStats(local.profile.bossStats, remoteProfile.bossStats),
    missionProgress: mergeMissionProgress(
      local.profile.missionProgress,
      remoteProfile.missionProgress,
      localIsLater,
    ),
    missionStats: mergeMissionStats(local.profile.missionStats, remoteProfile.missionStats),
    preferences: localIsLater ? local.profile.preferences : remoteProfile.preferences,
    anonId: local.profile.anonId,
    challengerName: localIsLater ? local.profile.challengerName : remoteProfile.challengerName,
    firstRunCompleted: local.profile.firstRunCompleted || remoteProfile.firstRunCompleted,
  }

  return {
    kind: 'merged',
    data: {
      schema_version: CURRENT_SCHEMA_VERSION,
      exportedAt: localIsLater ? local.exportedAt : remote.exportedAt,
      profile: mergedProfile,
      attempts,
    },
  }
}
