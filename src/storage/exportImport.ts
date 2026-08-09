/**
 * Full-state export/import as a single JSON document.
 *
 * importData validates the entire payload before writing anything: a
 * malformed or tampered file must be rejected wholesale, never partially
 * applied. The write itself spans both stores in one `idb` transaction so a
 * mid-write failure can't leave profile and attempts out of sync.
 *
 * `resolveImportCandidate`/`commitImport` below (Phase 7) are a deliberate
 * addition, not a modification of `exportData`/`importData` above — the
 * Phase 7 brief says "do not modify the storage functions... if you find
 * yourself wanting to, that's a finding to report, not a change to make."
 * The finding: `importData` has no migration step at all (unlike
 * `loadProfile`, which runs `runMigrations` before validating a raw
 * IndexedDB read — see profile.ts), so an export file from an older
 * `CURRENT_SCHEMA_VERSION` currently fails `UserProfileSchema`'s literal
 * version check and is rejected — indistinguishable from a genuinely
 * corrupt file. The Phase 7 DoD requires a *legible, working* state for
 * exactly that case ("a valid blob at an older version that needs
 * migration"), so this pair adds it without touching the locked functions:
 * `resolveImportCandidate` is a pure, read-only preview (parses, migrates
 * a stale profile forward via the same `runMigrations`/`MIGRATIONS` chain
 * `loadProfile` already uses, and validates) that the Settings UI calls to
 * render its confirm dialog *before* anything is written; `commitImport`
 * does the actual write, given already-validated data. Its transaction body
 * intentionally duplicates `importData`'s few lines rather than factoring
 * them into a shared helper `importData` would then call — a small,
 * deliberate duplication, chosen over touching a function this data-
 * integrity-critical after it already has passing tests.
 */
import { z } from 'zod'
import { ATTEMPTS_STORE, PROFILE_KEY, PROFILE_STORE, getDb } from './db'
import { AttemptSchema, CURRENT_SCHEMA_VERSION, UserProfileSchema } from './schema'
import type { Attempt, UserProfile } from './schema'
import { listAttempts } from './attempts'
import { loadProfile } from './profile'
import { MIGRATIONS, runMigrations } from './migrations'

export interface ExportedData {
  schema_version: number
  exportedAt: string
  profile: UserProfile
  attempts: Attempt[]
}

const ExportedDataSchema = z.object({
  schema_version: z.number(),
  exportedAt: z.string(),
  profile: UserProfileSchema,
  attempts: z.array(AttemptSchema),
})

export async function exportData(): Promise<string> {
  const [profile, attempts] = await Promise.all([loadProfile(), listAttempts()])
  const data: ExportedData = {
    schema_version: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
    attempts,
  }
  return JSON.stringify(data, null, 2)
}

export async function importData(json: string): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Import failed: invalid JSON (${message})`, { cause: err })
  }

  const result = ExportedDataSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Import failed: ${result.error.message}`)
  }
  const { profile, attempts } = result.data

  const db = await getDb()
  try {
    const tx = db.transaction([PROFILE_STORE, ATTEMPTS_STORE], 'readwrite')
    await tx.objectStore(ATTEMPTS_STORE).clear()
    await tx.objectStore(PROFILE_STORE).put(profile, PROFILE_KEY)
    await Promise.all(attempts.map((attempt) => tx.objectStore(ATTEMPTS_STORE).put(attempt)))
    await tx.done
  } finally {
    db.close()
  }
}

/**
 * The four legible states a Settings-page import flow needs, matching the
 * standard `/puzzle/:id`'s bad-id branch and 5c's broken-link state already
 * carry: not JSON at all, JSON but not shaped like an export, a version
 * newer than this app understands, and a version older than current (which
 * `ok` below folds in transparently via `migratedFromVersion` — a
 * successful migration isn't an error state, it's a successful import with
 * a note).
 */
export type ImportCandidate =
  | { status: 'invalid-json' }
  | { status: 'not-export-blob' }
  | { status: 'unknown-version'; foundVersion: number }
  | { status: 'ok'; data: ExportedData; migratedFromVersion: number | null }

