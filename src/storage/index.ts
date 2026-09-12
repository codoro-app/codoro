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
export { createDefaultProfile, DEFAULT_PREFERENCES, MISSION_STAGE_ORDER } from './schema'
export type {
  UserProfile,
  Attempt,
  RushStats,
  BossStats,
  MissionStageId,
  MissionStageStats,
  MissionStageSummary,
  MissionProgress,
  MissionStats,
  Preferences,
} from './schema'

export { loadProfile, saveProfile } from './profile'
export { appendAttempt, listAttempts } from './attempts'
export { requestPersistentStorage } from './persist'
export { exportData, importData, resolveImportCandidate, commitImport } from './exportImport'
export type { ExportedData, ImportCandidate } from './exportImport'
export { CURRENT_SCHEMA_VERSION, UserProfileSchema } from './schema'
// T6 (v5 sync merge engine, src/sync/merge.ts): the schema-skew branch reuses
// this exact migration chain rather than a sync-specific migrator (per the
// Phase 5.2 plan) -- exported here, not imported from './migrations' directly,
// so that stays true to this file's own "never import db.ts/schema.ts/
// migrations.ts directly" rule above.
export { runMigrations, MIGRATIONS } from './migrations'
export type { Migration } from './migrations'
