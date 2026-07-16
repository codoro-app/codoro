# storage/

IndexedDB wrapper (via `idb`), migrations, export/import. Built out in Phase 2.

Public API is `src/storage/index.ts` — the only file anything outside this
folder should import from: `createDefaultProfile`, `loadProfile`/`saveProfile`,
`appendAttempt`/`listAttempts`, `requestPersistentStorage`,
`exportData`/`importData`, plus the `UserProfile`/`Attempt`/`ExportedData`
types. `db.ts`, `schema.ts`, and `migrations.ts` are internal — their Zod
schemas and connection helpers are not re-exported.

Persisted profiles carry a `schema_version`; `migrations.ts` holds a
forward-only chain of version-N-to-N+1 migrations run before schema
validation on every load. Corrupt or invalid stored data never throws:
`loadProfile` backs up unreadable bytes under a `corrupt-<timestamp>` key and
returns a fresh default profile, and `listAttempts` silently drops individual
attempt rows that fail validation rather than failing the whole list.
`importData` validates a full export before writing anything, so a malformed
or tampered import file is rejected wholesale instead of partially applied.
