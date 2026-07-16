/**
 * Full-state export/import as a single JSON document.
 *
 * importData validates the entire payload before writing anything: a
 * malformed or tampered file must be rejected wholesale, never partially
 * applied. The write itself spans both stores in one `idb` transaction so a
 * mid-write failure can't leave profile and attempts out of sync.
 */
import { z } from 'zod'
import { ATTEMPTS_STORE, PROFILE_KEY, PROFILE_STORE, getDb } from './db'
import { AttemptSchema, CURRENT_SCHEMA_VERSION, UserProfileSchema } from './schema'
import type { Attempt, UserProfile } from './schema'
import { listAttempts } from './attempts'
import { loadProfile } from './profile'

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
