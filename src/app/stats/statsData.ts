/**
 * Stats page (v3 Phase 2b.7): pure derived-data functions over the existing
 * Attempt log + UserProfile — no new persisted fields, same "derive, don't
 * store" approach `../homeActivity.ts` already established for Home's
 * recent-activity/rating-trend summaries. Kept in its own module (not
 * homeActivity.ts) since these shapes are Stats-page-specific.
 *
 * `dateString` duplicates Home.tsx's/usePracticeSession.ts's own local
 * helper of the same shape verbatim (local calendar date, not UTC) rather
 * than extracting a shared util — matches this repo's established
 * convention of small per-consumer date helpers (useDailySession.ts,
 * useRushSession.ts, useBossSession.ts, useTraceSession.ts each keep their
 * own copy too).
 */
import type { Attempt, UserProfile } from '../../storage'

function dateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export interface RatingHistoryPoint {
  date: string
  rating: number
}

/** 7 or 30 trailing days, or `null` for all-time — the Stats page's window toggle. */
export type RatingWindowDays = 7 | 30 | null

/**
 * One point per calendar day with >=1 attempt: that day's *last* recorded
 * `userRatingAfter` (a "daily close"), not one point per attempt — keeps the
 * line readable after hundreds of solves. `attempts` must already be in
 * chronological (oldest-first) order, matching `listAttempts()`'s contract
 * (the same assumption `mastery.ts`'s `computeMastery` makes) — this
 * function does not re-sort its input. Returned points are sorted ascending
 * by date.
 */
export function getRatingHistory(
  attempts: readonly Attempt[],
  windowDays: RatingWindowDays,
  nowIso: string,
): RatingHistoryPoint[] {
  const dailyClose = new Map<string, number>()
  for (const a of attempts) {
    dailyClose.set(a.localDateString, a.userRatingAfter)
  }

  const cutoff =
    windowDays === null ? null : new Date(nowIso).getTime() - windowDays * 24 * 60 * 60 * 1000

  return Array.from(dailyClose.entries())
    .map(([date, rating]) => ({ date, rating }))
    .filter((point) => cutoff === null || new Date(point.date).getTime() >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface ActivityDay {
  date: string
  active: boolean
}

/** Trailing weeks shown in the activity calendar (12 * 7 = 84 days, ending today). */
export const ACTIVITY_CALENDAR_WEEKS = 12

/**
 * Exactly `ACTIVITY_CALENDAR_WEEKS * 7` entries, oldest first, ending on
 * `nowIso`'s local calendar date. `active` is true when >=1 attempt shares
 * that day's `localDateString`.
 */
export function getActivityCalendar(attempts: readonly Attempt[], nowIso: string): ActivityDay[] {
  const activeDates = new Set(attempts.map((a) => a.localDateString))
  const totalDays = ACTIVITY_CALENDAR_WEEKS * 7
  const now = new Date(nowIso)

  const days: ActivityDay[] = []
  for (let i = totalDays - 1; i >= 0; i -= 1) {
    const day = new Date(now)
    day.setDate(day.getDate() - i)
    const date = dateString(day)
    days.push({ date, active: activeDates.has(date) })
  }
  return days
}

export interface LifetimeTotals {
  solved: number
  bestStreak: number
  totalTimeMs: number
  modesPlayed: number
}

/**
 * `bestStreak` reads `profile.streak.longestStreak` directly — already
 * persisted, not re-derived from attempts.
 */
export function getLifetimeTotals(
  attempts: readonly Attempt[],
  profile: UserProfile,
): LifetimeTotals {
  return {
    solved: attempts.length,
    bestStreak: profile.streak.longestStreak,
    totalTimeMs: attempts.reduce((sum, a) => sum + a.time_ms, 0),
    modesPlayed: new Set(attempts.map((a) => a.mode)).size,
  }
}
