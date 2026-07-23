/**
 * Public entry point for the storage layer.
 *
 * Everything outside src/storage/ must import from here, never from
 * db.ts/schema.ts/migrations.ts directly — those are implementation details
 * (connection management, Zod schemas, the migration runner) not part of the
 * public contract.
 *
 * Barrel exports only — no logic lives here.
 */
export { createDefaultProfile } from './schema'
export type { UserProfile, Attempt, RushStats } from './schema'

export { loadProfile, saveProfile } from './profile'
export { appendAttempt, listAttempts } from './attempts'
export { requestPersistentStorage } from './persist'
export { exportData, importData } from './exportImport'
export type { ExportedData } from './exportImport'
