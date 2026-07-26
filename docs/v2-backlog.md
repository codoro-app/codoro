# v2 backlog

Flat, unprioritized capture of everything deferred out of v1. This is a dumping ground, not a plan — nothing here is scoped, sequenced, or committed to. `todo.md` has been absorbed into this file and deleted.

## From todo.md

- AI features (unspecified)
- Drag-and-drop code blocks as an interaction type
- Drag-and-drop is janky on phone; sizing is also off on phone
- Puzzle shareability
- Puzzle separation + bigger puzzle libraries
- Show the puzzle's rating on Daily, or reveal it after solving
- AI-generated reel videos (marketing/content idea)
- Bug: Browse Puzzles doesn't reflect selection in the puzzle view on the right; should also be able to interact with the puzzle-view type directly
- Bug: LCP (largest contentful paint) needs attention
- Bug: swipe-binary always answers "right" — **rediagnosed during v2 Phase 0 planning.** Originally recorded as a component defect (`SwipeBinary.tsx` not tracking swipe direction); that is wrong, the component resolves direction correctly. The real defect is content: all 39 swipe-binary puzzles carry `correct_direction: "right"` and zero carry `"left"`, because `generatePuzzles.ts`'s single worked example hardcodes `'right'` and every generation run anchored to it. 36% of the library is a free Elo climb for blind right-swiping. Assigned to Phase 0 (rebalance + hard validator rule + generator fix); the deeper tell — every snippet is buggy, so the bug-naming label always wins — is Phase 6 content work.
- Rush: no progress bar on the right side
- Rush: should get harder as it goes
- Rush: add a timer to escalate stakes
- Security/accounts block (Clerk for disposable emails, session token storage, client-side admin checks, 2FA/OTP, rate limits, password pattern checks) — all of this assumes v2 has accounts/backend, which isn't decided yet

_(Two todo.md items were already resolved and are not carried forward: the dev-only puzzle test switch, and legal disclaimers — now a real `/legal` page.)_

## Flagged during the v1 wrap-up pass

- **The core finding**: v1's content is quiz questions, not puzzles (one-shot recognition vs. holding state and reasoning forward). See `docs/v1-retro.md`. The deferred **execution scrubber** (stepping through code state) is the named v2 flagship and the actual fix for this — not more/better quiz content.
- **`generatePuzzles.ts`'s model/pricing split** — the script currently hardcodes a single `MODEL` constant and Sonnet-rate `INPUT_COST_PER_MTOK`/`OUTPUT_COST_PER_MTOK` constants that feed the `COST_CEILING_USD` guard. Splitting generate/review into separate models (and making cost constants per-model) was deferred rather than done blind, since this pass never ran the script. **Whoever runs a real batch against a different model must correct these pricing constants first** — the cost ceiling is silently wrong otherwise.
- **LLM-assigned difficulty ratings anchor to round numbers** instead of genuinely applying the S/T/D/C rubric — most of the original 104 puzzles sit at exactly 1000/1600/1700/1900. This is a prompt/pipeline problem, not something a one-off content pass fixes.
- **No target language mix.** Interaction type has a target (45/35/20 swipe/mcq/tap-line); language doesn't. Current mix is 61% JS / 23% Java / 14% Python / 2% C.
- **Content volume ceiling.** 108 puzzles is roughly four sessions before repeats. Any v2 content plan needs either much higher volume or on-demand/procedural generation — fixing the difficulty curve doesn't fix running out of material.
- **No backend, no leaderboard, no social loop.** An Elo rating nobody else can see is a private number. Whether v2 gets a backend is an open, undecided question, not assumed here.
- **Production telemetry was found completely inactive during this pass.** `initTelemetry()` in `src/telemetry/client.ts` no-ops whenever `VITE_POSTHOG_KEY` is unset, and live verification (network requests, localStorage keys, and grepping every deployed JS chunk for the `posthog-js` SDK / a `phc_` key) found zero trace of PostHog ever initializing on `getcodoro.com`. Practical effect: no `session_start`, `attempt`, `rush`, or `app_error` event has ever reached PostHog from real production traffic since launch. Being addressed directly (Cloudflare Pages env var), not purely a backlog item — noted here in case it resurfaces.
- **Export/import has no UI.** `src/storage/exportImport.ts`'s `exportData()`/`importData()` are implemented and unit-tested (round-trip passes against `fake-indexeddb`), and live-checked against a real browser's IndexedDB during this pass — but nothing in `src/app/` ever calls them. There is currently no way for an actual user to export or restore their data; it's a fully dead capability from the UI's perspective. Not built this pass (out of scope — "no new features").
- **Lighthouse performance on production: 82** (target was 90+). Accessibility 94, best-practices 100, SEO 82 (both measured, neither was a stated Phase 9 target). Contributors identified: LCP/FCP both ~3.1-3.9s, ~460ms of render-blocking resources, ~58KB of unused JS, an inefficient cache policy on one static resource. Not fixed this pass — needs profiling and rebuild/redeploy verification, more than a 30-minute job.
- **No true 404 handling before this pass** (fixed as part of Task D: added `public/404.html`, which Cloudflare Pages serves automatically for unmatched paths instead of the SPA-fallback 200). Worth re-verifying on production after the next deploy.
- **The app has no URL routing at all** — `AppMode` is in-memory client state only (deliberate, per the build plan's "keep it minimal" instruction). This means `/legal` isn't a real deep-linkable URL despite the name; anyone landing on `getcodoro.com/legal` directly just gets the normal SPA boot flow, not the legal page. Acceptable for a footer-only link in v1; would need a real router if v2 wants shareable/deep-linkable URLs (also relevant to the "puzzle shareability" item above).
