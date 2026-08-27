# Practice-page perf baseline — 2026-08-24

## Contaminated baseline (superseded)

Two Lighthouse runs against production `https://getcodoro.com/practice`,
captured in a Chrome profile with ~12 extensions loaded (MetaMask, Adobe
Acrobat, AdBlock, an LMS-detector, others). **Not a clean measurement** —
kept here only as the historical starting point this pass worked from.

|         | Perf | A11y | Best Practices | SEO  |
| ------- | ---- | ---- | -------------- | ---- |
| Mobile  | 0.46 | 0.96 | 0.73           | 1.00 |
| Desktop | 0.85 | 0.95 | 0.73           | 1.00 |

Confirmed extension noise in these reports (re-verified against the raw
JSON during planning, not just the summary numbers above):

- `unused-javascript`: "Est. savings of 4,741 KiB" mobile / "4,718 KiB"
  desktop — all but two entries are `chrome-extension://` or
  extension-injected `blob:` URLs. The two first-party entries
  (`module-*.js`/posthog, `index-*.js`/main bundle) total ~53 KiB of the
  4,741 KiB figure — genuinely small next to the extension noise, but not
  literally zero as an earlier draft of this finding claimed.
- `errors-in-console` (mobile): 3 network 404s (`/api/v1/courses`,
  `/d2l/api/...`, `/login/token.php`) are an LMS-detector extension probing
  the origin; the `browser_polyfill_default(...).runtime.getManifest is not
a function` exception is from an extension's injected `blob:` script.
  None are Codoro's code.
- `deprecations`: the Shared Storage API warning traces to MetaMask's
  content script (`chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/...`).
- mobile `mainthread-work-breakdown` total 7,492 ms; of the top 5 long
  tasks after the first (first-party, 1,171 ms), 4 are extension scripts.

## Clean baseline (`pnpm perf:lighthouse --prod`, run 2026-08-24)

3-run median per form factor, clean-profile (extension-free) baseline before any fix in this plan lands.

| Metric      | Mobile  | Desktop |
| ----------- | ------- | ------- |
| Performance | 75      | 99      |
| FCP         | 2225 ms | 557 ms  |
| LCP         | 3816 ms | 983 ms  |
| TBT         | 64 ms   | 0 ms    |
| CLS         | 0.227   | 0.000   |

## Post-fix (after Tasks 2–6 land)

**Important caveat: these are LOCAL build+preview numbers, not production.**
Every fix in this pass (Tasks 2–6) landed as a separate commit on
`perf/practice-mobile-lighthouse` — none has been pushed, merged, or
deployed. `pnpm perf:lighthouse -- --prod` at this point would just
re-measure the _unfixed_ production site (identical to the Clean baseline
above), so this table instead comes from `pnpm perf:lighthouse` in its
default local build+preview mode, run twice for cross-check (medians of 3
runs each):

| Metric      | Mobile (run 1) | Mobile (run 2) | Desktop (run 1) | Desktop (run 2) |
| ----------- | -------------- | -------------- | --------------- | --------------- |
| Performance | 80             | 79             | 98              | 98              |
| FCP         | 2565 ms        | 2563 ms        | 553 ms          | 553 ms          |
| LCP         | 4648 ms        | 4716 ms        | 1056 ms         | 1108 ms         |
| TBT         | 27 ms          | 30 ms          | 0 ms            | 0 ms            |
| CLS         | 0.000          | 0.000          | 0.000           | 0.000           |

The two runs closely agree, so the local numbers are trustworthy on their
own terms. But local build+preview is not a clean substitute for
production: localhost has near-zero network latency and no real CDN/edge
round trip, so TTFB-dependent metrics (FCP, and to a lesser extent LCP's
own TTFB sub-part) will likely be somewhat worse against real production
than shown here, even though Lighthouse's simulated CPU/network throttling
is identical in both modes. **CLS and TBT are not network-dependent and
should carry over to production essentially unchanged** — those are the
two numbers to trust most from this table. Re-run
`pnpm perf:lighthouse -- --prod` after these PRs are reviewed, merged, and
deployed to get the real, comparable-to-Clean-baseline production numbers;
this doc should be updated again at that point.

