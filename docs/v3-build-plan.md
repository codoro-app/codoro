# Codoro v3 — build plan

v3 is the launch version: **get real users, and get honest evidence about whether they come back.** v2 built a game worth playing (scrubber flagship, 214 puzzles, challenge links, PWA); v3 finds out if anyone wants to play it. First backend code — minimal and anonymous, no accounts. The full arc (v3 launch → v4 accounts → v5 multiplayer) lives in `docs/roadmap.md`; this plan details v3 only.

This plan absorbs every v2 carryover (`docs/roadmap.md`'s v2-carryover section, the v2 defect-table waivers, and the three Phase 8 DoD items v2 closed as "Thomas's own, outstanding") plus every roadmap v3 row. Every item is assigned to a phase here or explicitly deferred with a named owner version — see the traceability tables at the bottom. Nothing gets to hide. Same rule as v2.

**Entry gate: open.** v2 Phase 8 is done (`pnpm validate` green from a fresh clone, re-verified 2026-08-10 in a clean environment; every defect-table row closed by commit or written waiver), and the decision to market Codoro is made.

## Locked decisions

| Decision                 | Choice                                                                                                                                                                                              | Why                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch blockers          | **All four v2 carryovers land before any distribution post**: OD-1 swipe, mobile Lighthouse 90+, Boss challenges, Missions (direct user decision, 2026-08-10)                                       | A launch spike is a one-shot audience. The first interaction a mobile stranger hits (swipe) cannot be broken, and the content depth the posts advertise (boss runs, missions) has to actually exist.                                            |
| Backend shape            | **Cloudflare Workers + D1/KV on the existing account, anonymous only.** Leaderboard (Daily + Rush best scores keyed on v2's `anonId`) + edge-injected OG meta. No auth, no PII                      | Matches `roadmap.md` v3.1 exactly (confirmed 2026-08-10). Accounts and the full v1 security block (Clerk, 2FA, token storage) stay v4 — gated on retention evidence v3 exists to produce. Rate limiting is v3 scope: an anonymous API needs it. |
| Backend location         | In this repo, as a `workers/` workspace package sharing the root `pnpm validate` chain (typecheck, lint, tests), deployed via `wrangler` from CI                                                    | One repo, one validate command, one PR flow — the same "every session ends mergeable and green" discipline v2 ran on. A second repo would fork that discipline for ~3 endpoints.                                                                |
| Client stays local-first | The play loop never blocks on the network. Leaderboard reads/writes are fire-and-forget enhancements; offline behavior is unchanged                                                                 | v2's local-first design is why the client has no scaling surface (10,000 users cost what 1 costs). v3 must not quietly break that property.                                                                                                     |
| v2 loose ends            | The three outstanding v2 Phase 8 DoD items (two-phone regression, PWA install/offline/SW-update, PostHog telemetry check) **fold into Phase 3's launch-readiness gate** — verified once, pre-launch | Direct user decision, 2026-08-10. They're verification, not build; the moment they matter most is right before strangers arrive, and Phase 3's regression pass has to re-run them anyway once Boss/Missions add surfaces.                       |
| OD-1 method              | **Instrumented on-device capture first, no sixth source-reading pass.** No fix lands without citing the captured data                                                                               | Five rounds of source/docs-grounded fixes each found a real mechanism and none resolved the on-device symptom. Every hypothesis reachable by reading source and docs alone has been tried — the v2 waiver says so explicitly.                   |
| Trace ground truth       | Unchanged from v2: scrubber traces derived by executing code, never asserted by an LLM; content batches gated by `validate:content`                                                                 | The pipeline discipline is why weekly content drops (Phase 6) are cheap and safe.                                                                                                                                                               |
| Sizing                   | Phases sized in **Claude sessions** (one session = one focused build block ending in a green `pnpm validate` and a merged PR)                                                                       | Same convention as v2. Budget is Claude usage, not calendar hours. No long-lived branches.                                                                                                                                                      |
| Validation posture       | **The scaling validation gate is Phase 5's entry condition**: all four surfaces measured and recorded as an amendment before anything is posted anywhere                                            | Launch posts can spike traffic in hours. "Survives thousands of users without intervention" gets validated before 3.2, not discovered during it (`roadmap.md`'s gate, unchanged).                                                               |

## Phase map

Roadmap labels in the second column so cross-references to `docs/roadmap.md` stay intact.

| Phase | Roadmap | What                                                                                                                      | Est. sessions       |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 0     | —       | v2 defect carryovers: OD-1 instrumented capture + fix, mobile Lighthouse 84→90+                                           | 1–2 + device passes |
| 1     | —       | Boss challenges (v2 Phase 6b, never built)                                                                                | 2                   |
| 2     | —       | Missions + click-meaningfulness UX pass (v2 Phase 6c, never built; **definition session required before build**)          | 2–3 + definition    |
| 3     | 3.0     | Launch-readiness: v2 loose ends, soak, fresh-user walkthrough, dashboards, quota math, lawyer review                      | 1–2 + Thomas passes |
| 4     | 3.1     | Minimal anonymous backend: Workers + D1/KV leaderboard, edge OG meta, rate limiting, load test                            | 2–3                 |
| 5     | 3.2     | Distribution: prerender/SEO pass, launch posts, reel videos — **gated on the scaling validation amendment**               | 1 + ongoing         |
| 6     | 3.3     | Growth loop: feedback channel (report-question), weekly content drops, dashboard watch. **Produces the v4 gate evidence** | ongoing             |

**Sequencing.** Phase 0 first — it's the smallest and everything downstream (Phase 3's regression pass, Phase 5's launch) depends on the swipe working. Phase 1 → 2 in order (missions chain ends in a boss run; 6c was gated on 6b in v2 and still is). Phase 3's build items (dashboards, soak setup) can interleave with Phases 1–2, but its **gate** — the full regression pass — runs only after Phase 2 merges, because the pass must cover boss and mission surfaces or it will just be re-run. The lawyer review (Phase 3, external) starts as early as possible and runs in parallel with everything; it blocks Phase 5, not Phase 4. Phase 4 can start any time after Phase 0 but its load test is only meaningful against the final pre-launch build. Phase 5 is hard-gated: **no post goes out until the scaling validation amendment is recorded with measured numbers and every Phase 0–4 DoD is closed.** Phase 6 begins the day the first post lands and doesn't end — it's the feedback loop, not a phase that completes.

## Known open defects

Same rule as v2: confirmed-real defects deliberately not yet fixed live here, above the phases. **Nothing is removed from this table without a commit that fixes it.** Anything unfixed at Phase 5's gate either blocks launch or gets an explicit written waiver.

| #    | Defect                                                                                                                                                                                                                                                                                 | Confirmed on                                                                                                                                                          | Owner phase | Status                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-1 | Swipe gesture unreliable on phone: normal-speed or slightly-diagonal swipes claimed by native scroll; only fast, purely-horizontal flicks commit. Survived five v2 fix rounds (32ms kinematics, zero touch `axisThreshold`, `touch-action: none`, corrected `pan-y` + `preventScroll`) | iPhone 15 Pro, iOS 26.5.2, production `getcodoro.com`, both PWA and browser tab — v2 waiver, 2026-08-10 (PR #52, `aa7674d` merged as best-available state, not a fix) | Phase 0     | **Open — carried from v2.** Method locked: instrumented on-device capture of the `@use-gesture` state machine on a failing gesture, then a fix citing that data. See Phase 0 below. |

(The mobile Lighthouse gap is a waived performance target, not an interaction defect — it's a Phase 0 build item, not a table row. If Phase 0's dependency work uncovers an actual defect, it gets a row then.)

---

## Phase 0 — v2 defect carryovers (1–2 sessions + device passes)

The two items v2 waived by direct decision rather than fixed. Both need real-device/production measurement, so the v2 split of responsibilities holds: sessions produce instrumented builds and fixes; Thomas runs the device passes.

**Build:**

1. **OD-1 instrumentation.** Add a temporary, dev-flagged gesture debug capture to `SwipeBinary.tsx`'s drag path — activated by a query param (e.g. `?gesture-debug=1`), rendering an on-screen event log (not just console; the failing device is a phone) of the raw pointer stream and `@use-gesture` state per frame: `pointerdown/move/up/cancel` with timestamps and coordinates, each event's `cancelable` flag, `state.axis` resolution, `_blocked`/intent state, whether `preventDefault` was actually called, and the final commit decision from `signedVelocityFromGesture`. Ship it to a preview deploy. **This is the whole first session's deliverable if need be** — the standing rule from v2 holds (no fix without a root cause read out of evidence), and the evidence class changes from source-reading to capture, per the v2 waiver's own instruction.
2. **OD-1 capture + fix.** Thomas reproduces the failure on the iPhone 15 Pro (both PWA and tab) with the overlay active and reports the captured sequence. The fix session starts from that data. **Not in scope, still:** retuning `DEFAULT_SWIPE_THRESHOLD`/`axisThreshold` without a captured mechanism showing the current value is wrong — the restriction this bug has carried since v2 Phase 0. A revert-check test lands with whatever the fix is, where the mechanism is testable in jsdom; the parts that aren't (real WebKit touch arbitration) are covered by the device re-test.
3. **Mobile Lighthouse 84 → 90+.** The remaining ~8.5 KiB "Legacy JavaScript" opportunity is a `Math.trunc` polyfill inside a third-party dependency's own shipped bundle (`module-Cwtw1I8F.js`) — `build.target` can't touch it. Work item, in order: identify the owning dependency (source-map trace / `vite-bundle-visualizer` on the built chunk — this was never done in v2, per the waiver); then either swap to its modern/ESM entry point, exclude/replace the dependency, or document why neither is worth it. If the polyfill turns out to be load-bearing for a browser the app actually supports, say so in writing and re-waive with that evidence — the v2 waiver was "not yet scoped," which is a different thing from "not worth it."
4. **Remove the instrumentation** (or gate it permanently behind the dev flag with a doc comment) once OD-1 closes — an on-screen event log is not a production surface.

**DoD:**

- [ ] OD-1 root cause stated from captured on-device data, fix merged, and **Thomas's on-device re-test passes** (iPhone 15 Pro, PWA + tab — the bar every v2 fix skipped or failed). Defect-table row closed by commit, or re-waived with the capture attached
- [ ] Revert-check test for the fix's testable mechanism, following v2's convention (`SwipeBinary.test.tsx`)
- [x] Lighthouse: offending dependency identified and named in an amendment; mobile performance ≥90 measured on production post-fix, or a written re-waiver citing what the dependency swap would break — **met via re-waiver, 2026-08-10.** See Amendment 1 below.
- [ ] `pnpm validate` green; instrumentation stripped or flag-gated

**Amendment 1 — Phase 0 item 3, mobile Lighthouse Legacy JS, 2026-08-10.** Owning dependency identified: **`posthog-js@1.404.1`**. Sourcemap trace (`module-Cwtw1I8F.js.map`, built with `--sourcemap`) shows the entire chunk is exactly one source: posthog-js's own published `dist/module.js` — confirming Vite is already resolving posthog-js's most modern entry (no `exports` map in their `package.json`; only `main`/`module` fields; Vite's default resolution already prefers `module` over `main`). No modern/no-polyfill entry exists to swap to: checked all posthog-js dist bundle variants (`module.js`, `module.slim.js`, `module.no-external.js`, `module.slim.no-external.js`, `main.js`) — 24 of 39 published `.js` files under `posthog-js/dist` carry the identical `Math.trunc||(Math.trunc=...)`/`Number.isInteger||(...)` shim, including every "slim"/"no-external" alternative. It's baked into posthog-js's own build (their `package.json` declares `browserslist: "> 0.5%, last 2 versions, Firefox ESR, not dead"`, a deliberately broad legacy target they control — unrelated to and untouched by this app's own `vite.config.ts` `build.target: ['ios17','safari17','chrome120','edge120']`, which only downlevels this app's own source, never a dependency's pre-bundled code). Replacing posthog-js outright is not a trivial, safely-scoped change — it's the app's sole telemetry provider, wired through `src/telemetry/client.ts`'s single choke point with PostHog-specific config (`person_profiles: 'identified_only'`, `register()`-based anon-ID super property, `disable_external_dependency_loading`). **Re-waived**: this ~8.5 KiB is inherent to posthog-js as published, not a fixable local config/entry-point choice. If Phase 0's Lighthouse gate still needs to clear 90+, the remaining path is either (a) accept the ~8.5 KiB and find margin elsewhere, or (b) a future session evaluates swapping posthog-js for a different analytics provider — a real dependency-swap project, not a Phase 0-scoped fix.

## Phase 1 — Boss challenges (2 sessions)

v2 Phase 6b, never built; the sketch in `v2-build-plan.md`'s Phase 6b section is the starting point. A run of 10 puzzles of escalating difficulty — a fourth own-mode following Rush's structural precedent (session hook + page + route), distinct from Rush: **fixed-length, curated-difficulty, not endless-against-the-clock.** The content gate that blocked it in v2 is open (214 puzzles).

**Design questions to settle in the build prompt's first session, in writing, before code** (carried verbatim from the v2 sketch — they were never answered):

1. **Selection: curated fixed sets vs. rating-laddered per run.** Recommendation to evaluate first: rating-laddered, seeded by run date/id for reproducibility, drawing an ascending difficulty ladder from the full pool — curated sets are authored content that goes stale; the ladder reuses calibration work Phase 6 (v2) already did.
2. **Rated or best-score-only.** Rush's precedent is best-score-only, but the v2 sketch flags this as the one genuinely open case — the boss run is the natural home for the todo item's `+24 Elo` payoff framing. Whichever way this lands, the decision and its reasoning get recorded here as an amendment.
3. **End condition:** survive-all-10 vs. strikes.
4. **Whether boss completion is the mission-progression trigger surface** — decide here, because Phase 2 builds on the answer.

**Build:**

1. `/boss` route + `ROUTE_META` entry, page, session hook — Rush's file structure as the template (`src/app/rush/` → `src/app/boss/`).
2. Run assembly per the settled selection design; deterministic and seeded, tested against the real pool (v2's convention: pool-level tests, not fixtures only, where the real content is the risk surface).
3. Storage: best-run record (and rating integration if question 2 lands "rated"). Any schema change bumps `CURRENT_SCHEMA_VERSION` with a migration **and an isolated migration test** — the v2 Phase 8 pattern, no indirect-only coverage.
4. Telemetry: run-started/run-ended events with outcome and depth reached, matching existing event conventions.
5. Payoff surface: end-of-run summary with the escalation arc visible (this is where the todo item's framing lives, whatever question 2 decided).

**DoD:**

- [ ] Boss mode playable end-to-end on desktop and mobile widths; run assembly deterministic (seeded) and covered by pool-level tests
- [ ] Design questions 1–4 answered in a written amendment here, with reasoning — the v2 standard for decision records
- [ ] Schema bump (if any) has an isolated migration test; export/import round-trips the new fields
- [ ] Telemetry events verified firing locally; `pnpm validate` green; `validate:content` untouched or updated deliberately

## Phase 2 — Missions + click-meaningfulness UX pass (2–3 sessions + definition session)

v2 Phase 6c, never built. Missions chain existing modes into one directed arc — 🧠 Trace → ⚡ Speed Round → 🏆 Boss → Elo payoff — with a payoff at the end. Gated on Phase 1 (the chain's final link is the boss run). **Do not open this phase without the definition session** — the requirement v2 wrote and never satisfied.

**Definition session (blocking, before any build):** produces `docs/design/click-meaningfulness.md` answering, at minimum: what "every click feels meaningful" means operationally for this app (a testable lens — does every tap advance something the player can feel? — not a vibe); which existing surfaces currently fail it and why; what the mission flow's state machine is (entry point, per-stage completion criteria, abandonment/resume behavior, the payoff moment); and what's explicitly out of scope (full UI redesign is, unless the session decides otherwise in writing). Tooltips (v2 todo item 12) get dispositioned here too — they were parked to this phase's UX pass in v2.

**Build (shaped by the definition session; sketch only here, per the v2 convention that sketches don't bind build prompts):**

1. Mission state machine + persistence (schema bump rules as Phase 1's item 3).
2. Mission UI: the directed flow, per-stage transitions, the payoff moment.
3. The click-meaningfulness pass applied across the mission flow while it's being designed — not retrofitted, per v2's own note.
4. Telemetry: mission started/stage completed/abandoned/finished.

**DoD:**

- [ ] `docs/design/click-meaningfulness.md` exists and the build demonstrably follows it (the amendment cites which decisions came from which section)
- [ ] Full mission chain playable end-to-end; resume-after-close works; export/import round-trips mission state
- [ ] Isolated migration test for any schema bump; telemetry verified locally; `pnpm validate` green

## Phase 3 — Launch-readiness (1–2 sessions + Thomas verification passes)

The v1-style checks that only matter with real users, plus the three v2 Phase 8 items folded here by decision. Build items are sessions; verification items are Thomas's, listed as such — the v2 split, kept honest.

**Build:**

1. **PostHog growth dashboards, prebuilt**: day-2 return, session length, puzzles/session — the retention evidence v3 exists to produce, and the v4 entry-gate signal. Built before launch so day one produces data, not a dashboard-building scramble.
2. **PostHog quota math**: estimate events/session from real pre-launch data, multiply by the launch-spike scenario, check against the plan's monthly quota, and **decide the over-quota behavior (drop vs. pay) in advance, in writing** — scaling-gate item 2. Blowing the quota mid-spike is silent data loss on launch day.
3. **Fresh-user walkthrough script**: the stranger test — someone who has never seen Codoro solves a puzzle in ~10 seconds with zero instructions. Define the protocol (what's shown, what counts as failing) so the result is evidence, not anecdote. Includes first-run experience fixes if the walkthrough finds blockers — scoped small; anything big gets a written deferral.
4. **`/legal` lawyer review, external**: v2's notice is deliberately good-faith developer-written. Engage the review early (it's calendar time, not session time); it must land before Phase 5 posts. The Phase 4 privacy delta (anonId leaving the device for the leaderboard) goes into the same review — one pass, not two.
5. **SW precache re-download measurement** (open v2 Phase 7 item): diff the precache manifest across two consecutive real deploys and record the returning-PWA-user re-download cost — scaling-gate item 1's unfinished half.

**Verification (Thomas, against production):**

- [ ] **Full two-phone interaction regression (iOS + Android)**: all four quiz types + scrubber + challenge links + **boss runs + missions** — the v2 Phase 8 pass, now runnable because the excluded surfaces exist. Runs after Phase 2 merges, not before
- [ ] **PWA: install, offline boot, SW update prompt** against a real deploy (v2 Phase 8 carryover)
- [ ] **PostHog telemetry live**: scrubber, drag-order, boss, and mission events visible from production, from a real phone (v2 Phase 8 + Phase 0 carryover, finally closed)
- [ ] **Week-long storage-survival soak**: daily use on a real device for 7 days, no data loss across SW updates and iOS storage pressure
- [ ] **Cross-device Daily verification**: same calendar day, two devices, same puzzle
- [ ] **Fresh-user walkthrough run with ≥2 real strangers**, results recorded here as an amendment

**DoD:** every box above checked (or waived in writing with a reason), dashboards live, quota decision recorded, lawyer review engaged with the Phase 4 delta included.

## Phase 4 — Minimal anonymous backend (2–3 sessions)

First server code in the project's history. Cloudflare Workers + D1/KV on the existing account. **No auth, no PII, aggressive rate limiting** — an anonymous API is an open API, so abuse handling is scope, not polish. The v4 security block (Clerk, 2FA, token storage) stays deferred: nothing here creates accounts.

**Build:**

1. **`workers/` workspace package**: TypeScript, `wrangler`, wired into root `pnpm validate` (typecheck + lint + its own vitest suite) and CI deploy. Shared types for API payloads live in one place importable by both client and worker — no drifting duplicates.
2. **Anonymous leaderboard API**: `POST /api/scores` (anonId, mode ∈ {daily, rush}, score, day) and `GET /api/leaderboard?mode=&day=` (top N + the caller's own rank by anonId). **D1** for scores — relational, indexed top-N reads; **KV only if** a cache layer proves necessary under load test, decided per use case as the roadmap requires. Server-side plausibility validation (score bounds per mode, one write per anonId/mode/day — upsert, keep best), because an anonymous write path will be poked at.
3. **Rate limiting**: per-IP and per-anonId, on Workers. **Load-bearing, not nice-to-have** (roadmap's words) — it gets its own burst test in item 6, not just code review.
4. **Client integration, fire-and-forget**: leaderboard display on Daily/Rush (and boss, if Phase 1 landed it rated) results surfaces; submission never blocks or breaks the play loop; offline/failed submits degrade silently to the local-only experience. The local-first lock holds: pull the network cable and v2's behavior is exactly what remains.
5. **Edge OG meta injection**: per-route and per-puzzle `<title>`/description/OG tags injected at the edge — closes v2's deferred unfurl item, and covers the surface build-time prerendering never can (`/challenge`, dynamic payload — the v2 Phase 5c note said "until a v3 edge function exists"; this is that). Per-puzzle OG _images_ (v2's option b2) stay deferred unless trivially cheap — decide in the build prompt, record the decision.
6. **Load test + cost curve** (scaling-gate item 3): write path at launch-spike rates against D1's real write-throughput limits; burst test that rate limiting actually holds; **record the cost curve at 1×/10×/100× expected load** so a spike is a number, not a mystery.
7. **`/legal` delta**: the anonId now leaves the device when a score is submitted. One honest paragraph, same register as v2's challenge-links sentence; folded into Phase 3's lawyer review.

**DoD:**

- [ ] Leaderboard live on production behind a flag; submits are fire-and-forget; offline play unchanged (verified by an airplane-mode pass)
- [ ] Rate limiting holds under burst test; plausibility validation rejects out-of-bounds scores; both covered by worker-side tests
- [ ] Load test numbers + 1×/10×/100× cost curve recorded here as an amendment
- [ ] Edge meta verified with real unfurl debuggers (Slack/Discord/X) against production `/puzzle/:id` and `/challenge` URLs
- [ ] `workers/` fully inside `pnpm validate`; CI deploys on merge; `/legal` updated

## Phase 5 — Distribution (1 session + ongoing)

**Entry gate — the scaling validation amendment.** All four roadmap gate surfaces recorded here with measured numbers before anything is posted: (1) static delivery — cache headers verified live + Phase 3's SW re-download measurement; (2) PostHog quota math + over-quota decision (Phase 3); (3) backend load test + rate-limit burst + cost curve (Phase 4); (4) challenge links — scale-free by design, stated for the record. Plus: every Phase 0–4 DoD closed or waived in writing.

**Build/do:**

1. **SEO/prerender pass**: build-time prerendered HTML for static routes and `/puzzle/:id` pages (v2's priced option b1 — title/description per puzzle over the shared image). Complements Phase 4's edge injection; also the last Lighthouse win if Phase 0 left margin.
2. **Launch posts**: r/webdev, r/learnprogramming, HN Show, X. Each post's angle written and reviewed before posting day; staggered, not simultaneous — one channel's feedback improves the next post, and a staggered spike is a kinder load profile.
3. **Reel/short videos**: the v1-backlog marketing item — a scrubber solve is inherently watchable. Screen-capture based; AI-assisted editing if it earns its cost.

**DoD:** gate amendment recorded → posts live → each post's reception noted here (traffic spike shape, top feedback themes) — that record is Phase 6's starting input.

## Phase 6 — Growth loop (ongoing; produces the v4 gate evidence)

Not a phase that completes — the operating rhythm after launch.

1. **In-app feedback channel**: the **report-question button** (v2 todo item 18, undefined there, defined here by necessity — real users hitting bad content need a path that isn't "email a stranger"). Minimal shape: per-puzzle flag + optional free text → PostHog event (no new backend surface needed). Its build prompt writes the actual spec.
2. **Weekly content drops**: the pipeline runs (`validate:content` gates every batch, same as v2); mix steered by what real players actually play — the interaction-mix target logic from v2 Phase 6, now with real data instead of assumptions.
3. **Dashboard watch**: day-2 return, session length, puzzles/session, plus per-surface funnels. **Day-2 return is the honest v4 gate signal** — when it says people come back on their own and anonymous users visibly hit the identity ceiling, v4's build plan gets written.
4. **Fix what real users actually hit**: defects found by strangers go into this doc's defect table, same rules — commit or written waiver, nothing removed without one.
5. **AI-feature candidates stay parked** (hints, "explain my mistake") until dashboard/feedback data shows where players actually get stuck — the roadmap's continuous-track rule, unchanged.

**DoD (rolling):** feedback channel live within the first post-launch week; a content drop and a dashboard review recorded here (brief amendments) weekly for the first month; the v4 gate evaluated in writing at the end of that month — proceed, keep watching, or conclude the retention isn't there and say so honestly (roadmap principle 2: if v3 shows nobody wants this, v4/v5 never get built and nothing was wasted).

---

## Coding practices carried from v2 (binding, not aspirational)

1. **No fix without a root cause read out of evidence** — source, docs, or (new for OD-1) instrumented capture. Guessed fixes and threshold-retuning to paper over mechanisms stay banned.
2. **Every defect fix lands with a revert-check test** where the mechanism is testable — a test verified to go red when the fix is stashed out (the OD-3/OD-4 standard: verified red, not assumed red).
3. **Pool-level tests against real content** where content is the risk surface, with the test computing its expectation independently of the code under test.
4. **Amendments record what was observed, not what was assumed** — timestamps, commits, measured numbers. Claims that can't be verified in-session are labeled as outstanding and owned, never quietly checked off.
5. **Schema changes**: bump `CURRENT_SCHEMA_VERSION`, write the migration, write the **isolated** migration test (not chain-only coverage), confirm export/import round-trips.
6. **Deterministic, seeded content operations**; `validate:content` hard-fails distribution skews rather than warning.
7. **Strict TS** (`noUncheckedIndexedAccess` caught a real bug in v2 Phase 8 — it stays), ESLint, Prettier, husky pre-commit; `pnpm validate` green before merge, every session, no exceptions.
8. **Decisions get written down where the next session will look**: locked-decision tables, defect rows, design-question amendments. "Undecided" is a valid recorded state; silent is not.
9. **New for v3 — server code holds the same bar**: `workers/` is inside `pnpm validate`, worker endpoints get the same test discipline, and anything touching untrusted input (which is everything, on an anonymous API) treats validation and rate limiting as core logic, not middleware garnish. The OD-2 lesson generalizes: allowlists over blocklists for anything security-shaped.

## Traceability — every v2 carryover

| Carryover                                                              | Source                                       | Disposition                                                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| OD-1 swipe gesture (five rounds, waived)                               | v2 defect table / roadmap carryover 1        | **Phase 0** — instrumented capture, launch blocker                                                      |
| Mobile Lighthouse 84 → 90+ (waived)                                    | v2 Phase 7b DoD waiver / roadmap carryover 2 | **Phase 0** — dependency identified first, launch blocker                                               |
| Boss challenges (v2 Phase 6b, never built)                             | roadmap carryover 3 / todo item 1            | **Phase 1** — launch blocker                                                                            |
| Missions + click-meaningfulness (v2 Phase 6c, never built)             | roadmap carryover 3 / todo items 6, 8        | **Phase 2** — definition session required, launch blocker                                               |
| Two-phone interaction regression (v2 Phase 8, outstanding)             | v2 Phase 8 DoD                               | **Phase 3** verification — after Phase 2, so boss/mission surfaces are covered                          |
| PWA install/offline/SW-update check (v2 Phase 8, outstanding)          | v2 Phase 8 DoD                               | **Phase 3** verification                                                                                |
| PostHog production telemetry check (v2 Phase 0 + Phase 8, outstanding) | v2 Phase 0/8 DoD                             | **Phase 3** verification — prerequisite for Phase 3's quota math                                        |
| SW precache re-download cost measurement                               | v2 Phase 7 amendment item 12                 | **Phase 3** build item 5 — closes scaling-gate item 1                                                   |
| Per-route/per-puzzle OG unfurl (deferred to "v3's prerender option")   | v2 Phase 1b decision / Phase 8 Amendment 6   | **Phase 4** (edge injection, covers `/challenge`) + **Phase 5** (build-time prerender, b1)              |
| Per-puzzle OG images (option b2)                                       | v2 Phase 1b decision                         | **Phase 4** build prompt decides; default remains deferred                                              |
| Lawyer review of `/legal`                                              | v2 Phase 7 / roadmap 3.0                     | **Phase 3** build item 4 (includes Phase 4's anonId delta); blocks Phase 5                              |
| Optimistic rendering (deferred "until a network round-trip exists")    | v2 todo item 11 / Phase 7 amendment          | **Phase 4** — the leaderboard fetch is the first candidate; non-blocking, decide in build prompt        |
| Tooltips                                                               | v2 todo item 12                              | **Phase 2** — dispositioned inside the click-meaningfulness definition session                          |
| Tiered answers (undefined)                                             | v2 todo item 17                              | **Still deferred, still undefined** — needs its own definition session; not v3 scope unless one happens |
| Report-question button (undefined)                                     | v2 todo item 18                              | **Phase 6** build item 1 — defined there as the in-app feedback channel                                 |
| Fuller interaction-design track ("interact with the code" list)        | v2 todo item 7 / Phase 6 item 7              | **Phase 6** — steered by real-player data in the weekly drops; no dedicated phase in v3                 |
| AI features (undefined backlog item)                                   | v2 backlog / roadmap continuous track        | **Parked** — Phase 6 item 5; candidates evaluated only against real stuck-point data                    |
| Backend / leaderboard                                                  | v2 locked decision (deferred to v3)          | **Phase 4**                                                                                             |
| Security/accounts block (Clerk, 2FA, token storage)                    | v2 locked decision                           | **Still v4** — v3 is anonymous by locked decision; only rate limiting lands now (Phase 4)               |

## Traceability — every roadmap v3 row

| Roadmap item                                 | Phase here                                                         |
| -------------------------------------------- | ------------------------------------------------------------------ |
| 3.0 storage-survival soak                    | Phase 3                                                            |
| 3.0 fresh-user walkthrough                   | Phase 3                                                            |
| 3.0 cross-device Daily verification          | Phase 3                                                            |
| 3.0 growth dashboards prebuilt               | Phase 3                                                            |
| 3.0 lawyer review                            | Phase 3                                                            |
| 3.0 scaling validation gate (all four items) | Measured in Phases 3–4; recorded as Phase 5's entry-gate amendment |
| 3.1 Workers + D1/KV anonymous leaderboard    | Phase 4                                                            |
| 3.1 server-rendered OG share cards           | Phase 4 (edge meta; images deferred unless cheap)                  |
| 3.1 rate limiting                            | Phase 4                                                            |
| 3.2 launch posts                             | Phase 5                                                            |
| 3.2 AI-generated reel/short videos           | Phase 5                                                            |
| 3.2 SEO pass on puzzle pages                 | Phase 5 (prerender, b1)                                            |
| 3.3 in-app feedback channel                  | Phase 6                                                            |
| 3.3 weekly content drops                     | Phase 6                                                            |
| 3.3 dashboards → v4 gate evidence            | Phase 6                                                            |

## v4 — the trigger

v4 (accounts) opens only on evidence: **day-2 return says people come back on their own**, and anonymous users are visibly hitting the identity ceiling (asking for cross-device sync, or the anonymous leaderboard active enough that names matter). Phase 6's monthly written gate evaluation is where that call gets made — from `docs/roadmap.md`, unchanged. v3 builds nothing account-shaped on speculation.
