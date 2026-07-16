/**
 * IndexedDB connection wrapper (via `idb`).
 *
 * Deliberately NOT cached in a module-level singleton: repeat openDB calls
 * against an already-open, same-version database are cheap (no upgrade re-run),
 * and skipping the cache keeps tests honest — they reset state with deleteDB
 * between cases, which a cached open connection would silently defeat.
 */
import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'

export const DB_NAME = 'codoro'
export const DB_VERSION = 1
export const PROFILE_STORE = 'profile'
export const ATTEMPTS_STORE = 'attempts'
/** Out-of-line key under which the single live profile record is stored. */
export const PROFILE_KEY = 'current'

export async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Out-of-line keys: profile records are written with explicit string keys
      // (PROFILE_KEY, plus corrupt-<timestamp> backups on recovery).
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE)
      }
      if (!db.objectStoreNames.contains(ATTEMPTS_STORE)) {
        db.createObjectStore(ATTEMPTS_STORE, { keyPath: 'id' })
      }
    },
  })
}
