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
