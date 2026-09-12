/**
 * Every JSON shape the API contract defines, in one place — imported by
 * both the Worker and (from Phase 5.1 on) the client via the pnpm
 * workspace. Adding a field means editing this file first; both sides then
 * get a compile error pointing at everywhere else that needs updating,
 * rather than a silently-drifting duplicate (see the API contract table in
 * docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md).
 *
 * Only the health check exists as of T1. The rest of the contract's types
 * land alongside the endpoints that need them (T7, T9, T10, T12...) — an
 * empty placeholder type with no caller is worse than no type at all.
 */

/** `GET /api/health` — unauthenticated deploy sanity + uptime check. */
export interface HealthResponse {
  ok: true
  /** The deployed Worker's version — see index.ts for how it's derived. */
  version: string
  /**
   * Which Clerk instance this deployment is paired with (F1's one-curl
   * diagnostic): a `pk_test_` client talking to a Worker configured for
   * `production` should be obviously wrong from this field alone, without
   * needing to decode a JWT first.
   */
  clerkInstance: 'development' | 'production'
}

/** Every error response in the API, whatever the status code. */
export interface ApiErrorResponse {
  error: string
}

/**
 * T4a: `POST /api/report`'s fixed reason enum. This is the ONE place it's
 * written -- `reports`' own `CHECK` constraint (migration 0001) and
 * `report.ts`'s Zod schema are both built from (or asserted against) this
 * same array, not a hand-copied list, so the three can't silently drift.
 */
export const REPORT_REASONS = [
  'wrong-answer',
  'unclear',
  'renders-broken',
  'typo',
  'other',
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

/**
 * `POST /api/report`'s request body. Unauthenticated by design (T4a) --
 * guest-first is law and most reporters will not have accounts. No
 * free-text field: `reason` is a closed enum, `puzzleId` is checked
 * against the real content index, `appVersion` is an opaque diagnostic
 * string (not validated against a format -- it's never interpreted, only
 * stored for later triage).
 */
export interface ReportRequest {
  puzzleId: string
  reason: ReportReason
  appVersion: string
}

/** `POST /api/report`'s success response. */
export interface ReportResponse {
  ok: true
}

/**
 * T7: `PUT`/`GET /api/profile`'s request/response shapes. `payload` is
 * opaque `unknown` on purpose (S2) -- the Worker stores and returns it
 * byte-for-byte, it never interprets the client's `ExportedData` shape.
 *
 * No `clientUpdatedAt` field, unlike the original plan's PUT body
 * description -- T6's merge engine (src/sync/merge.ts) already found this
 * field doesn't exist anywhere in the client schema; the one real
 * timestamp the client has is `ExportedData.exportedAt`, which isn't part
 * of the sync-concurrency contract itself, so it isn't part of this wire
 * shape either. `updatedAt` in the response is the *server's* write-time
 * clock (set by the route handler, not echoed from the client).
 */
export interface ProfilePutRequest {
  schemaVersion: number
  payload: unknown
  /**
   * The revision this client last saw. `0` means "I believe no server
   * row exists yet" -- the sentinel that lets the very first push from a
   * device use the same optimistic-concurrency path as every later one
   * (profileStore.ts's `putIfMatch`).
   */
  baseRevision: number
  /**
   * The v2 anonId to link, first push only. First-write-wins (T7's DoD):
   * once `users.linked_anon_id` is non-null, later values are ignored,
   * never overwritten.
   */
  // `| undefined` alongside the `?` is deliberate, not redundant: under
  // exactOptionalPropertyTypes, `anonId?: string | null` and
  // `anonId?: string | null | undefined` are different types -- the
  // former forbids an explicitly-present `undefined` value, which is
  // exactly what Zod's `.optional()` produces in its inferred output
  // type (found via tsc: `satisfies z.ZodType<ProfilePutRequest>` in
  // profile.ts failed without this). JSON itself never carries a literal
  // `undefined`, so this is a TS-level accommodation only, not a wire
  // contract change.
  anonId?: string | null | undefined
}

export interface ProfilePutResponse {
  ok: true
  revision: number
}

/**
 * 409 body -- carries the current server state so the client can run it
 * through T6's merge engine locally and retry, without a second round
 * trip just to fetch what it already just conflicted against.
 */
export interface ProfileConflictResponse {
  error: 'Conflict'
  current: {
    revision: number
    schemaVersion: number
    payload: unknown
    updatedAt: number
  }
}

/** `GET /api/profile`'s success response. `404` (no body) if no row yet. */
export interface ProfileGetResponse {
  revision: number
  schemaVersion: number
  payload: unknown
  updatedAt: number
}
