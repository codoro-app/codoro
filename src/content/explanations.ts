/**
 * Lazy, per-puzzle loader for wrong-answer explanations
 * (src/content/explanations/<puzzle-id>.json) — the v6 Phase 6.0 coach
 * layer's runtime content path. See docs/superpowers/plans/2026-09-19-
 * wrong-answer-explanations-spec.md §5.1.
 *
 * A module of its own, deliberately NEVER re-exported from ./index (the
 * barrel most consumers import from) — the same reason pools.ts and
 * devPuzzles.ts aren't. ES modules evaluate per FILE, not per binding, so a
 * re-export would make Rollup treat this module as side-effectful and pull
 * every explanation chunk into any importer of the barrel — the exact
 * mistake pools.ts's own header measured at +25.9 KB. Import
 * `getExplanationSet` from here directly ('../../content/explanations' etc.
 * depending on depth), never from the barrel. barrelBoundary.test.ts is
 * extended to fail on exactly that mistake for this loader too.
 *
 * `{ eager: false }` (unlike pools.ts's puzzle glob, which needs the whole
 * library in memory at once): each puzzle's explanations are their own
 * dynamic-import chunk, fetched only when actually needed. Deciding WHEN to
 * fetch (wrong answer + entitled/metered, §5.2) is the coach UI's job —
 * 6.0 builds the pipeline and the loader, not the UI (6.1/6.2).
 */
import { ExplanationSetSchema } from './explanationSchema'
import type { ExplanationSet } from './explanationSchema'

const explanationLoaders = import.meta.glob('./explanations/*.json', {
  import: 'default',
}) as Record<string, () => Promise<unknown>>

// Returns the [path, loader] entry itself, not just the path — mirrors
// index.ts's getPuzzleBody: with noUncheckedIndexedAccess on, re-indexing
// explanationLoaders by a key derived from Object.keys() still types as
// possibly-undefined, so this hands back the loader found in the same pass.
function loaderEntryForId(id: string): [path: string, loader: () => Promise<unknown>] | undefined {
  return Object.entries(explanationLoaders).find(
    ([path]) => path.slice(path.lastIndexOf('/') + 1) === `${id}.json`,
  )
}

/**
 * Loads and validates one puzzle's explanation set by id, on demand.
 * Returns undefined when no explanation file exists for `id` yet — a real,
 * expected case (coverage rotates in as `generate:explanations` runs; a
 * puzzle authored between batches has none until the next one), never
 * thrown for. Throws only when a file exists but fails
 * `ExplanationSetSchema` — that's always a content bug, never a normal
 * runtime state, same contract as `getPuzzleBody`.
 */
export async function getExplanationSet(id: string): Promise<ExplanationSet | undefined> {
  const entry = loaderEntryForId(id)
  if (!entry) return undefined
  const [path, loader] = entry
  const raw = await loader()
  const result = ExplanationSetSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid explanation content at ${path}: ${result.error.message}`)
  }
  return result.data
}
