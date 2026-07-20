/**
 * Deterministic mapping from a calendar-date string to a puzzle-pool index,
 * so every player sees the same "daily puzzle" on a given date. The date
 * string is the only time-related input — no wall-clock access here.
 */
import { daysBetween } from './streak'

/**
 * First calendar date Daily mode is considered "live" — Day #1 in the share
 * text ("Codoro Daily #N"). Purely cosmetic: changing this only shifts the
 * displayed day number, never which puzzle is served (that's keyed off the
 * date string itself via getDailyPuzzleIndex, independent of this constant).
 * Update to the real launch date before shipping.
 */
export const DAILY_EPOCH = '2026-01-01'

/** 1-indexed "Daily #N" for the share card. Not used for puzzle selection. */
export function getDailyNumber(dateString: string): number {
  return daysBetween(DAILY_EPOCH, dateString) + 1
}

// FNV-1a, 32-bit. Simple, well-known, good-enough distribution for this
// non-cryptographic use case.
export function hashDateString(dateString: string): number {
  let hash = 0x811c9dc5

  for (let i = 0; i < dateString.length; i++) {
    hash ^= dateString.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

export function getDailyPuzzleIndex(dateString: string, poolSize: number): number {
  if (poolSize <= 0) {
    throw new Error('getDailyPuzzleIndex: poolSize must be > 0')
  }

  return hashDateString(dateString) % poolSize
}
