/**
 * Pure TS: rating, selection, streak, requeue.
 * NO React or DOM imports — enforced by eslint.config.js's
 * no-restricted-imports rule scoped to this folder.
 *
 * Phase 1 fills this in with rating.ts, selection.ts, streak.ts,
 * requeue.ts, daily.ts. This placeholder just proves the boundary
 * and the test pipeline both work end to end.
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new Error('clamp: min must be <= max')
  }
  return Math.min(Math.max(value, min), max)
}
