/**
 * Profile load/save with corrupt-data recovery.
 *
 * loadProfile never throws for a bad stored value: it backs the raw bytes up
 * under a `corrupt-<timestamp>` key (recoverable later) and returns a fresh
 * default, so the caller always gets a clean, working profile. saveProfile,
 * by contrast, throws loudly on invalid input — that's a programmer error, not
 * corrupted storage, and must never be silently persisted.
 *
 * `onProfileSaved` (v5 Phase 5.2, T8a): the sync engine's one hook into this
 * module. Design decision (recorded in full in
 * docs/superpowers/plans/2026-09-12-v5-phase-5.2-sync-implementation-plan.md's
 * T8 section) — "option 1, wrap saveProfile()" over "option 2, every call
 * site opts in": 20+ call sites across practice/rush/daily/boss/trace/
 * missions/firstRun/challenge/settings/SignInSheet already call
 * saveProfile() directly with no pub/sub layer in src/storage/ at all; a
 * per-call-site convention is an easy-to-miss footgun (F25) with no test
 * that catches a *missing* call the way one catches a wrong one. Wrapping
 * this one function closes that off structurally instead.
 *
 * Fires only at the end of a *successful* saveProfile() — never from this
 * module's own internal putProfile() writes inside loadProfile() (the
 * migration write-back, the corrupt-recovery reset): those are this
 * device's own local-storage self-healing, not a mutation boundary a
 * remote device needs to hear about, and firing on them would mean every
 * boot of an old client pushes a sync event before anything the *player*
 * actually did.
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

type ProfileSavedListener = (profile: UserProfile) => void

let profileSavedListeners: ProfileSavedListener[] = []

/**
 * Registers a listener fired every time `saveProfile()` succeeds. Returns
 * an unsubscribe function. No conditional branching here on purpose
 * (`filter` always runs, unconditionally) — this file sits under
 * vite.config.ts's 100%-statement/96%-branch threshold for src/storage/**,
 * and a plain filter-based unsubscribe has no branch to leave uncovered.
 */
export function onProfileSaved(listener: ProfileSavedListener): () => void {
  profileSavedListeners = [...profileSavedListeners, listener]
  return () => {
    profileSavedListeners = profileSavedListeners.filter((l) => l !== listener)
  }
}

function notifyProfileSaved(profile: UserProfile): void {
  for (const listener of profileSavedListeners) {
    try {
      listener(profile)
    } catch {
      // A misbehaving listener must never turn a *successful* persist into
      // a rejected saveProfile() call for its caller -- every one of the
      // 20+ feature call sites (BossPage.tsx and siblings) expects this
      // promise to resolve once the write itself succeeded, regardless of
      // what a sync-adjacent observer does with the news.
    }
  }
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
  // Unreached if putProfile() above threw (invalid profile) -- an exception
  // propagates straight out of the try/finally, past this line entirely, so
  // a rejected save is never announced. See this file's own top doc comment.
  notifyProfileSaved(profile)
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
      const needsMigration = raw.schema_version < CURRENT_SCHEMA_VERSION
      const upgraded = needsMigration ? runMigrations(raw, raw.schema_version, MIGRATIONS) : raw
      const validated = UserProfileSchema.parse(upgraded)
      // Persist the upgrade immediately, not just return it in memory. Every
      // migration before Phase 7's migrateV5ToV6 was a pure function of its
      // input (a version bump, a null field) — re-deriving the same result
      // from the same raw v1 bytes on every load was correct and cheap.
      // migrateV5ToV6 broke that: it mints a fresh crypto.randomUUID() on
      // every call, so re-migrating in memory on every load without ever
      // writing back would silently regenerate `anonId` every single
      // session — exactly defeating the "stable, generate once" contract
      // Item 6 exists to satisfy. A pre-merge review caught this as a
      // blocker before it shipped. Writing back here also narrows (though
      // doesn't fully close) the first-boot race where two callers both
      // observe `raw === undefined` in the same tick — the later writer
      // still wins non-deterministically, same as before this fix; that
      // narrower race is pre-existing, self-heals on the next natural
      // saveProfile, and is out of scope for this fix.
      if (needsMigration) {
        await putProfile(db, validated)
      }
      return validated
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
