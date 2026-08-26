# Content metadata/body lazy-load split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop shipping all 214 puzzle bodies eagerly on `/practice`'s critical path (`content-*.js`, 286 KB raw / 68 KB gzip) — split content into a tiny, eager metadata index plus per-puzzle bodies loaded on demand, with a speculative-prefetch layer so the async body fetch is invisible in the common case.

**Architecture:** A build-time Vite plugin generates a small eager metadata array (`{id, pattern, difficulty_rating, interaction}` × 214, no puzzle bodies) as a virtual module. `src/content/index.ts` keeps its existing DEV-only eager+validated `puzzlePool`/`quizPool`/`scrubberPool` exports exactly as they are today (unchanged — every test that reads them directly keeps working) and adds a new, production-relevant pair: `puzzleMeta` (eager, tiny) and `getPuzzleBody(id): Promise<Puzzle | undefined>` (lazy, per-file chunk). Consumers split into three buckets by what they actually need — metadata-only (swap an import), arbitrary-id lookup (already on a separately-code-split route, so async is free), and the `/practice`/`/daily`/`/rush` selection engines (the hard case — these need to keep the play loop feeling instant, via stale-while-revalidate plus speculative prefetch of the algorithm's next-likely candidates).

**Tech Stack:** Vite 8 (virtual modules via `resolveId`/`load` plugin hooks), React 19, TypeScript, Vitest.

**Spec:** This plan implements the deferred half of finding #2 in `docs/prompts/claude_code_prompt_perf_mobile_lighthouse.md`, whose deferral is explained in `docs/superpowers/plans/2026-08-24-perf-mobile-lighthouse.md`'s "Scope note" (read that first — it documents exactly why this was cut from the prior pass and the audit findings this plan builds on). This plan's loading-UX approach (speculative prefetch + stale-while-revalidate fallback) was chosen over two simpler alternatives (plain stale-while-revalidate with no prefetch; an explicit spinner on every transition) in conversation with the project owner on 2026-08-24 — that decision is locked; do not re-litigate it or substitute a simpler mechanism without checking back.

## Global Constraints

- No SSR, no prerender, no framework migration — v2 is locked local-first, no backend (`docs/v2-build-plan.md`).
- Do not weaken `vite.config.ts`'s coverage thresholds (100% statements/functions/lines on `engine/`/`storage/`, 96% branches). Task 5 touches `engine/` read-only (adding a query function, not changing selection behavior) — if it turns out selection logic itself must change to support ranked-candidate exposure, stop and flag it; that's a bigger, riskier change than this plan currently scopes.
- Every existing consumer of `puzzlePool`/`quizPool`/`scrubberPool` in dev/test must keep working unchanged — these three exports stay exactly as they are today (`import.meta.env.DEV`-gated eager+validated array, per the prior pass's Task 3). This plan only ADDS `puzzleMeta`/`getPuzzleBody`; it never removes or changes the existing exports' shape.
- `filename === id` is a structural assumption this plan relies on for mapping a puzzle id to its lazy-loaded file (confirmed true for every file sampled during the prior pass's planning — e.g. `con-001.json` has `"id": "con-001"`). Task 3, Step 1 must verify this holds for all 214 files before building the lookup on top of it, and `validate:content` should gain a check enforcing it going forward (not just assumed).
- `pnpm validate` (typecheck, lint, test, content validation, build) must pass at the end of every task.
- PWA offline play must keep working — the service worker precaches whatever chunks `globPatterns` in `vite.config.ts` matches; verify per-puzzle body chunks are still covered (they will be, since `**/*.{js,css,...}` is pattern-based, not a manual list — but verify by hand per Task 8, don't assume).
- This plan's tasks are NOT independent the way the prior pass's were — Tasks 2→3 must land in order (3 needs 2's virtual module), and Task 5 depends on Task 1's findings. Tasks 4 and 6 can each land independently once Task 3 is done. Task 7 (tests) trails whichever of 4/5/6 it covers.

---

### Task 1: Audit `src/engine/selection.ts`'s ranking internals

**Files:**

- Read only: `src/engine/selection.ts`, `src/engine/selection.test.ts`, `src/app/practice/usePracticeSession.ts`, `src/app/daily/useDailySession.ts`, `src/app/rush/useRushSession.ts`
- Create: `docs/superpowers/plans/2026-08-24-content-metadata-lazy-load-selection-audit.md` (this task's findings, consumed by Task 5)

**Interfaces:**

- Produces: a written answer to the question Task 5 depends on — does the selection algorithm currently expose (or can it cheaply be made to expose) a ranked list of "next-most-likely" candidate puzzle ids, not just the single chosen one? If yes, its exact function signature. If no, the smallest change that would let it, or a documented reason prefetch must work some other way (e.g. re-running selection N times with different RNG seeds/exclusion sets to approximate a candidate set, if the algorithm itself has no natural "top-K" notion).

This task was deliberately deferred from this plan's own authoring session (2026-08-24) rather than researched then — see that session's conversation for why. Do not skip it or assume an interface; the rest of Task 5 is unwritable without a real answer here.

- [ ] **Step 1: Read the selection algorithm**

Read `src/engine/selection.ts` in full. Answer, in the findings doc:

- What are its exported functions' exact signatures (names, params, return types)?
- Does selection depend on mutable state across calls (e.g. an RNG seeded once, a requeue/streak history) such that calling it twice in a row for "the chosen one" and "candidates" would give inconsistent or side-effecting results?
- Is there a natural notion of "second choice," "runner-up," or a scored/ranked intermediate list inside the algorithm before it collapses to one puzzle — or does it go straight from "pool" to "one puzzle" with no exposed intermediate ranking?

- [ ] **Step 2: Read how the three session hooks call it**

Read `usePracticeSession.ts`, `useDailySession.ts`, `useRushSession.ts` — specifically the `resolvePool(...)` call sites and whatever selection function each ultimately calls. Answer:

- Do all three hooks share one underlying selection call, or does each have its own variant (Daily's calendar-linked puzzle, Rush's difficulty-adaptive stream, Practice's pattern/mastery-weighted pick)?
- What state does each hook already hold between puzzles (e.g. `attempts`, `currentPuzzleId`) that a prefetch layer would need to read to know what to prefetch next?

- [ ] **Step 3: Decide the candidate-list mechanism**

Based on Steps 1-2, write a concrete recommendation in the findings doc — one of:

- **(a) Natural top-K exists**: the algorithm can cheaply return its top 3-5 scored candidates instead of collapsing to 1; specify the exact new/changed function signature Task 5 should implement.
- **(b) No natural top-K, but selection is cheap and side-effect-free enough to re-run**: Task 5's prefetch layer calls the real selection function N extra times (excluding ids already chosen) to build an approximate candidate set; specify N and confirm this is actually side-effect-free (no RNG state mutation, no requeue-history mutation) by reading the code, not assuming.
- **(c) Neither is safe/cheap**: selection is either stateful in a way that makes speculative extra calls wrong, or expensive enough that 3-5x calls per puzzle serve is a real cost. If this is the finding, say so plainly and recommend Task 5 fall back to the simpler stale-while-revalidate-only mechanism (no prefetch) for now, with a note that true prefetch needs an engine-level change out of this plan's scope.

- [ ] **Step 4: Commit the findings doc**

```bash
git add docs/superpowers/plans/2026-08-24-content-metadata-lazy-load-selection-audit.md
git commit -m "docs: audit selection.ts for Task 5's prefetch candidate-list design"
```

No app code changes in this task — it's pure research. `pnpm validate` should already pass untouched; running it isn't required to confirm this task's own output, but do it before moving on if any doubt exists.

---

### Task 2: Build-time puzzle-metadata virtual module

**Files:**

- Modify: `vite.config.ts` (new local plugin)
- Create: `src/content/virtualPuzzleMeta.d.ts` (ambient module declaration)

**Interfaces:**

- Produces: a virtual module `virtual:codoro-puzzle-meta` exporting `PUZZLE_META: ReadonlyArray<{id: string; pattern: string; difficulty_rating: number; interaction: string}>`, generated once at build/dev-server-start time straight off disk — never re-derived from the eager `puzzlePool` glob (that would defeat the whole point: eagerly importing full puzzle bodies just to throw away everything but 4 fields).

- [ ] **Step 1: Write the plugin**

In `vite.config.ts`, add near the top (after the `inlineCriticalCss` plugin definition, before `defineConfig`):

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PUZZLE_META_VIRTUAL_ID = 'virtual:codoro-puzzle-meta'
const RESOLVED_PUZZLE_META_VIRTUAL_ID = `\0${PUZZLE_META_VIRTUAL_ID}`

// Perf pass follow-up (2026-08-24): generates the metadata-only puzzle
// index src/content/index.ts's `puzzleMeta` export needs to select a
// puzzle WITHOUT eagerly importing all 214 puzzle bodies (286 KB raw,
// confirmed on /practice's critical path — see
// docs/perf-baseline-2026-08-24.md). A small, self-contained file walk —
// not a reach into src/content/tools/loadPuzzles.ts's near-identical logic
// — see this file's own navigateFallbackDenylist comment above for why
// this file avoids importing from src/: an isolated tsconfig.node.json
// project. Runs once at build/dev-server-start time, not per-request.
function puzzleMetaPlugin(): Plugin {
  function readPuzzleMeta(): string {
    const puzzlesDir = join(process.cwd(), 'src/content/puzzles')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) return walk(fullPath)
        return entry.name.endsWith('.json') ? [fullPath] : []
      })
    const meta = walk(puzzlesDir)
      .sort()
      .map((filePath) => {
        const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as {
          id: unknown
          pattern: unknown
          difficulty_rating: unknown
          interaction: unknown
        }
        return {
          id: raw.id,
          pattern: raw.pattern,
          difficulty_rating: raw.difficulty_rating,
          interaction: raw.interaction,
        }
      })
    return `export const PUZZLE_META = ${JSON.stringify(meta)}`
  }

  return {
    name: 'codoro-puzzle-meta',
    resolveId(id) {
      if (id === PUZZLE_META_VIRTUAL_ID) return RESOLVED_PUZZLE_META_VIRTUAL_ID
      return undefined
    },
    load(id) {
      if (id === RESOLVED_PUZZLE_META_VIRTUAL_ID) return readPuzzleMeta()
      return undefined
    },
  }
}
```

Add `puzzleMetaPlugin()` to the `plugins: [...]` array (order doesn't matter relative to `react()`/`tailwindcss()`, since this plugin only participates in module resolution, not HTML/CSS transforms — place it near `inlineCriticalCss()` for readability).

- [ ] **Step 2: Ambient module declaration**

Create `src/content/virtualPuzzleMeta.d.ts`:

```ts
declare module 'virtual:codoro-puzzle-meta' {
  export const PUZZLE_META: ReadonlyArray<{
    id: string
    pattern: string
    difficulty_rating: number
    interaction: string
  }>
}
```

- [ ] **Step 3: Verify it resolves**

Run: `pnpm dev`, add a temporary `console.log` importing `PUZZLE_META` from `virtual:codoro-puzzle-meta` in any already-loaded module, confirm it logs 214 entries with real `id`/`pattern`/`difficulty_rating`/`interaction` values. Remove the temporary log before committing.

Run: `pnpm build`, confirm it still succeeds (the virtual module must also resolve in the production build path, not just dev server).

- [ ] **Step 4: Full validate + commit**

Run: `pnpm validate`

```bash
git add vite.config.ts src/content/virtualPuzzleMeta.d.ts
git commit -m "perf: add build-time puzzle-metadata virtual module"
```

---

### Task 3: `puzzleMeta` + `getPuzzleBody` in `src/content/index.ts`

**Files:**

- Modify: `src/content/index.ts`
- Modify: `src/content/index.test.ts` (new tests for the new exports)

**Interfaces:**

- Consumes: `PUZZLE_META` from `virtual:codoro-puzzle-meta` (Task 2).
- Produces: `puzzleMeta: PuzzleMeta[]` (eager, exported type `PuzzleMeta = {id: string; pattern: PatternSlug; difficulty_rating: number; interaction: Puzzle['interaction']}`), `getPuzzleBody(id: string): Promise<Puzzle | undefined>` (lazy, per-file dynamic import + zod validation on every call — this runs per real navigation, not 214x at boot, so the cost is fine to keep). `puzzlePool`/`quizPool`/`scrubberPool` are UNCHANGED — do not touch their existing code.

- [ ] **Step 1: Verify the filename === id assumption holds for all 214 files**

Run:

```bash
node -e "
const fs = require('fs');
const path = require('path');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.json') ? [p] : []);
  });
}
const files = walk('src/content/puzzles');
const mismatches = files.filter(f => {
  const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
  return path.basename(f, '.json') !== obj.id;
});
console.log('files:', files.length, 'mismatches:', mismatches.length);
console.log(mismatches);
"
```

Expected: `mismatches: 0`. If not, STOP — the lazy-loader design in Step 3 below assumes this holds; report the mismatching files instead of building on a broken assumption.

- [ ] **Step 2: Add the `PuzzleMeta` type and `puzzleMeta` export**

In `src/content/index.ts`, add (near the top, after the existing imports):

```ts
import { PUZZLE_META } from 'virtual:codoro-puzzle-meta'
import type { PatternSlug } from './patterns'

export interface PuzzleMeta {
  readonly id: string
  readonly pattern: PatternSlug
  readonly difficulty_rating: number
  readonly interaction: Puzzle['interaction']
}

// Perf pass follow-up (2026-08-24): every puzzle's id/pattern/
// difficulty_rating/interaction, generated at build/dev-server-start time
// by vite.config.ts's puzzleMetaPlugin straight off disk (not derived from
// puzzlePool below) — see that plugin's own comment for why. Consumers
// that only need to select a puzzle or bucket data by pattern (mastery
// calculations, pool selection) should read this, not puzzlePool/quizPool
// — it never pulls a single puzzle body (snippet/choices/explanation/...)
// into the bundle. See docs/superpowers/plans/2026-08-24-content-metadata-lazy-load.md.
export const puzzleMeta: PuzzleMeta[] = PUZZLE_META as PuzzleMeta[]
```

- [ ] **Step 3: Add `getPuzzleBody`**

In `src/content/index.ts`, add below the `puzzlePool`/`quizPool`/`scrubberPool` block (leave that block completely unchanged):

```ts
// Lazy, per-file loaders keyed by path — NOT eager, unlike the `modules`
// glob above that builds puzzlePool. Each call to a loader triggers its
// own dynamic import() of exactly one puzzle's JSON, its own small chunk.
const bodyLoaders = import.meta.glob('./puzzles/**/*.json', {
  import: 'default',
}) as Record<string, () => Promise<unknown>>

function loaderKeyForId(id: string): string | undefined {
  return Object.keys(bodyLoaders).find(
    (path) => path.slice(path.lastIndexOf('/') + 1) === `${id}.json`,
  )
}

/**
 * Loads and validates a single puzzle body by id, on demand — the only way
 * to get a full Puzzle (snippet/choices/explanation/...) outside DEV/test,
 * where puzzlePool above still holds everything eagerly. Always
 * zod-validates (even in production, unlike puzzlePool's DEV-only
 * validation): this runs once per real navigation/prefetch, not 214x
 * before first paint, so the cost is negligible and the safety net is
 * worth keeping. Returns undefined for an unknown id rather than
 * throwing — every call site (Task 5/6 of the follow-up plan) treats a
 * missing puzzle as a real, expected case (a stale/broken shared link),
 * not a bug.
 */
export async function getPuzzleBody(id: string): Promise<Puzzle | undefined> {
  const key = loaderKeyForId(id)
  if (!key) return undefined
  const raw = await bodyLoaders[key]()
  const result = PuzzleSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid puzzle content at ${key}: ${result.error.message}`)
  }
  return result.data
}
```

- [ ] **Step 4: Write tests**

In `src/content/index.test.ts`, add:

```ts
describe('puzzleMeta', () => {
  it('has one entry per puzzlePool entry, with matching id/pattern/difficulty_rating/interaction', () => {
    expect(puzzleMeta.length).toBe(puzzlePool.length)
    const byId = new Map(puzzlePool.map((p) => [p.id, p]))
    for (const meta of puzzleMeta) {
      const full = byId.get(meta.id)
      expect(full, `${meta.id} missing from puzzlePool`).toBeDefined()
      expect(meta.pattern).toBe(full?.pattern)
      expect(meta.difficulty_rating).toBe(full?.difficulty_rating)
      expect(meta.interaction).toBe(full?.interaction)
    }
  })
})

describe('getPuzzleBody', () => {
  it('resolves the real, fully-validated puzzle for a known id', async () => {
    const known = puzzlePool[0]
    if (!known) throw new Error('puzzlePool is empty in test env')
    const body = await getPuzzleBody(known.id)
    expect(body).toEqual(known)
  })

  it('resolves undefined for an unknown id', async () => {
    const body = await getPuzzleBody('nonexistent-id-xyz')
    expect(body).toBeUndefined()
  })
})
```

- [ ] **Step 5: Run tests, build, validate**

Run: `pnpm test src/content/index.test.ts` — expected: all pass, including the two new describe blocks.
Run: `pnpm build` — confirm it still succeeds with the new lazy `import.meta.glob` call alongside the existing eager one (two separate glob calls over the same pattern with different `eager` values is a supported, standard Vite pattern — verify by checking `dist/assets/` now contains one small chunk per puzzle file, in addition to the existing `content-*.js`).
Run: `pnpm validate`

- [ ] **Step 6: Commit**

```bash
git add src/content/index.ts src/content/index.test.ts
git commit -m "perf: add puzzleMeta + getPuzzleBody for lazy per-puzzle content loading"
```

---

### Task 4: Convert metadata-only consumers (`computeMastery`)

**Files:**

- Modify: `src/app/practice/mastery.ts`
- Modify: `src/app/Home.tsx`, `src/app/stats/StatsPage.tsx`, `src/app/practice/MasteryTeaser.tsx`, `src/app/practice/PatternPicker.tsx`

**Interfaces:**

- Consumes: `puzzleMeta` (Task 3).
- Produces: `computeMastery`'s `pool` parameter widened to accept either `Puzzle[]` (still used by any test fixture passing full puzzles) or `PuzzleMeta[]` (used by real app code from now on) — a structural-typing widening, not a behavior change.

- [ ] **Step 1: Widen `computeMastery`'s type**

In `src/app/practice/mastery.ts`, change the `pool` parameter's type from `readonly Puzzle[]` to a narrower structural type it actually needs:

```ts
export function computeMastery(
  attempts: readonly Attempt[],
  pool: readonly { readonly id: string; readonly pattern: PatternSlug }[],
): PatternMastery[] {
```

(The function body is unchanged — it already only reads `puzzle.id`/`puzzle.pattern`, confirmed during the prior pass's planning.) Both `Puzzle[]` and `PuzzleMeta[]` satisfy this structural type, so every existing test passing real `Puzzle[]` fixtures keeps compiling with no changes.

- [ ] **Step 2: Swap the four call sites**

In each of `Home.tsx`, `StatsPage.tsx`, `MasteryTeaser.tsx`, `PatternPicker.tsx`: change the import from `puzzlePool` to `puzzleMeta` (from `'../content'`/`'../../content'` as appropriate — same barrel), and change the `computeMastery(attempts, puzzlePool)` call to `computeMastery(attempts, puzzleMeta)`. No other changes in these files — they don't touch puzzle bodies elsewhere (confirmed during the prior pass's audit; if any of these files also reads `puzzlePool` for something else, stop and report it rather than blindly swapping).

- [ ] **Step 3: Run tests**

Run: `pnpm test src/app/practice/mastery.test.ts src/app/Home.test.tsx src/app/stats/StatsPage.test.tsx src/app/practice/MasteryTeaser.test.tsx src/app/practice/PatternPicker.test.tsx` (adjust exact test filenames to whatever exists — check with `Glob` first if any of these don't exist as named).

- [ ] **Step 4: Verify the bundle actually shrinks for this piece**

Run: `pnpm build`, confirm `content-*.js` no longer needs to be imported by `Home.tsx`/`StatsPage.tsx`/`MasteryTeaser.tsx`/`PatternPicker.tsx`'s own chunks specifically (it may still be pulled in transitively by something else at this point in the plan — Task 5 is what actually removes it from `/practice`'s critical path — so don't expect `content-*.js` to disappear from the build yet; just confirm these four files' own chunks no longer statically reference it).

- [ ] **Step 5: Full validate + commit**

```bash
git add src/app/practice/mastery.ts src/app/Home.tsx src/app/stats/StatsPage.tsx src/app/practice/MasteryTeaser.tsx src/app/practice/PatternPicker.tsx
git commit -m "perf: switch mastery calculations to the metadata-only puzzle index"
```

---

### Task 5: Convert the selection engines (the hard case)

**Files:** determined by Task 1's findings — expect `src/app/practice/usePracticeSession.ts`, `src/app/daily/useDailySession.ts`, `src/app/rush/useRushSession.ts`, and possibly `src/engine/selection.ts` if Task 1 found a natural top-K to expose.

**This task cannot be fully specified until Task 1 lands.** Read Task 1's findings doc (`docs/superpowers/plans/2026-08-24-content-metadata-lazy-load-selection-audit.md`) before starting. What follows is the target mechanism and contract every implementation path must satisfy — the exact integration code depends on which of Task 1's three outcomes (a/b/c) applies.

**Target contract, regardless of Task 1's outcome:**

- Each hook selects the next puzzle's **id** from `puzzleMeta` synchronously, exactly as it selects from `quizPool` today (the selection algorithm itself is unchanged — it already only needs id/pattern/difficulty_rating, per this plan's Scope Note origin).
- The hook's returned `puzzle` value **stays populated with the previously-displayed puzzle's full body** until the newly-selected id's body resolves via `getPuzzleBody` — never `null`/`undefined` mid-session (only on true cold boot, before any puzzle has ever loaded, is a loading state visible — reuse the existing `RouteSkeleton` pattern for that one case, per the locked UX decision).
- As soon as a puzzle is answered (submit), the hook immediately calls `getPuzzleBody` for the id(s) Task 1's mechanism identifies as likely-next, **before** the user acts again — so that by the time the user actually advances, the body is already resolved from an in-memory cache (a simple `Map<string, Promise<Puzzle | undefined>>` keyed by id, populated by both the prefetch and the eventual real fetch — the same promise either way, so a prefetch that's already in flight when the real selection lands doesn't trigger a second fetch).
- If Task 1's outcome is (c) (no safe/cheap prefetch), implement the stale-while-revalidate half only (still real, still valuable — it's what makes the async body-fetch invisible even without prefetch, since a fetch generally resolves in single-digit-to-low-double-digit milliseconds for a body a few hundred bytes to a couple KB), and document in this task's own report that the prefetch half is a follow-up blocked on an engine-level change.

