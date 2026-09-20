/**
 * The single injectable predicate the coach layer's UI gates on — v6 Phase
 * 6.1's deliberately narrow seam for Phase 6.2 (entitlements + Stripe).
 *
 * Hardcoded `false`: entitlement doesn't exist yet (spec §7, Phase 6.2).
 * Every free/signed-out viewer today is on the metered path (see
 * coachMeter.ts) regardless of who they are — there is no paid tier to be
 * entitled to. No UI code anywhere depends on how this is implemented; it's
 * called, never inlined, so 6.2 swaps the body for a real check (cached
 * `GET /api/entitlement` result, 7-day fail-open grace window per F36) and
 * nothing else in the coach layer changes.
 */
export function isEntitledToCoach(): boolean {
  return false
}
