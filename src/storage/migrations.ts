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
 * Empty by design: CURRENT_SCHEMA_VERSION is 1 and this app has no version 0 in
 * its real history, so there is nothing to migrate from yet. The first real
 * schema bump adds an entry here keyed by the version it migrates *from*.
 */
export const MIGRATIONS: Record<number, Migration> = {}
