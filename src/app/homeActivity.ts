/**
 * Home 2b.5: two derived-data summaries computed from the existing Attempts
 * log — no new UserProfile fields, no backend. Pure functions, no React/DOM,
 * so they're unit-testable without rendering — Home.tsx wires them into the
 * existing `listAttempts()` read alongside `loadProfile()`.
 */
import type { Attempt } from '../storage'
import type { AttemptMode } from '../engine'

export interface RecentActivity {
  mode: AttemptMode
  correct: number
  total: number
  ratingDelta: number
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Summarizes the trailing run of attempts sharing the most recent attempt's
 * mode — e.g. a Rush run followed by a Daily attempt reports only the Daily
 * attempt (a run of 1), not a blended Rush+Daily total. `attempts` is
 * expected pre-sorted ascending by createdAt, matching listAttempts()'s
 * contract.
 */
export function getRecentActivity(attempts: Attempt[]): RecentActivity | null {
  const last = attempts[attempts.length - 1]
  if (last === undefined) return null

  let startIndex = attempts.length - 1
  while (startIndex > 0) {
    const prev = attempts[startIndex - 1]
    if (prev?.mode !== last.mode) break
    startIndex -= 1
  }
  const run = attempts.slice(startIndex)
  const runFirst = run[0]
  const runLast = run[run.length - 1]
  // Unreachable: `run` always contains at least `last`, so both are defined.
  // The check exists only to satisfy noUncheckedIndexedAccess.
  if (runFirst === undefined || runLast === undefined) return null

  return {
    mode: last.mode,
    correct: run.filter((a) => a.correct).length,
    total: run.length,
    ratingDelta: runLast.userRatingAfter - runFirst.userRatingBefore,
  }
}

/**
 * Net rating change across attempts within the last 7 days of `nowIso`, or
 * null when there's no activity in that window. `nowIso` is a parameter
 * (not an internal Date.now()) so callers control the clock in tests.
 */
export function getRatingTrend(attempts: Attempt[], nowIso: string): number | null {
  const cutoff = new Date(nowIso).getTime() - SEVEN_DAYS_MS
  const recent = attempts.filter((a) => new Date(a.createdAt).getTime() >= cutoff)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (first === undefined || last === undefined) return null

  return last.userRatingAfter - first.userRatingBefore
}
