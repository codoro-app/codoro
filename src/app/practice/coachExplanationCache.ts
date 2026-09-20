/**
 * Shared id -> Promise<ExplanationSet | undefined> cache for on-demand coach
 * explanation loading — mirrors `puzzleBodyCache.ts` exactly (spec §5.2:
 * "mirror src/app/practice/puzzleBodyCache.ts exactly... do not invent a
 * second caching pattern"). One in-flight/resolved promise per puzzle id no
 * matter how many times `loadCoachExplanationSet` is called for that id;
 * rejected promises are evicted so a retry can re-attempt.
 *
 * Deep-imports `getExplanationSet` from `../../content/explanations`, never
 * the content barrel (F32 — see that module's own doc comment;
 * barrelBoundary.test.ts fails on the barrel path).
 */
import { getExplanationSet } from '../../content/explanations'
import type { ExplanationSet } from '../../content/explanationSchema'

const cache = new Map<string, Promise<ExplanationSet | undefined>>()

export function loadCoachExplanationSet(puzzleId: string): Promise<ExplanationSet | undefined> {
  let pending = cache.get(puzzleId)
  if (!pending) {
    pending = getExplanationSet(puzzleId)
    pending.catch(() => {
      if (cache.get(puzzleId) === pending) cache.delete(puzzleId)
    })
    cache.set(puzzleId, pending)
  }
  return pending
}

/** Test-only: clears the module-level cache — see puzzleBodyCache.ts's identical helper for why. */
export function resetCoachExplanationCacheForTests(): void {
  cache.clear()
}
