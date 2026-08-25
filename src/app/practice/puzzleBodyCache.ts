/**
 * Shared id -> Promise<Puzzle | undefined> cache for on-demand puzzle body
 * loading (content-metadata-lazy-load Task 5). One in-flight/resolved
 * promise per id no matter how many times — or from how many session hooks
 * (Practice, Trace, and Rush/Daily in the 5b follow-up) — `loadPuzzleBody`
 * is called for that id: a speculative prefetch and a later "real" load for
 * the same id share the exact same promise, so the real load never re-fetches
 * or re-validates content it (or a prefetch) already fetched.
 *
 * Unbounded by design, no eviction: at most one entry per puzzle id ever
 * exists, and the whole catalog is 214 puzzles today (see the selection
 * audit doc's Step 1.3). Even an unusually long single-page session can never
 * grow this past "every puzzle that exists" — a `Puzzle` body is a few
 * hundred bytes to a couple KB (per content/index.ts's own `getPuzzleBody`
 * doc comment), so 214 of them held for a session's lifetime is not a real
 * memory concern. Revisit only if the catalog grows by orders of magnitude.
 */
import { getPuzzleBody } from '../../content'
import type { Puzzle } from '../../content'

const cache = new Map<string, Promise<Puzzle | undefined>>()

export function loadPuzzleBody(id: string): Promise<Puzzle | undefined> {
  let pending = cache.get(id)
  if (!pending) {
    pending = getPuzzleBody(id)
    cache.set(id, pending)
  }
  return pending
}

/**
 * Test-only: clears the module-level cache. Vitest isolates modules per test
 * FILE, not per `it()` within a file — without this, a mocked
 * `getPuzzleBody`'s call-count assertions in one test could be silently
 * satisfied by a promise this same module cached during an earlier test in
 * the same file.
 */
export function resetPuzzleBodyCacheForTests(): void {
  cache.clear()
}