- [ ] **Step 1: Read Task 1's findings, confirm which outcome applies**

- [ ] **Step 2: Design and implement the prefetch cache**

A small, shared module (new file, e.g. `src/app/practice/puzzleBodyCache.ts` — check whether `/daily` and `/rush` should share this exact module or need their own; they likely can share since it's just an id→Promise cache with no mode-specific logic) exposing something like:

```ts
const cache = new Map<string, Promise<Puzzle | undefined>>()

export function loadPuzzleBody(id: string): Promise<Puzzle | undefined> {
  let pending = cache.get(id)
  if (!pending) {
    pending = getPuzzleBody(id)
    cache.set(id, pending)
  }
  return pending
}
```

(Adjust for real needs found in Task 1/2 above — e.g. cache eviction if the pool is large enough that unbounded growth matters over a very long session; 214 entries × a small `Puzzle` object is unlikely to be a real memory concern, but say so explicitly rather than silently assuming.)

- [ ] **Step 3: Convert each hook**

For each of the three hooks: keep the existing synchronous id-selection logic; replace whatever currently reads the full puzzle body synchronously from `quizPool` with a call to `loadPuzzleBody(selectedId)`; hold the currently-displayed puzzle in a ref/state that only updates once the promise resolves (stale-while-revalidate); on submit/answer, kick off Step 2's prefetch for Task 1's candidate id(s) using the SAME cache (so a later real selection landing on a prefetched id is already resolved).

Write this out with full real code once Task 1's findings are in — do not guess at `resolvePool`'s or the hooks' exact current shape from this plan alone; read the actual current source at implementation time.

- [ ] **Step 4: Handle cold boot**

The very first puzzle of a session (no previous puzzle to stay stale on) needs its own loading treatment. Reuse `RouteSkeleton` (or a puzzle-card-shaped variant of it, matching the existing pattern of "shared skeleton sized to avoid layout shift" — see `RouteSkeleton.tsx`'s own doc comment) rather than inventing a new loading component.

- [ ] **Step 5: Tests**

This is the task most likely to need real new test coverage beyond mechanical updates — write tests (following TDD) covering: stale-while-revalidate (old puzzle stays displayed during a slow/delayed body fetch, confirmed via a controllable mock), prefetch actually happening on submit (spy on `getPuzzleBody`/the cache), and no duplicate fetch when a prefetched id becomes the real selection.

- [ ] **Step 6: Full validate + commit**

Run: `pnpm validate`. Given the scope, expect this to be the plan's largest single task — consider whether it should itself split into 3 sub-PRs (one per hook) once Task 1's findings make the real shape clear, rather than one giant commit.

---

### Task 6: Convert arbitrary-id-lookup consumers

**Files:** `src/app/challenge/useChallengeSession.ts`, `src/app/boss/useBossSession.ts`, `src/app/puzzle/PuzzlePage.tsx`

**Interfaces:**

- Consumes: `getPuzzleBody` (Task 3).
- Produces: each hook/page's existing synchronous `puzzlePool.find(id)` (or, for boss, a `Map` built from `quizPool`) replaced with `await getPuzzleBody(id)`, plus a minimal loading state for whatever brief window that introduces. These routes are already separately code-split from `/practice` (confirmed during the prior pass's audit), so this doesn't touch `/practice`'s own critical path — but it does add a real, new async hop to `/challenge`, `/boss`, and `/puzzle/:id`, each of which currently renders its first puzzle synchronously.

- [ ] **Step 1: Convert `useChallengeSession.ts`**

Replace the synchronous `puzzlePool.find((candidate) => candidate.id === id)` with `await getPuzzleBody(id)`. Add whatever minimal loading state `ChallengePage.tsx` needs while this resolves (check its current render logic for how it already handles a "not found" id — an unresolved-yet id during loading should render distinctly from a genuinely-missing one).

- [ ] **Step 2: Convert `useBossSession.ts`**

Replace the eager `new Map(quizPool.map((p) => [p.id, p]))` (built once per session, currently for the whole `quizPool`) with a targeted prefetch of exactly the 10 ids in the active boss set, via `Promise.all(BOSS_SET.map(id => getPuzzleBody(id)))`, resolved once before the boss run starts (not per-puzzle mid-run — boss sets are small and fixed, so prefetching all 10 up front is simpler and cheap).

- [ ] **Step 3: Convert `PuzzlePage.tsx`**

Same pattern as Step 1 — async lookup by the route's `:id` param, minimal loading state.

- [ ] **Step 4: Tests + validate**

Update each hook/page's test file for the new async contract (RTL's `waitFor`/`findBy*` queries instead of synchronous assertions, where the tests currently assume synchronous availability). Run `pnpm validate`.

