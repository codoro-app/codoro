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
