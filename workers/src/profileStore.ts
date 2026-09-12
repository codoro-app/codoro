/**
 * S2: the ONLY module in the worker that touches `profiles.payload`. JSON
 * in, JSON out -- compression (S1) is entirely internal to this file, using
 * `CompressionStream`/`DecompressionStream` (both available in workerd).
 * Nothing else ever sees the raw compressed bytes; route handlers and
 * db.ts call `profileStore.get/put/delete`, never SELECT/INSERT the
 * `payload` column directly.
 *
 * Enforced by workers/test/static/profileStorePayloadGuard.test.ts's grep
 * guard: no other file under workers/src may contain the literal string
 * "payload".
 *
 * Why it earns its own module (from the amendment): payload is the only
 * field in the schema with unbounded per-user growth and no natural
 * retention policy, so it's the one thing that eventually moves to R2 --
 * behind this interface that move is a swap with no caller changes;
 * without it, it's a refactor of every sync path in the app.
 */

export interface ProfileMeta {
  schemaVersion: number
  revision: number
  updatedAt: number
}

export interface ProfileRecord extends ProfileMeta {
  json: unknown
}

// Verified empirically, not assumed (F7): the installed D1 binding returns
// a BLOB column from .first()/.all() as a plain `number[]` of byte values,
// not a real ArrayBuffer -- despite .bind() accepting a genuine ArrayBuffer
// on the write side. toBytes() below normalizes either shape.
interface ProfileRow {
  payload: ArrayBuffer | number[]
  schema_version: number
  revision: number
  updated_at: number
}

function toBytes(blob: ArrayBuffer | number[]): Uint8Array {
  return Array.isArray(blob) ? Uint8Array.from(blob) : new Uint8Array(blob)
}

async function compress(json: unknown): Promise<{ blob: ArrayBuffer; bytes: number }> {
  const encoded = new TextEncoder().encode(JSON.stringify(json))
  const stream = new Blob([encoded]).stream().pipeThrough(new CompressionStream('gzip'))
  const blob = await new Response(stream).arrayBuffer()
  return { blob, bytes: blob.byteLength }
}

async function decompress(blob: ArrayBuffer | number[]): Promise<unknown> {
  const stream = new Blob([toBytes(blob)]).stream().pipeThrough(new DecompressionStream('gzip'))
  const decoded = await new Response(stream).arrayBuffer()
  return JSON.parse(new TextDecoder().decode(decoded)) as unknown
}

async function get(db: D1Database, clerkUserId: string): Promise<ProfileRecord | null> {
  const row = await db
    .prepare(
      'SELECT payload, schema_version, revision, updated_at FROM profiles WHERE clerk_user_id = ?',
    )
    .bind(clerkUserId)
    .first<ProfileRow>()
  if (!row) return null
  return {
    json: await decompress(row.payload),
    schemaVersion: row.schema_version,
    revision: row.revision,
    updatedAt: row.updated_at,
  }
}

/** Upsert -- a second `put` for the same user replaces the row (T7's `PUT /api/profile` is the caller). */
async function put(
  db: D1Database,
  clerkUserId: string,
  json: unknown,
  meta: ProfileMeta,
): Promise<void> {
  const { blob, bytes } = await compress(json)
  await db
    .prepare(
      `INSERT INTO profiles (clerk_user_id, revision, schema_version, payload, payload_bytes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         revision = excluded.revision, schema_version = excluded.schema_version,
         payload = excluded.payload, payload_bytes = excluded.payload_bytes, updated_at = excluded.updated_at`,
    )
    .bind(clerkUserId, meta.revision, meta.schemaVersion, blob, bytes, meta.updatedAt)
    .run()
}

async function del(db: D1Database, clerkUserId: string): Promise<void> {
  await db.prepare('DELETE FROM profiles WHERE clerk_user_id = ?').bind(clerkUserId).run()
}

export interface PutIfMatchResult {
  ok: boolean
  /** The revision the row now has on success; the unchanged value it still has on conflict (`baseRevision`). */
  newRevision: number
}

/**
 * T7's optimistic-concurrency write. `put()` above is a blind upsert (T2's
 * own fixture-seeding helper, still used that way by profileStore.test.ts)
 * -- it doesn't check anything, so T7's route handler needs this instead:
 * `PUT /api/profile`'s conditional write, on top of the same table.
 *
 * One statement, not get-then-put: the `ON CONFLICT ... WHERE
 * profiles.revision = ?` clause is what makes this race-safe under two
 * concurrent writers racing from the same `baseRevision` (T7's DoD) --
 * SQLite/D1 resolves the upsert conflict atomically within the single
 * statement, the same pattern `db.ts`'s `recordScore` keep-best upsert
 * already relies on. `revision = profiles.revision + 1` on the update
 * branch (not `excluded.revision`) matches the plan's literal
 * `UPDATE ... SET revision = revision + 1` language -- the caller doesn't
 * supply the new revision, it's always exactly one past whatever the row
 * actually has, and the WHERE clause is what proves "whatever the row
 * actually has" still equals `expectedRevision` at write time.
 *
 * No existing row at all (first push, `expectedRevision` conventionally
 * `0`) takes the plain INSERT branch instead -- `ON CONFLICT` only
 * applies when a `clerk_user_id` collision actually occurs, so the new
 * row's `revision` there is bound directly (`expectedRevision + 1`), not
 * computed from a nonexistent previous row.
 *
 * `meta.changes === 1` is the only success signal read (F10 -- a
 * statement that matches zero rows, because the WHERE clause's revision
 * check failed, is a conflict, not quietly-ignored success).
 */
async function putIfMatch(
  db: D1Database,
  clerkUserId: string,
  json: unknown,
  meta: { schemaVersion: number; updatedAt: number },
  expectedRevision: number,
): Promise<PutIfMatchResult> {
  const { blob, bytes } = await compress(json)
  const newRevision = expectedRevision + 1
  const result = await db
    .prepare(
      `INSERT INTO profiles (clerk_user_id, revision, schema_version, payload, payload_bytes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         revision = profiles.revision + 1,
         schema_version = excluded.schema_version,
         payload = excluded.payload,
         payload_bytes = excluded.payload_bytes,
         updated_at = excluded.updated_at
       WHERE profiles.revision = ?`,
    )
    .bind(
      clerkUserId,
      newRevision,
      meta.schemaVersion,
      blob,
      bytes,
      meta.updatedAt,
      expectedRevision,
    )
    .run()
  const ok = result.meta.changes === 1
  return { ok, newRevision: ok ? newRevision : expectedRevision }
}

export const profileStore = { get, put, delete: del, putIfMatch }