/**
 * Read-only preview: parses and fully validates a candidate import file
 * *without writing anything*, so the Settings UI can render its
 * confirm-overwrite dialog (current vs. incoming rating/attempts/streak)
 * before the player commits to replacing their data. See this file's own
 * top doc comment for why this exists as a new function rather than a
 * change to `importData`.
 */
export function resolveImportCandidate(json: string): ImportCandidate {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { status: 'invalid-json' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { status: 'not-export-blob' }
  }
  const envelope = parsed as Record<string, unknown>
  if (typeof envelope.schema_version !== 'number') {
    return { status: 'not-export-blob' }
  }
  const foundVersion = envelope.schema_version

  if (foundVersion > CURRENT_SCHEMA_VERSION) {
    return { status: 'unknown-version', foundVersion }
  }

  if (foundVersion < CURRENT_SCHEMA_VERSION) {
    // Mirrors profile.ts's loadProfile: migrate the nested profile object
    // forward through the same registered chain, then validate the whole
    // envelope as if it had always been on the current version. An export
    // file's envelope schema_version and its nested profile.schema_version
    // have always been written equal (see exportData above), so migrating
    // from the envelope's version is equivalent to migrating from the
    // profile's own.
    const rawProfile = envelope.profile
    if (typeof rawProfile !== 'object' || rawProfile === null) {
      return { status: 'not-export-blob' }
    }
    const migratedProfile = runMigrations(
      rawProfile as Record<string, unknown>,
      foundVersion,
      MIGRATIONS,
    )
    const migratedEnvelope = {
      ...envelope,
      schema_version: CURRENT_SCHEMA_VERSION,
      profile: migratedProfile,
    }
    // `attempts` deliberately rides this same version gate rather than
    // getting its own migration path — AttemptSchema has never carried a
    // schema_version (see its own doc comment in schema.ts) and re-
    // validates as-is here. Safe today because every AttemptSchema field
    // added since v1 is nullable-with-default; the day a *required*
    // Attempt field is added, an old export will fail here as
    // 'not-export-blob' with no signal that the real cause was age, not
    // corruption — worth a real migration path at that point, not before.
    const result = ExportedDataSchema.safeParse(migratedEnvelope)
    if (!result.success) {
      // Either genuinely corrupt, or an older version than MIGRATIONS
      // actually reaches — both read the same to a player: this file
      // can't be imported.
      return { status: 'not-export-blob' }
    }
    return { status: 'ok', data: result.data, migratedFromVersion: foundVersion }
  }

  const result = ExportedDataSchema.safeParse(envelope)
  if (!result.success) {
    return { status: 'not-export-blob' }
  }
  return { status: 'ok', data: result.data, migratedFromVersion: null }
}

/**
 * Writes an already-validated import candidate (from `resolveImportCandidate`
 * with `status: 'ok'`) atomically, same guarantee as `importData`'s own
 * transaction: both stores in one `idb` transaction, so a mid-write failure
 * can't leave profile and attempts out of sync, and nothing here re-validates
 * (the caller already has a fully-parsed `ExportedData`).
 *
 * The import collision (Phase 7 Item 6): `data.profile.anonId` is the
 * *importer's* device ID (or whatever device originally exported the file),
 * never this device's own. Writing it verbatim would silently merge two
 * different people's telemetry identity in PostHog the moment a player
 * imports a friend's export — exactly the failure mode Item 6 exists to
 * avoid. This device's own `anonId` (read via `loadProfile`, which seeds a
 * fresh one via `createDefaultProfile` if this is a brand-new device with
 * no profile yet) is preserved across every import instead: the physical
 * device doing the importing keeps being counted as the same returning
 * device it always was, regardless of whose rating/history it just adopted.
 */
export async function commitImport(data: ExportedData): Promise<void> {
  const currentProfile = await loadProfile()
  const profileToWrite: UserProfile = { ...data.profile, anonId: currentProfile.anonId }

  const db = await getDb()
  try {
    const tx = db.transaction([PROFILE_STORE, ATTEMPTS_STORE], 'readwrite')
    await tx.objectStore(ATTEMPTS_STORE).clear()
    await tx.objectStore(PROFILE_STORE).put(profileToWrite, PROFILE_KEY)
    await Promise.all(data.attempts.map((attempt) => tx.objectStore(ATTEMPTS_STORE).put(attempt)))
    await tx.done
  } finally {
    db.close()
  }
}