### Targets — honest status (against the local numbers above; re-verify against production once deployed)

| Target             | Mobile    | Status                                                                                                                                                                                                         |
| ------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance ≥ 0.80 | 0.79–0.80 | **Borderline / not clearly met.** Right at the line locally; likely to land just under it on real production given local's TTFB advantage over a real network round trip.                                      |
| CLS ≤ 0.05         | 0.000     | **Met, decisively.** Task 2 didn't just clear the target, it eliminated the metric — `layout-shifts` should report zero items. This is the one number in this table not sensitive to the local-vs-prod caveat. |
| TBT ≤ 300 ms       | 27–30 ms  | **Met, decisively.** Down from the Clean baseline's 64 ms even before accounting for measurement noise.                                                                                                        |
| LCP ≤ 2.5 s        | 4.6–4.7 s | **Not met.** See "Why LCP and Performance didn't fully move" below — this is the direct, expected consequence of the Scope Note's decision not to implement the harder half of finding #2.                     |

| Target             | Desktop | Status                                                                                                           |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------- |
| Performance ≥ 0.95 | 0.98    | **Met.** Matches the plan's own prediction: desktop's only real problem was the footer CLS, and Task 2 fixed it. |
| CLS ≤ 0.05         | 0.000   | **Met, decisively.**                                                                                             |

**Bottom line, stated plainly rather than rounded up:** CLS and TBT targets are solidly met on both form factors — the CLS fix in particular is a clean, total win, matching the plan's own prediction that it was the highest-confidence, cheapest fix in the pass. Desktop Performance is met. **Mobile Performance and mobile LCP are not clearly met**, and this was flagged as the likely outcome before any code was written (see this plan's "Scope note," written before Task 3 began): the harder half of finding #2 — splitting puzzle content into a metadata index plus per-puzzle lazy bodies — was investigated and explicitly not implemented, because doing it safely would require converting the `/practice`/`/daily`/`/rush` selection engines to async puzzle-body resolution, which introduces a real loading-state UI change to the core play loop (outside this pass's "no new features, no UI redesign" mandate) and risks the locked 100%-coverage `engine/` test suite. `content-*.js` (286 KB raw / 68 KB gzip, confirmed in the fresh build below) is still on `/practice`'s critical path as a result, and LCP's ~1.5–4+ s "element render delay" (the puzzle prompt text, which can't paint until that chunk parses and a puzzle is selected) is a direct symptom of that, exactly as the original spec's finding #3 predicted.

### Bundle sizes after Tasks 3–4 (spec finding 2c — reported, not further modified)

From a fresh `pnpm build` against current HEAD (all 6 tasks landed):

