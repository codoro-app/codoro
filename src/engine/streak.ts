/**
 * Pure calendar-date-string arithmetic for streak tracking. Operates only on
 * "YYYY-MM-DD" strings — never on raw timestamps or Date.now() — so results
 * are stable regardless of the caller's timezone or DST transitions. The
 * caller is responsible for turning local wall-clock time into a date string.
 */

export interface StreakState {
  currentStreak: number
  longestStreak: number
  lastActiveDate: string | null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Parses a date-only string as UTC midnight so day-difference math never
// crosses a local-timezone DST boundary. This is an internal detail only —
// no time-of-day ever enters or leaves this module's public API.
function toUtcMidnight(dateString: string): number {
  return new Date(`${dateString}T00:00:00Z`).getTime()
}

/**
 * Signed number of calendar days from dateA to dateB (dateB - dateA).
 * Positive when dateB is after dateA, negative when it's before.
 */
export function daysBetween(dateA: string, dateB: string): number {
  return Math.round((toUtcMidnight(dateB) - toUtcMidnight(dateA)) / MS_PER_DAY)
}

export function recordActivity(state: StreakState, todayDateString: string): StreakState {
  if (state.lastActiveDate === todayDateString) {
    return { ...state }
  }

  if (state.lastActiveDate !== null && daysBetween(state.lastActiveDate, todayDateString) === 1) {
    const currentStreak = state.currentStreak + 1
    return {
      currentStreak,
      longestStreak: Math.max(state.longestStreak, currentStreak),
      lastActiveDate: todayDateString,
    }
  }

  // Covers: first-ever activity (lastActiveDate === null), gaps of 2+ days,
  // and todayDateString before lastActiveDate. The last case shouldn't occur
  // in practice, but resetting to 1 is the safe default — it can't represent
  // a real streak, so we don't silently increment.
  return {
    currentStreak: 1,
    longestStreak: Math.max(state.longestStreak, 1),
    lastActiveDate: todayDateString,
  }
}
