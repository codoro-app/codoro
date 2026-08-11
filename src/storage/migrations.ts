/**
 * Forward-only schema migration runner for persisted profiles.
 *
 * Each migration takes the raw stored object at version N and returns it at the
 * next version. The migration is responsible for stamping the new
 * `schema_version` onto the object it returns — the runner never auto-increments
 * — which keeps every migration self-describing and unit-testable in isolation.
 */
import { generateAnonId } from './anonId'

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>

/**
 * Apply migrations starting at `fromVersion`, chaining while a migration exists
 * for the current version. Stops as soon as no migration is registered for the
 * current version (that version is the target). If nothing is registered for
 * `fromVersion` at all, `raw` is returned unchanged.
 *
 * Relies on each migration setting `schema_version` on its output to advance the
 * loop; a migration that fails to do so would loop, so migrations must always
 * move the version forward.
 */
export function runMigrations(
  raw: Record<string, unknown>,
  fromVersion: number,
  migrations: Record<number, Migration>,
): Record<string, unknown> {
  let current = raw
  let version = fromVersion

  while (Object.prototype.hasOwnProperty.call(migrations, version)) {
    const migrate = migrations[version]
    if (migrate === undefined) break
    current = migrate(current)
    version = current.schema_version as number
  }

  return current
}

/**
 * v1 -> v2: adds `dailyCompletion` (nullable) for Phase 6's Daily mode —
 * see src/storage/schema.ts's UserProfile doc comment. Every existing field
 * is passed through unchanged; this migration only adds the new one.
 */
function migrateV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, schema_version: 2, dailyCompletion: null }
}

/**
 * v2 -> v3: adds `rushStats` (nullable) for Phase 7's Rush mode — see
 * src/storage/schema.ts's UserProfile doc comment. Every existing field is
 * passed through unchanged; this migration only adds the new one.
 */
function migrateV2ToV3(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, schema_version: 3, rushStats: null }
}

/**
 * v3 -> v4: a genuine no-op beyond the version bump. Phase 2's scrubber
 * interaction adds `checkpoint_results` to AttemptSchema, not to
 * UserProfileSchema — the profile's own shape doesn't change for this
 * feature, so there's nothing for this migration to add. Still bumping
 * CURRENT_SCHEMA_VERSION and registering a (no-op) migration here rather
 * than leaving v3 silently ambiguous between "before scrubber" and
 * "after scrubber" — see src/storage/schema.ts's AttemptSchema doc
 * comment for why AttemptSchema itself isn't part of this versioned
 * migration chain at all (it never has been) and how its new field
 * handles old records instead.
 */
function migrateV3ToV4(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, schema_version: 4 }
}

/**
 * v4 -> v5: Phase 5b's timer + streak-pause work (Items 6 and 8). Two
 * changes ride this single version bump rather than two sequential ones,
 * since both ship in the same PR and each is small on its own (decision 1's
 * "a few lines, not a project" standard):
 *
 * - `rushStats` resets to `null` outright. Rush's existing bestScore/
 *   bestStreak were earned under the untimed regime (no per-puzzle clock);
 *   once Item 6 ships a flat 15s clock, those numbers stop being
 *   comparable to anything earned afterward. Decision 1 is explicit: there
 *   is no real player data to preserve, so reset rather than building a
 *   dual-key untimed/timed split.
 * - `bestRunStreak` (new field, see UserProfile's own doc comment) starts
 *   at 0 for every existing profile — equivalent to "no streak-pause has
 *   fired yet," true for every profile that predates the feature.
 */
function migrateV4ToV5(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, schema_version: 5, rushStats: null, bestRunStreak: 0 }
}

/**
 * v5 -> v6: Phase 7 Item 6's retention-identity fix. `docs/v2-build-plan.md`'s
 * "Backend-ready seams" #1 has claimed since v2's plan was written that a
 * stable anonymous ID already existed "in the profile store (generate once,
 * export/import carries it)" — a scout sweep at the start of this phase
 * found that claim was never actually true; no such ID was ever generated
 * anywhere in this codebase. This migration is where every existing user
 * actually gets one, generated fresh at their next profile load after this
 * ships (the "generate once" the seam always described, just later than
 * documented). See the Phase 7 amendment for the full decision record,
 * including why this ID is attached to telemetry as a registered super
 * property rather than via `posthog.identify()`, and how import (which can
 * otherwise silently merge two different people's identity) is handled.
 */
function migrateV5ToV6(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, schema_version: 6, anonId: generateAnonId() }
}

/**
 * v6 -> v7: v3 Phase 1's Boss mode adds `bossStats` (nullable), same
 * null-until-first-run convention as `rushStats` — see
 * src/storage/schema.ts's BossStatsSchema doc comment. Every existing field
 * is passed through unchanged.
 */
function migrateV6ToV7(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, schema_version: 7, bossStats: null }
}

/**
 * Keyed by the version each migration migrates *from*. The first real entry:
 * schema v1 predates Daily mode, so any profile still on v1 gets a null
 * dailyCompletion (equivalent to "no Daily attempt recorded yet").
 */
export const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
  4: migrateV4ToV5,
  5: migrateV5ToV6,
  6: migrateV6ToV7,
}
