/**
 * Profile load/save with corrupt-data recovery.
 *
 * loadProfile never throws for a bad stored value: it backs the raw bytes up
 * under a `corrupt-<timestamp>` key (recoverable later) and returns a fresh
 * default, so the caller always gets a clean, working profile. saveProfile,
 * by contrast, throws loudly on invalid input — that's a programmer error, not
 * corrupted storage, and must never be silently persisted.
 */
import type { IDBPDatabase } from 'idb'
import { PROFILE_KEY, PROFILE_STORE, getDb } from './db'
import { CURRENT_SCHEMA_VERSION, UserProfileSchema, createDefaultProfile } from './schema'
import type { UserProfile } from './schema'
import { MIGRATIONS, runMigrations } from './migrations'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function putProfile(db: IDBPDatabase, profile: UserProfile): Promise<void> {
  const validated = UserProfileSchema.parse(profile)
  await db.put(PROFILE_STORE, validated, PROFILE_KEY)
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  const db = await getDb()
  try {
    await putProfile(db, profile)
  } finally {
    // Open-use-close: getDb never caches, so each operation owns and releases
    // its own connection. Leaving connections open would block deleteDB (the
    // test-reset seam) and needlessly hold a handle in production.
    db.close()
  }
}

export async function loadProfile(): Promise<UserProfile> {
  const db = await getDb()
  try {
    const raw: unknown = await db.get(PROFILE_STORE, PROFILE_KEY)

    // First-ever load: nothing stored yet. Seed and persist a fresh default.
    if (raw === undefined) {
      const fresh = createDefaultProfile()
      await putProfile(db, fresh)
      return fresh
    }

    try {
      if (!isPlainObject(raw) || typeof raw.schema_version !== 'number') {
        throw new Error('stored profile is not a versioned object')
      }
      const upgraded =
        raw.schema_version < CURRENT_SCHEMA_VERSION
          ? runMigrations(raw, raw.schema_version, MIGRATIONS)
          : raw
      return UserProfileSchema.parse(upgraded)
    } catch {
      // Corrupt: preserve the raw bytes under a distinct key, then reset.
      const backupKey = `corrupt-${new Date().toISOString()}`
      await db.put(PROFILE_STORE, raw, backupKey)
      const fresh = createDefaultProfile()
      await putProfile(db, fresh)
      return fresh
    }
  } finally {
    db.close()
  }
}
