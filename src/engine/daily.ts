/**
 * Deterministic mapping from a calendar-date string to a puzzle-pool index,
 * so every player sees the same "daily puzzle" on a given date. The date
 * string is the only time-related input — no wall-clock access here.
 */

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
