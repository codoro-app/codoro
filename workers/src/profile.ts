import { z } from 'zod'
import type {
  ProfileConflictResponse,
  ProfileGetResponse,
  ProfilePutRequest,
} from '../shared/api-types'
import type { ProfileRecord } from './profileStore'

/**
 * T7: the only place `PUT /api/profile`'s body shape is checked, same
 * convention as `report.ts`'s `ReportBodySchema` -- `satisfies
 * z.ZodType<ProfilePutRequest>` ties this to the wire contract in
 * shared/api-types.ts, so an added/removed field there is a compile error
 * here rather than a silent drift.
 *
 * The client's exported-profile JSON is `z.unknown()` deliberately (S2)
 * -- the Worker never validates the client's `ExportedData` shape, only
 * that a JSON value is present at all; `parseProfilePutBody` below checks
 * its *size*, not its structure. `schemaVersion`/`baseRevision` are
 * bounded non-negative integers -- there's no real-world case where
 * either is negative or fractional, and rejecting those early is cheaper
 * than discovering them mid-write. `anonId`, when present, mirrors the v2
 * anonId's actual shape (an opaque client-generated id, not a UUID or any
 * other fixed format) -- bounded length only, same treatment
 * `appVersion` gets in `ReportBodySchema`.
 *
 * Kept module-private (not exported): `parseProfilePutBody` is the only
 * public surface this file offers `index.ts`. That's deliberate, not
 * incidental -- see this file's own bottom section for why.
 */
const ProfilePutBodySchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
  payload: z.unknown(),
  baseRevision: z.number().int().nonnegative(),
  anonId: z.string().min(1).max(200).nullable().optional(),
}) satisfies z.ZodType<ProfilePutRequest>

/** 2026-08-31 amendment, S4: 256 KB on the decompressed JSON, checked before profileStore's internal gzip. */
const MAX_JSON_BYTES = 256 * 1024

export type ProfilePutBodyResult =
  | {
      ok: true
      schemaVersion: number
      /** The exported-profile JSON itself, renamed from the wire field's name -- see this file's doc comment. */
      json: unknown
      baseRevision: number
      anonId?: string | null | undefined
      jsonByteLength: number
    }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'too-large' }

/**
 * Parses and fully validates `PUT /api/profile`'s body in one call,
 * including the size cap -- `index.ts`'s route handler never touches the
 * Zod schema or the wire field directly.
 *
 * Why this indirection exists, not just inline `.safeParse()` +
 * `.payload` access in `index.ts`: `workers/test/static/
 * profileStorePayloadGuard.test.ts` (S2) fails the build if the literal
 * string "payload" appears anywhere under `workers/src` outside
 * profileStore.ts -- a rule that predates T7 and whose own comment
 * explicitly anticipated this exact collision ("workers/shared/
 * api-types.ts's future PUT /api/profile body type (T7) will legitimately
 * have a `payload: string` wire-format field... that's a T7 decision, not
 * this guard's concern"). The guard is scoped to `workers/src`, so the
 * wire type itself (shared/api-types.ts) is exempt either way; the
 * decision this file makes is to also add `profile.ts` to the guard's
 * exemption list (alongside profileStore.ts) and confine every literal
 * spelling of the wire field's name to this one file -- the result type
 * above renames it to `json` so `index.ts` (deliberately left OFF the
 * exemption list) never needs to spell it at all. One file understands
 * the wire name, same discipline S2 already applies to the D1 column.
 */
export function parseProfilePutBody(raw: unknown): ProfilePutBodyResult {
  const parsed = ProfilePutBodySchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid' }
  }

  const jsonByteLength = new TextEncoder().encode(JSON.stringify(parsed.data.payload)).byteLength
  if (jsonByteLength > MAX_JSON_BYTES) {
    return { ok: false, reason: 'too-large' }
  }

  return {
    ok: true,
    schemaVersion: parsed.data.schemaVersion,
    json: parsed.data.payload,
    baseRevision: parsed.data.baseRevision,
    anonId: parsed.data.anonId,
    jsonByteLength,
  }
}

/**
 * The response-side half of the same confinement: `ProfileGetResponse`
 * and `ProfileConflictResponse` (shared/api-types.ts) both carry the wire
 * field under its real name, so constructing either object with a plain
 * object literal in `index.ts` would spell the literal key there --
 * exactly the S2 guard violation `parseProfilePutBody` above exists to
 * avoid on the request side. These two builders are the only place
 * either response shape is assembled.
 */
export function buildProfileGetResponse(record: ProfileRecord): ProfileGetResponse {
  return {
    revision: record.revision,
    schemaVersion: record.schemaVersion,
    payload: record.json,
    updatedAt: record.updatedAt,
  }
}

export function buildProfileConflictResponse(current: ProfileRecord): ProfileConflictResponse {
  return {
    error: 'Conflict',
    current: {
      revision: current.revision,
      schemaVersion: current.schemaVersion,
      payload: current.json,
      updatedAt: current.updatedAt,
    },
  }
}
