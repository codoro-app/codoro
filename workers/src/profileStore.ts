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

export const profileStore = { get, put, delete: del }
