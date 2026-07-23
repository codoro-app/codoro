/**
 * Dev-only switch: swap the real puzzle pool for DEV_STUB_PUZZLES (see
 * src/content/devPuzzles.ts) — a handful of trivial, unambiguous puzzles —
 * so Practice/Daily/Rush flows (rating updates, streaks, Rush strikes,
 * share cards) can be smashed through fast without reading real content.
 *
 * Hard-gated to `import.meta.env.DEV`, not just hidden: both
 * isDevPuzzleModeEnabled and setDevPuzzleMode short-circuit outside DEV, so
 * even if a stray localStorage key survived into a production bundle (it
 * can't — see below) the flag could never read as enabled there. Belt and
 * suspenders: DevPuzzleToggle, the only UI that calls setDevPuzzleMode, is
 * itself only rendered when import.meta.env.DEV — so there is no reachable
 * path to set the flag in a built app in the first place. `import.meta.env.DEV`
 * is a Vite build-time constant (false in `vite build`), not a runtime
 * check, so this can't be flipped by editing localStorage in prod either.
 *
 * Not reactive: toggling reloads the page (DevPuzzleToggle.tsx) rather than
 * live-swapping an in-progress session's pool, so every consumer just reads
 * the flag once, synchronously, at module/hook-init time.
 */
import { DEV_STUB_PUZZLES } from '../../content'
import type { Puzzle as ContentPuzzle } from '../../content'

const STORAGE_KEY = 'codoro:dev-stub-puzzles'

export function isDevPuzzleModeEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Safari private browsing (and similar) can throw on access — treat as off.
    return false
  }
}

export function setDevPuzzleMode(enabled: boolean): void {
  if (!import.meta.env.DEV) return
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Dev-only convenience — worst case the toggle doesn't persist.
  }
}

/**
 * Practice/Rush call this in place of reading `puzzlePool` directly.
 *
 * The `!import.meta.env.DEV` early return isn't just a fast path — Vite
 * inlines `import.meta.env.DEV` as the literal `false` in a production
 * build, which lets Rollup constant-fold this whole branch away and drop
 * the now-unreachable DEV_STUB_PUZZLES reference (and the puzzles
 * themselves) from the shipped bundle, instead of just leaving them
 * inert-but-present.
 */
export function resolvePool(realPool: readonly ContentPuzzle[]): readonly ContentPuzzle[] {
  if (!import.meta.env.DEV) return realPool
  return isDevPuzzleModeEnabled() ? DEV_STUB_PUZZLES : realPool
}

/**
 * Daily has no stub calendar (DEV_STUB_PUZZLES isn't an ordered calendar) —
 * when the switch is on, serve a puzzle chosen by the same day-index Daily
 * already computes, cycling through the stub pool instead of looking up
 * DAILY_CALENDAR ids in the real pool. Deterministic per day, same as real
 * Daily, so streak/completion testing still behaves sensibly.
 */
export function resolveDailyStubPuzzle(dayIndexZeroBased: number): ContentPuzzle {
  if (!import.meta.env.DEV) {
    throw new Error('resolveDailyStubPuzzle: called outside DEV')
  }
  const puzzle = DEV_STUB_PUZZLES[dayIndexZeroBased % DEV_STUB_PUZZLES.length]
  // DEV_STUB_PUZZLES is a non-empty const array; unreachable in practice.
  if (!puzzle) {
    throw new Error('resolveDailyStubPuzzle: DEV_STUB_PUZZLES is empty')
  }
  return puzzle
}