- [ ] **Step 5: Commit**

```bash
git add src/app/challenge/useChallengeSession.ts src/app/boss/useBossSession.ts src/app/puzzle/PuzzlePage.tsx
git commit -m "perf: load challenge/boss/direct-link puzzle bodies on demand"
```

(Split into 3 separate commits/PRs if preferred — these three are independent of each other.)

---

### Task 7: Update the exhaustive-real-corpus test files

**Files:** audit which of the ~15 files identified during the prior pass's planning (`content/index.test.ts`, `bossRun.test.ts`, `ChallengePage.test.tsx`, `PuzzlePage.test.tsx`, `*.pool.test.tsx`, `shareText.test.ts` × 3, `usePracticeSession.test.ts`, `useDailySession.test.ts`, `useRushSession.test.ts`, `useBossSession.test.ts`, `BossPage.test.tsx`, `DailyPage.test.tsx`, `PracticePage.test.tsx`, `RushPage.test.tsx`) actually need changes after Tasks 4-6 land, versus which keep working unchanged because they only read `puzzlePool`/`quizPool`/`scrubberPool` directly (still eager+synchronous in dev/test, untouched by this whole plan) rather than going through a hook that changed.

- [ ] **Step 1: Re-run the full suite after Tasks 4-6, triage failures**

