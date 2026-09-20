/**
 * Pure logic for the free-tier weekly coach meter — spec §6, "metered
 * taste, not a time trial." Operates on `CoachMeter` (src/storage/schema.ts)
 * without touching storage itself; callers (the session hooks) read/persist
 * the profile and call these functions to decide what to show and what to
 * write back.
 *
 * Mirrors `dailyCompletion`'s live-comparison convention (see
 * CoachMeterSchema's own doc comment): `weekStart` is only ever compared
 * against the CURRENT week boundary at read time, never proactively reset by
 * a job. A stale `weekStart` — including the `''` sentinel every profile
 * starts with — simply reads as "0 used this week."
 */
import type { CoachMeter } from '../storage'

/** Spec §6/§11: "3 per week" — the settled recommendation, not yet a Setting. */
export const WEEKLY_COACH_LIMIT = 3

/**
 * The ISO date (YYYY-MM-DD) of the Monday that starts the UTC week
 * containing `date`. UTC, not local time — "resetting on a fixed UTC weekly
 * boundary" per the build prompt's settled decisions, so the meter resets at
 * the same instant for every player regardless of timezone (unlike
 * `dailyCompletion`'s `localDateString`, which is deliberately per-device
 * local time — a weekly meter has no equivalent "player's own day" concept
 * to respect).
 */
export function currentUtcWeekStart(date: Date): string {
  const utcDay = date.getUTCDay() // 0 (Sun) .. 6 (Sat)
  const daysSinceMonday = (utcDay + 6) % 7
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday),
  )
  return monday.toISOString().slice(0, 10)
}

/** How many coach explanations `meter` has used against the CURRENT week — 0 if its stored week has rolled over. */
function usedThisWeek(meter: CoachMeter, now: Date): number {
  return meter.weekStart === currentUtcWeekStart(now) ? meter.used : 0
}

/** How many coach explanations remain this week, floored at 0 (never negative). */
export function coachMeterRemaining(meter: CoachMeter, now: Date): number {
  return Math.max(0, WEEKLY_COACH_LIMIT - usedThisWeek(meter, now))
}

/**
 * Records one coach explanation shown, rolling `meter` onto the current
 * week first if its stored week has lapsed. Callers only invoke this when a
 * viewer is NOT entitled (see PuzzleCardShellProps' `onCoachExplanationShown`
 * doc comment) — an entitled viewer's usage is never metered, so this
 * function has no entitlement awareness of its own; that decision lives at
 * the call site.
 */
export function consumeCoachMeterUse(meter: CoachMeter, now: Date): CoachMeter {
  const weekStart = currentUtcWeekStart(now)
  return { weekStart, used: usedThisWeek(meter, now) + 1 }
}
