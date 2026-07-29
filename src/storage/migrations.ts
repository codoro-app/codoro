/**
 * Forward-only schema migration runner for persisted profiles.
 *
 * Each migration takes the raw stored object at version N and returns it at the
 * next version. The migration is responsible for stamping the new
 * `schema_version` onto the object it returns — the runner never auto-increments
 * — which keeps every migration self-describing and unit-testable in isolation.
 */

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
 * Keyed by the version each migration migrates *from*. The first real entry:
 * schema v1 predates Daily mode, so any profile still on v1 gets a null
 * dailyCompletion (equivalent to "no Daily attempt recorded yet").
 */
export const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
}
