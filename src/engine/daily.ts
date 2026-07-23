/**
 * Deterministic mapping from a calendar-date string to a position in the
 * curated daily calendar (src/content/dailyCalendar.ts), so every player
 * sees the same "daily puzzle" on a given date. The date string is the only
 * time-related input — no wall-clock access here.
 */
import { daysBetween } from './streak'

/**
 * First calendar date Daily mode is considered "live" — Day #1 in the share
 * text ("Codoro Daily #N") AND, as of the curated calendar, the date whose
 * day-index (0) resolves to DAILY_CALENDAR[0]. Share numbering and puzzle
 * selection are now the same computation (getDailyNumber(d) - 1), so
 * changing this epoch reshuffles which puzzle every date serves, not just
 * the displayed number.
 *
 * Set this to the real launch date exactly once, at launch, and never
 * change it again after that — every day-index downstream (and therefore
 * every date-to-puzzle mapping already seen by a real user) is relative to
 * it. Freely adjustable pre-launch, where dailyCalendar.ts's own
 * append-only guarantee doesn't bind yet either.
 */
export const DAILY_EPOCH = '2026-01-01'

/**
 * 1-indexed "Daily #N" for the share card, and — since Day #N always serves
 * DAILY_CALENDAR[N - 1] (mod wrap) — the same number that drives selection
 * via getDailyCalendarIndex below.
 */
export function getDailyNumber(dateString: string): number {
  return daysBetween(DAILY_EPOCH, dateString) + 1
}

// True modulo (never negative), unlike JS's `%` for negative operands.
// dayIndex can be negative for dates before DAILY_EPOCH.
function positiveMod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/**
 * 0-based index into DAILY_CALENDAR (src/content/dailyCalendar.ts) for a
 * given date. Appending entries to the calendar never changes the index
 * returned for a day-index that was already within the old, shorter
 * calendar — the mapping is stable by construction, not just by convention.
 *
 * Once dayIndex runs past the end of the calendar (content authoring
 * falling behind, or — pre-launch — DAILY_EPOCH still a placeholder far in
 * the past), this wraps via modulo: a documented degraded mode that reuses
 * earlier entries rather than serving nothing. `pnpm validate:content`
 * warns when the calendar's runway is getting short.
 */
export function getDailyCalendarIndex(dateString: string, calendarLength: number): number {
  if (calendarLength <= 0) {
    throw new Error('getDailyCalendarIndex: calendarLength must be > 0')
  }

  const dayIndex = getDailyNumber(dateString) - 1
  return positiveMod(dayIndex, calendarLength)
}