| Chunk                      | Raw       | Gzip     | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content-*.js`             | 285.86 KB | 67.52 KB | Puzzle pool (`puzzlePool`/`quizPool`/`scrubberPool`) — unchanged in size by Task 3, since only the _runtime validation_ was removed, not the bodies themselves (see Scope Note). Still on `/practice`'s critical path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `schemas-*.js` (zod)       | 70.32 KB  | 18.75 KB | **Still present and still on the critical path — this is a real, separate finding from Task 3's review, carried forward here.** Task 3 removed the 214 `safeParse` _calls_, but not zod itself: `AppShell.tsx → DevPuzzleToggle → devPuzzleMode.ts` imports `DEV_STUB_PUZZLES` from `content/index.ts` unconditionally (the import itself isn't `DEV`-gated, only the runtime logic inside `devPuzzleMode.ts` is), which pulls the whole content module — and therefore `schema.ts`, and therefore zod's schema-construction graph — into `AppShell`'s eager import graph. Since `AppShell` mounts on **every route**, this is a whole-app issue, not `/practice`-specific, and would survive even if the full metadata/body split had been implemented. Fixing it (annotating the zod schema builders `/*@__PURE__*/`, or `DEV`-gating `devPuzzleMode.ts`'s import chain itself) is a real, scoped, separate follow-up — not attempted in this pass. |
| `module-*.js` (posthog-js) | 219.83 KB | 72.97 KB | Now loaded via `requestIdleCallback`/`setTimeout` fallback (Task 4) — deferred past first paint, but still this size once it does load. Not further reduced; per the spec, ripping out posthog wasn't in scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `PuzzleCardShell-*.js`     | 157.45 KB | 50.48 KB | Pulls in framer-motion. Per the spec, not touched in this pass — "animation is part of the product's feel," a product call, not a perf-pass unilateral decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `index-*.js`               | 203.43 KB | 63.72 KB | react-dom + wouter + framer-motion references. Not independently reducible without the framework-migration option this pass locks out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### PWA offline play — verified (Task 8, Step 2)

Verified more rigorously than a simple devtools "offline" toggle: after the
service worker installed and took control of the page (confirmed via
`navigator.serviceWorker.controller`), the local preview server process was
killed entirely (not just simulated-offline — the origin was genuinely
unreachable, confirmed via a failed `curl`). A subsequent reload of
`/practice` still rendered a full, real, different puzzle from the
service-worker precache (`workbox-precache-v2`, 54 entries, confirmed to
include `index.html` and both the `content-*.js` and `PuzzleCardShell-*.js`
chunks). **Task 3's DEV/PROD content-loading branch did not break offline
PWA play** — the production branch's `puzzlePool` construction still
produces the identical data shape the service worker precaches, just
without the redundant runtime validation.

### Deferred/out-of-scope findings surfaced during this pass (not fixed, recorded for a future pass)

- **NavRail's non-collapsed brand link has the same WCAG 2.5.3 label-content
  mismatch Task 5 just fixed for the mobile top bar** (`aria-label="Home"`
  alongside visible "Codoro" text, `NavRail.tsx:97-116`) — not caught by the
  original Lighthouse report because that audit only ran at mobile
  viewport width, and NavRail only renders at ≥1024px. Found by this pass's
  Task 5 reviewer; out of scope for Task 5's brief, not fixed here.
- **zod is still on every route's critical path** (see the bundle-size table
  above) — a whole-app issue, not `/practice`-specific, found by Task 3's
  reviewer. Root cause and fix direction are documented there.
- **The metadata/body content-lazy-load split** (spec finding #2's harder
  half) — see the Scope Note at the top of the implementation plan for the
  full reasoning. Recommended as its own follow-up with an explicit product
  decision on whether a brief per-puzzle loading transition is acceptable.
- **`tools/perfLighthouse.ts`'s chrome-launcher temp-directory cleanup**
  occasionally logs a non-fatal `EPERM` on Windows after a successful run
  (Chrome's own temp profile directory briefly still file-locked at
  deletion time) — cosmetic log noise, doesn't affect the script's exit
  code or its reported numbers, not fixed in this pass.

## Metadata/body split (follow-up, 2026-08-25)

This follow-up plan (`docs/superpowers/plans/2026-08-24-content-metadata-lazy-load.md`)
implements the harder half of finding #2 that the prior pass explicitly deferred:
splitting puzzle content into an eager metadata index (`puzzleMeta`) plus
per-puzzle lazy-loaded bodies (`getPuzzleBody`), with stale-while-revalidate
and speculative prefetch so the async fetch is invisible in the common case.

**The honest story has two parts.** The per-consumer conversion (Tasks 4–6)
worked correctly the first time — every real hook (Practice/Trace/Rush/Daily/
Boss/Challenge/direct-link) genuinely selects from `puzzleMeta` and resolves
bodies via `getPuzzleBody`, with real regression coverage for the async
races this class of change is prone to (a Critical race condition and 5
Important async-correctness bugs were found and fixed across two review
cycles before landing — see the SDD ledger for detail). But the first
re-measurement (this task's own Step 1) found the plan's **central goal was
not yet achieved**: puzzle content was still 100% eagerly reachable from
every route, and total content payload had gotten _larger_, not smaller,
because the real per-puzzle chunk split sat _alongside_ a still-fully-eager
copy of the whole pool, not instead of it. Root cause, traced through the
actual built import graph: `src/content/index.ts`'s `puzzlePool` was built
via an _unconditional_ `import.meta.glob({eager:true})` (a deliberate,
correct choice at the time — Task 3 of this plan was constrained to leave
that export's shape untouched), and two small, unrelated dev-tool imports
(`AppShell → DevPuzzleToggle → devPuzzleMode.ts`, and `App.tsx`'s own
static import of `ScrubberDebugPage.tsx`) each pulled in one binding from
that same barrel file — which, per ES module semantics, forces the whole
file's top-level code to evaluate, glob included. This is the same bug
shape the prior pass's own reviewer already found and deferred for zod
(see the bundle-size table above); this plan's changes just gave it far
more to drag along.

That was fixed as an emergent follow-up task (not in the original plan,
ruled and dispatched once the regression was found): the two small
dev-tool imports were corrected (one now imports the underlying data file
directly instead of through the barrel; the other switched to the same
`lazy()` pattern every real route page already used), and — empirically
found to be additionally necessary, not just sufficient in theory —
`puzzlePool`/`quizPool`/`scrubberPool` were moved out of `content/index.ts`
into their own file (`src/content/pools.ts`), specifically because
re-exporting them from the barrel (the smaller, "safer" fix) was measured
to defeat the split entirely (Rollup keeps a re-exported module's
side-effectful code alive in every importer). The fix was verified
empirically, independently, twice — once by the implementer, once by an
independent reviewer who rebuilt from the same checkout and reproduced
every number — not just claimed:

| Metric                                                 | Before this fix                                          | After this fix                             |
| ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------ |
| Static puzzle-chunk imports across `dist/assets`       | 214                                                      | **0**                                      |
| `dist/index.html` `<link rel="modulepreload">` entries | 221 (214 of them puzzle chunks)                          | **2 (zero puzzle chunks)**                 |
| `content-*.js` (glue chunk)                            | 84.56 KB / 14.99 KB gzip, contains all 214 puzzle bodies | **49.36 KB / 7.70 KB gzip, contains none** |
| Puzzle bodies precached for offline (`dist/sw.js`)     | 214                                                      | 214 (unaffected either way)                |

The fixed `content-*.js` (49.36 KB / 7.70 KB gzip, glue only) is now
smaller than the _original pre-this-plan_ single eager chunk (285.86 KB /
67.52 KB gzip, from the "Bundle sizes after Tasks 3–4" table above) by a
wide margin, and the 214 puzzle bodies are now genuinely deferred —
downloaded on demand, one small chunk (mean 1551 B raw) per puzzle
actually played, not on every page load.

### PWA offline play — re-verified live (Task 8, Step 2)

Same rigor as the prior pass, done live in a real, connected browser, not
a devtools-simulated toggle: built fresh against the fixed HEAD, started
the local preview server, loaded `/practice`, waited for the service
worker to install and confirmed it took control of the page
(`navigator.serviceWorker.controller`), then **killed the preview server
process entirely** and confirmed via `curl` the origin was genuinely
unreachable (connection refused) before touching anything else. With the
server dead for the remainder of the check, all six required surfaces
still rendered real, working content from the service-worker precache:

- `/practice` — a real tap-line puzzle rendered fully.
- `/daily` — "Codoro Daily #237" with a real puzzle body.
- `/rush` — the live countdown ran and served a real puzzle.
- `/boss` — "Puzzle 1 of 10" with a real puzzle body.
- `/puzzle/con-001` (direct link) — a real puzzle body resolved.
- `/challenge` (shared link) — a validly-encoded challenge URL, built by
  hand against the app's own codec (`src/challenge/codec.ts`) to avoid
  needing a live share-flow click-through, resolved to a real puzzle body.

No route fell back to a broken-link or perpetual-loading state. The
per-puzzle body chunks this plan adds are covered by the same
pattern-based `globPatterns` the prior pass's Global Constraint predicted
— confirmed directly, not assumed: all 214 puzzle-body chunks are present
in `dist/sw.js`'s `precacheAndRoute([...])` manifest alongside the app
shell and every other route's assets.

### Lighthouse (`pnpm perf:lighthouse`, local build+preview, against the fixed HEAD)

**Important caveat, same as the prior pass's own post-fix table: these are
LOCAL build+preview numbers, not production.** Re-run
`pnpm perf:lighthouse -- --prod` after this branch is reviewed, merged,
and deployed to get real, comparable-to-Clean-baseline production numbers;
this doc should be updated again at that point.

| Metric      | Mobile (median of 3) | Desktop (median of 3) |
| ----------- | -------------------- | --------------------- |
| Performance | 82                   | 98                    |
| FCP         | 2185 ms              | 530 ms                |
| LCP         | 4509 ms              | 1052 ms               |
| TBT         | 37 ms                | 0 ms                  |
| CLS         | 0.000                | 0.000                 |

Compared to the prior pass's own local post-fix numbers (mobile
Performance 79–80, LCP 4648–4716 ms — the numbers left "borderline/not
clearly met" specifically because content was still on the critical path
at that point): **mobile Performance improved to 82, mobile LCP improved
to 4509 ms.** Desktop stayed at its prior clean 98/no-CLS state. This is a
real but modest improvement, not the dramatic swing the bundle-size table
above might suggest — LCP is dominated by more than one chunk (`schemas-*.js`,
`module-*.js`, `PuzzleCardShell-*.js`, `index-*.js` are all still eager
and, combined, still substantially larger than `content-*.js` ever was),
and this pass's own Global Constraints explicitly kept those out of scope.

**Targets status (against these local numbers, re-verify against
production once deployed):**

| Target             | Mobile  | Status                                                                                                                                                                                                                                                                     |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance ≥ 0.80 | 0.82    | **Met.** Crosses the line the prior pass left borderline (0.79–0.80), for the first time in either pass.                                                                                                                                                                   |
| CLS ≤ 0.05         | 0.000   | **Met, decisively** — unchanged from the prior pass, not touched by this one.                                                                                                                                                                                              |
| TBT ≤ 300 ms       | 37 ms   | **Met, decisively.**                                                                                                                                                                                                                                                       |
| LCP ≤ 2.5 s        | 4.509 s | **Still not met**, though improved from the prior pass's 4.648–4.716 s. `content-*.js` is no longer part of the reason — the remaining gap is the other still-eager chunks noted above, which this plan never targeted (finding #2's _puzzle content_ half, specifically). |

| Target             | Desktop | Status               |
| ------------------ | ------- | -------------------- |
| Performance ≥ 0.95 | 0.98    | **Met.**             |
| CLS ≤ 0.05         | 0.000   | **Met, decisively.** |

**Bottom line, stated plainly:** this plan achieves what it set out to do —
puzzle content is genuinely, verifiably off every route's critical path,
confirmed by rebuilding and re-tracing the import graph independently
twice (once by the fix's own implementer, once by a reviewer who
reproduced every number from a clean checkout), and live PWA offline play
for all six real-world entry points is confirmed working with the server
genuinely killed, not simulated. Mobile Performance crosses its 0.80
target for the first time across either perf pass. Mobile LCP, while
improved, still doesn't meet its 2.5 s target — the remaining gap is
explicitly other, larger, still-eager chunks (zod's schema-construction
graph, posthog, framer-motion-pulling `PuzzleCardShell`, the
react-dom/wouter/framer-motion `index-*.js`) that were out of scope for
_this_ plan's finding (#2, puzzle content specifically) and remain
real, separate, documented follow-ups.