Run: `pnpm test`. Every failure here is a real, concrete file to fix — this is more reliable than trying to predict from this plan alone which tests are affected, since the exact hook internals aren't nailed down until Task 5 lands.

- [ ] **Step 2: Fix each failing file**

For hook-level tests (`usePracticeSession.test.ts` etc.): add `await waitFor(...)`/`findBy*` around assertions that now depend on the async body resolving, per Task 5/6's actual new contract.
For pure-data tests (`content/index.test.ts`, `bossRun.test.ts`): these should need zero changes (they read `puzzlePool` directly, untouched) — if any of these DO fail, that's a signal something in Tasks 2-3 broke the existing eager path, which should be treated as a regression to fix at the source, not papered over in the test.

- [ ] **Step 3: Full validate + commit**

```bash
git add <whichever test files changed>
git commit -m "test: update test suites for async puzzle-body resolution"
```

---

### Task 8: Re-measure, verify PWA offline, report

**Files:** `docs/perf-baseline-2026-08-24.md` (append a new section, don't overwrite the prior pass's history)

- [ ] **Step 1: Re-measure**

Run: `pnpm perf:lighthouse` (local) and, once deployed, `pnpm perf:lighthouse -- --prod`. Compare `content-*.js`'s size/critical-path presence against the prior pass's baseline doc numbers — confirm it's actually off `/practice`'s critical path now (check `dist/index.html`'s `<link rel="modulepreload">`s and `content-*.js`'s own dependents, the same way the prior pass's final reviewer verified the zod finding).

- [ ] **Step 2: Verify PWA offline play**

Same rigor as the prior pass: kill the local preview server entirely (not simulated-offline), reload `/practice`, `/daily`, `/rush`, `/challenge` (a shared link), `/boss`, and `/puzzle/:id` (a direct link) — confirm all six still work fully offline, including the async body-fetch paths this plan adds (per-puzzle chunks must be in the service worker's precache list — verify by hand, the `globPatterns` should already cover them since it's pattern-based, but confirm rather than assume).

- [ ] **Step 3: Report honestly**

Update `docs/perf-baseline-2026-08-24.md` with a new "Metadata/body split (follow-up, <date>)" section: real before/after numbers, whether the ≥0.80 mobile Performance / ≤2.5s LCP targets the prior pass missed are now met, and — if Task 1's outcome was (c) or Task 5 otherwise fell back to stale-while-revalidate-only — say so plainly rather than claim the full speculative-prefetch design shipped when it didn't.
