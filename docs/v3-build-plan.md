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

| Phase | Roadmap | What                                                                                                                                        | Est. sessions       |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 0     | —       | v2 defect carryovers: OD-1 instrumented capture + fix, mobile Lighthouse 84→90+                                                             | 1–2 + device passes |
| 1     | —       | Boss challenges (v2 Phase 6b, never built)                                                                                                  | 2                   |
| 2     | —       | Missions + click-meaningfulness UX pass (v2 Phase 6c, never built; **definition session required before build**)                            | 2–3 + definition    |
| 2b    | —       | UI/UX redesign: Tailwind migration, design tokens, click-meaningfulness app-wide, Missions staging clarity, sharing, Home, mastery page, QA | ~10 sessions        |
| 3     | 3.0     | Launch-readiness: v2 loose ends, soak, fresh-user walkthrough, dashboards, quota math, lawyer review                                        | 1–2 + Thomas passes |
| 4     | 3.1     | Minimal anonymous backend: Workers + D1/KV leaderboard, edge OG meta, rate limiting, load test                                              | 2–3                 |
| 5     | 3.2     | Distribution: prerender/SEO pass, launch posts, reel videos — **gated on the scaling validation amendment**                                 | 1 + ongoing         |
| 6     | 3.3     | Growth loop: feedback channel (report-question), weekly content drops, dashboard watch. **Produces the v4 gate evidence**                   | ongoing             |

**Sequencing.** Phase 0 first — it's the smallest and everything downstream (Phase 3's regression pass, Phase 5's launch) depends on the swipe working. Phase 1 → 2 in order (missions chain ends in a boss run; 6c was gated on 6b in v2 and still is). Phase 3's build items (dashboards, soak setup) can interleave with Phases 1–2, but its **gate** — the full regression pass — runs only after Phase 2 merges, because the pass must cover boss and mission surfaces or it will just be re-run. The lawyer review (Phase 3, external) starts as early as possible and runs in parallel with everything; it blocks Phase 5, not Phase 4. Phase 4 can start any time after Phase 0 but its load test is only meaningful against the final pre-launch build. Phase 5 is hard-gated: **no post goes out until the scaling validation amendment is recorded with measured numbers and every Phase 0–4 DoD is closed.** Phase 6 begins the day the first post lands and doesn't end — it's the feedback loop, not a phase that completes.

## Known open defects

Same rule as v2: confirmed-real defects deliberately not yet fixed live here, above the phases. **Nothing is removed from this table without a commit that fixes it.** Anything unfixed at Phase 5's gate either blocks launch or gets an explicit written waiver.

| #    | Defect                                                                                                                                                                                                                                                                                                                               | Confirmed on                                                                                                                                                                                                                                                                 | Owner phase | Status                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-1 | Swipe gesture unreliable on phone: normal-speed or slightly-diagonal swipes claimed by native scroll; only fast, purely-horizontal flicks commit. Survived five v2 fix rounds, then four more v3 rounds (OD-2 through OD-4) inside a Pointer-Events-plus-`touch-action` model that never fully stopped WebKit reclaiming the gesture | iPhone 15 Pro, iOS 26.5.2, production preview builds, both PWA and browser tab. **Closed 2026-08-10** — architecture pivot to native Touch Events (OD-5, matching `react-tinder-card`'s proven pattern), confirmed by Thomas's fifth on-device capture pass ("It works now") | Phase 0     | **Closed, commit `624c346`.** Root cause chain and every fix cited real captured device evidence (Amendments 3–7) — no threshold retuning, no guessed fix. See Phase 0 amendments. |

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

- [x] OD-1 root cause stated from captured on-device data, fix merged, and **Thomas's on-device re-test passes** (iPhone 15 Pro, PWA + tab — the bar every v2 fix skipped or failed). Defect-table row closed by commit, or re-waived with the capture attached — **met, 2026-08-10.** Five rounds of on-device capture (Amendments 3–7): three real root causes fixed, one candidate disproven by evidence, one full architecture pivot (OD-5) informed by a proven reference implementation, confirmed working by Thomas on the fifth re-test ("It works now").
- [x] Revert-check test for the fix's testable mechanism, following v2's convention (`SwipeBinary.test.tsx`) — **met, 2026-08-10.** 23 tests (rewritten for the OD-5 native-Touch-Events architecture); the unconditional `touchstart` `preventDefault()` call verified red when stashed out; full suite green.
- [x] Lighthouse: offending dependency identified and named in an amendment; mobile performance ≥90 measured on production post-fix, or a written re-waiver citing what the dependency swap would break — **met via re-waiver, 2026-08-10.** See Amendment 1 below.
- [x] `pnpm validate` green; instrumentation stripped or flag-gated — **met, 2026-08-10.** 1629/1629 tests, typecheck, lint, build all green. Instrumentation kept, permanently flag-gated (see Amendment 7) rather than stripped — the plan's own "or" clause.

**Amendment 7 — Phase 0 item 1, OD-1 closed, 2026-08-10.** Thomas's fifth on-device capture pass, against the OD-5 architecture pivot (Amendment 6), confirmed the fix: "It works now." **Defect-table row OD-1 closed by commit `624c346`** (and the chain of commits in Amendments 3–6 leading to it), first captured-evidence-only close since the v2 waiver — no threshold retuning, no guessed fix; every round cited what the device actually showed. **Instrumentation disposition**: `useGestureDebugOverlay.tsx` is kept rather than stripped, per Phase 0 build item 4's explicit "or gate it permanently behind the dev flag" alternative — it's already fully isolated (one import, dev-flag-gated, zero cost when `?gesture-debug=1` is absent), and proved valuable enough across five capture rounds that removing working, cheap diagnostic tooling outright would be a net loss for the next gesture-shaped defect this app hits. Its doc comment is updated to record this as a deliberate keep, not an oversight. OD-1's traceability note in this doc's "Known open defects" table is updated to closed below. — Phase 0 items 1–2, OD-5 (architecture pivot), 2026-08-10.** Thomas's fourth capture showed OD-4's rAF-batching fix did **not** hold: the exact same `pointercancel`-instead-of-`pointerup` pattern persisted across 3 more gestures, one of which travelled 175px (nearly 3× the 120px commit threshold) before still dying to `pointercancel`. OD-4 is disproven, not silently dropped — its attempt and disproof both stay in the git history and this doc rather than being erased, per the "amendments record what was observed" convention. Per the "3+ fixes revealing a new problem in the same place means question the architecture" rule, the next step was research rather than a fifth internal hypothesis: [`react-tinder-card`](https://github.com/3DJakob/react-tinder-card)'s actual source — the most directly comparable, widely-used, production-tested reference implementation for exactly this UI pattern — uses no Pointer Events, sets no `touch-action` at all, and calls `preventDefault()` **unconditionally at `touchstart`**, before axis is even known, rather than deferring the decision into the gesture the way every round of this rewrite (OD-2 through OD-4) did. **Architecture pivot, not another patch**: `SwipeBinary.tsx` now uses raw native `touchstart`/`touchmove`/`touchend`/`touchcancel` listeners via `useEffect` + `addEventListener({ passive: false })` — not React's synthetic touch props, which React makes passive by default (silently breaking `preventDefault()`) — attached once (mount-only) and reading `committed`/`handlePick` through refs so they're never torn down mid-gesture. `preventDefault()` fires unconditionally on `touchstart`. **Real, deliberate behavior change**: OD-2's `window.scrollBy` vertical-scroll-forwarding is gone — a touch that starts on the card and drifts vertical now does nothing (card doesn't move, page doesn't scroll), matching how `react-tinder-card` and Tinder itself actually behave (the card owns 100% of a touch that starts on it). The surrounding page (filter chips, puzzle list) is unaffected — only touches starting on the card lose scroll-passthrough, a requirement inherited from the original `@use-gesture` implementation that may never have been a real product requirement. Mouse/pen are unchanged in spirit (still Pointer Events), explicitly gated to skip `pointerType === 'touch'` now that touch is fully owned by the listeners above. `gestureThreshold.ts` and the Framer Motion visual layer are unchanged through all five rounds. Test suite rewritten (23 tests) to drive real `touchstart`/`touchmove`/`touchend`/`touchcancel` events via `createEvent`/`fireEvent`, since jsdom has no native `TouchEvent`. `pnpm validate` green (1629/1629 tests, typecheck, lint, build). **Still owed**: Thomas's on-device re-test — this is the deepest change yet, and the one most likely to actually close OD-1, but "likely" isn't evidence; only the device is.

**Amendment 5 — Phase 0 items 1–2, OD-4 (candidate — see caveat), 2026-08-10.** Thomas's third capture (incognito tab, ruling out stale-service-worker as a confound) showed the OD-2/OD-3 fixes holding — no `lostpointercapture`, `preventDefault` succeeding consistently across all 4 gestures — but a new pattern: every single gesture (4 of 4) resolved horizontal cleanly, tracked several successful moves, then died to a plain `pointercancel`. None ever reached `pointerup`, the event a normal finger-lift produces. **Hypothesis, not yet device-confirmed**: the one thing that changed once OD-2/OD-3 stopped killing gestures within their first couple of frames is that `useGestureDebugOverlay`'s own `log()` call was running `setLines` — a React state update — synchronously inside the `pointermove` handler, forcing a full `SwipeBinary` re-render (plus up to 24 overlay DOM nodes) on every move sample, on the main thread, inside the touch-dispatch path; iOS Safari is documented to cancel a touch it judges the page too slow to keep up with. **Change made**: `log()` now buffers into a ref and flushes to state at most once per animation frame, moving that render cost off the synchronous touch-handling path. **Explicitly labeled a candidate, not a confirmed fix**: unlike Amendments 3–4, this one's evidence is circumstantial (the overlay's cost correlating with when the new failure became visible) rather than a captured mechanism (no log field directly shows "cancelled because the main thread was busy" the way `cancelable`/`lostpointercapture` showed the prior two root causes directly) — flagged honestly rather than overclaimed. If the next capture shows `pointercancel` persisting after this change, the debug overlay itself is not the cause and a fourth hypothesis is needed from that data. Real irony noted for the record: the temporary diagnostic instrument may have been contributing to the very symptom it was built to observe.

**Amendment 4 — Phase 0 items 1–2, OD-3, 2026-08-10.** Thomas's second on-device capture (same PR #54 preview, post-OD-2-fix) showed a new failure: three of three horizontal-resolving gestures fired `lostpointercapture` within 0–13ms of this component's `setPointerCapture()` call — not `pointercancel`, and not this component's own code (which only releases capture from `pointerup`/`pointercancel`/`lostpointercapture` itself). `handleLostPointerCapture` read that as "gesture over" and sprang the card back to center mid-drag, while the finger was still down — very likely the reported "jumpy" feeling. **Root cause**: touch pointers receive _implicit_ pointer capture on `pointerdown` per the Pointer Events Level 3 spec (this component's own doc comment already noted this); the explicit `setPointerCapture()` call was pure redundancy on a pointer WebKit already owned, and WebKit's handling of that redundant call is what produced the spurious `lostpointercapture`. **Fix**: skip the explicit call entirely when `event.pointerType === 'touch'`; kept for mouse/pen, which have no implicit-capture guarantee. Revert-check test added and verified red when stashed out. **Flagged, not fixed — thin evidence**: the same capture's one vertical-resolving gesture ended in a plain `pointercancel` (not `lostpointercapture`) about 1ms after its first `window.scrollBy` call; only one data point exists for this, not enough to act on per the "no fix without root cause read from evidence" rule, so it is left as an open question for the next capture round rather than guessed at (e.g. by speculatively deferring `scrollBy` to `requestAnimationFrame`). **Still owed**: Thomas's next on-device re-test, now against both the OD-2 and OD-3 fixes together.

**Amendment 3 — Phase 0 items 1–2, OD-2 (the real root cause), 2026-08-10.** Amendment 2's `pan-y` fix was falsified by Thomas's first real on-device capture against the PR #54 preview (iPhone 15 Pro, `?gesture-debug=1`) — the actual instrumented-capture evidence the v3 plan's OD-1 method requires, not a sixth source-reading guess. The captured log showed a clean, deliberate horizontal drag: axis correctly resolved `horizontal` at dx=24 (dy≈1, unambiguous), `preventDefault()` called successfully on three consecutive moves (`cancelable` stayed `true` throughout — the "browser already committed to scroll" mechanism the fix was built to detect never fired) — and WebKit still killed it with `pointercancel` one frame later. **Root cause**: under `touch-action: pan-y`, WebKit's native pan gesture recognizer runs in parallel with JS and can independently claim and cancel a touch; that authority comes from `pan-y` itself granting permission to pan vertically, and is not gated on whether individual `pointermove` events had `preventDefault()` called on them. Consistently successful `preventDefault()` calls — which the capture proves we had — cannot revoke a `touch-action` grant. This is a different, deeper mechanism than OD-1's original framing (broken axis detection / non-cancelable events); logged as **OD-2** since it's a distinct bug the capture uncovered, not a restatement of OD-1. **Fix**: `touch-action: none` (both `practice.css` and the inline style), removing WebKit's competing recognizer entirely; the `vertical-yielded` branch now forwards page scroll manually via `window.scrollBy(0, -dy)` every move, since there is no more native scroll to fall back on. Real, accepted trade-off: a vertical swipe on the card loses native momentum/inertia and elastic overscroll bounce (plain `scrollBy`, not a physics simulation) — flagged here, not fixed, since adding hand-rolled inertia is real scope beyond closing OD-1/OD-2. `pnpm validate` green; revert-check for the new `scrollBy` call verified red when stashed out. **Still owed**: Thomas's on-device re-test of this specific fix — the mechanism that broke `pan-y` (a parallel native recognizer) is exactly the class of thing that can only be confirmed absent on the real device, not in jsdom.

**Amendment 2 — Phase 0 items 1–2, OD-1 rewrite, 2026-08-10.** `SwipeBinary.tsx` rewritten off `@use-gesture/react`'s `useDrag` onto native Pointer Events, mirroring `DragOrder.tsx` — the sibling interaction that has always worked reliably on the same iPhone — rather than attempting a sixth tuning round inside the gesture-library model that failed five times. `touch-action: pan-y` stays static (never runtime-toggled) in both CSS and inline style; axis arbitration (20px tolerance, carried from the old `axisThreshold.touch` value) is hand-rolled and inspectable rather than delegated to `@use-gesture`'s own experimental `preventScrollAxis`; `gestureThreshold.ts`'s commit math is unchanged. Ships with the `?gesture-debug=1` on-screen capture overlay (`useGestureDebugOverlay.tsx`) Phase 0 item 1 calls for. **Independent finding from this rewrite's review, not part of the original OD-1 report**: `.swipe-fallback__card` had no `user-select`/`-webkit-touch-callout` rule, unlike `.drag-order__row`'s identical pattern — a drag started on the card's syntax-highlighted snippet could trigger native text selection or iOS's long-press callout instead of/alongside the swipe. Very likely the mechanism behind "sometimes it thinks I'm highlighting the code block," a distinct symptom from OD-1's scroll-arbitration failure; fixed in the same commit. **Still open**: whether `preventDefault()` on a `pointermove` actually blocks WebKit's scroll commit is the one part of this fix untestable in jsdom — the debug overlay's `cancelable` field is built specifically to answer that from Thomas's on-device capture, which is the remaining step to close this defect-table row.

**Amendment 1 — Phase 0 item 3, mobile Lighthouse Legacy JS, 2026-08-10.** Owning dependency identified: **`posthog-js@1.404.1`**. Sourcemap trace (`module-Cwtw1I8F.js.map`, built with `--sourcemap`) shows the entire chunk is exactly one source: posthog-js's own published `dist/module.js` — confirming Vite is already resolving posthog-js's most modern entry (no `exports` map in their `package.json`; only `main`/`module` fields; Vite's default resolution already prefers `module` over `main`). No modern/no-polyfill entry exists to swap to: checked all posthog-js dist bundle variants (`module.js`, `module.slim.js`, `module.no-external.js`, `module.slim.no-external.js`, `main.js`) — 24 of 39 published `.js` files under `posthog-js/dist` carry the identical `Math.trunc||(Math.trunc=...)`/`Number.isInteger||(...)` shim, including every "slim"/"no-external" alternative. It's baked into posthog-js's own build (their `package.json` declares `browserslist: "> 0.5%, last 2 versions, Firefox ESR, not dead"`, a deliberately broad legacy target they control — unrelated to and untouched by this app's own `vite.config.ts` `build.target: ['ios17','safari17','chrome120','edge120']`, which only downlevels this app's own source, never a dependency's pre-bundled code). Replacing posthog-js outright is not a trivial, safely-scoped change — it's the app's sole telemetry provider, wired through `src/telemetry/client.ts`'s single choke point with PostHog-specific config (`person_profiles: 'identified_only'`, `register()`-based anon-ID super property, `disable_external_dependency_loading`). **Re-waived**: this ~8.5 KiB is inherent to posthog-js as published, not a fixable local config/entry-point choice. If Phase 0's Lighthouse gate still needs to clear 90+, the remaining path is either (a) accept the ~8.5 KiB and find margin elsewhere, or (b) a future session evaluates swapping posthog-js for a different analytics provider — a real dependency-swap project, not a Phase 0-scoped fix.

## Phase 1 — Boss challenges (2 sessions)

v2 Phase 6b, never built; the sketch in `v2-build-plan.md`'s Phase 6b section is the starting point. A run of 10 puzzles of escalating difficulty — a fourth own-mode following Rush's structural precedent (session hook + page + route), distinct from Rush: **fixed-length, curated-difficulty, not endless-against-the-clock.** The content gate that blocked it in v2 is open (214 puzzles).

**Design questions — settled, 2026-08-10 (direct user decision, before any Boss code):**

1. **Selection: curated fixed sets.** Hand-authored 10-puzzle sequences, not rating-laddered draws from the pool — the opposite of this doc's own recommendation (rating-laddered, seeded by run/date). Chosen anyway for pacing/narrative control over a run: a boss fight reads as authored escalation, not a random sample that happens to trend harder. **Accepted trade-off, stated for the record:** authored sets are content that goes stale as the pool grows and need maintenance the ladder approach would have avoided for free — a real cost, taken deliberately.
2. **Best-score-only**, matching Rush's precedent exactly. No Elo integration in this phase; the `+24 Elo` payoff framing from the v2 todo item does not land in Boss.
3. **End condition: strikes** (3 wrong answers ends the run), not survive-all-10. More forgiving — the payoff is the escalating-difficulty arc itself (how deep a run got), not flawless play; a single early misclick ending a 10-puzzle run would undercut that framing.
4. **Boss completion is the mission-progression trigger surface.** Wired now so Phase 2's mission chain (🧠 Trace → ⚡ Speed Round → 🏆 Boss → Elo payoff) doesn't have to retrofit a trigger onto Boss after the fact.

**Build:**

1. `/boss` route + `ROUTE_META` entry, page, session hook — Rush's file structure as the template (`src/app/rush/` → `src/app/boss/`).
2. Run assembly per the settled selection design; deterministic and seeded, tested against the real pool (v2's convention: pool-level tests, not fixtures only, where the real content is the risk surface).
3. Storage: best-run record (and rating integration if question 2 lands "rated"). Any schema change bumps `CURRENT_SCHEMA_VERSION` with a migration **and an isolated migration test** — the v2 Phase 8 pattern, no indirect-only coverage.
4. Telemetry: run-started/run-ended events with outcome and depth reached, matching existing event conventions.
5. Payoff surface: end-of-run summary with the escalation arc visible (this is where the todo item's framing lives, whatever question 2 decided).

**DoD:**

- [ ] Boss mode playable end-to-end on desktop and mobile widths; run assembly deterministic (seeded) and covered by pool-level tests — **partially met, 2026-08-11**: run assembly is a fixed array (no RNG needed by construction — see decision below) and is covered by `bossRun.test.ts` (real-pool test) + `validatePuzzles.test.ts`'s `validateBossRun` suite; `BossPage`/`useBossSession` are covered by component/hook tests (11 tests total). **The desktop/mobile real-viewport playthrough itself is Thomas's own, outstanding** — same split as every prior phase (sessions build and test, Thomas verifies on real widths/devices) — not silently checked off.
- [x] Design questions 1–4 answered in a written amendment here, with reasoning — the v2 standard for decision records — **met, 2026-08-10** (see "Design questions — settled" above)
- [x] Schema bump (if any) has an isolated migration test; export/import round-trips the new fields — **met, 2026-08-11**: `bossStats` added, schema v6→v7, isolated `MIGRATIONS[6]` test in `migrations.test.ts`, `exportImport.test.ts` fixtures updated and round-trip verified.
- [x] Telemetry events verified firing locally; `pnpm validate` green; `validate:content` untouched or updated deliberately — **met, 2026-08-11**: `attempt` (mode: 'boss') and `boss_run_end` events unit-tested against the mocked PostHog capture call (`telemetry.test.ts`); `pnpm validate` green (see Amendment below); `validate:content` deliberately extended with `validateBossRun`.

**Amendment — Phase 1 build complete, 2026-08-11.** Built via `superpowers:subagent-driven-development`'s process (Task 1 only) then switched to direct inline execution for Tasks 2–9 after Task 1's actual subagent cost (~$25 for the smallest task) made the full 9-task subagent-per-task approach disproportionate — a direct user decision, recorded here since it changed how the rest of this phase was built, not just what was built. Every task still followed TDD (red/green) and was committed individually; inline execution substituted a human review checkpoint for the automated per-task reviewer subagent from Task 2 onward.

1. **Run-assembly decision, finalized.** A single hand-authored `BOSS_RUN` array (`src/content/bossRun.ts`, 10 real puzzle ids spanning 900→2075 rating, escalating) — not the multi-set registry the build item's "deterministic and seeded" phrasing implied. Direct user decision, 2026-08-10 (mid-build): ship one set now, explicitly flagged (in `bossRun.ts`'s own doc comment and here) that Boss needs more than one curated set soon — a single fixed sequence's novelty runs out fast for a repeat player. Deferred, not silently punted: the next step is a `BOSS_SETS` registry + selection function (rotate by runs completed, or a calendar index mirroring `DAILY_CALENDAR`), out of this phase's scope by design (kept it buildable in-session).
2. **Boss has no per-puzzle clock**, unlike Rush — Phase 1's settled design questions never called for one, only the 3-strikes end condition. Simpler than Rush by design: no widening-pool selection (fixed order), no timer/visibilitychange machinery.
3. **`BOSS_STRIKE_LIMIT = 3`** lives in a new `src/engine/boss.ts`, independently of Rush's `RUSH_STRIKE_LIMIT` (same value today, deliberately not shared — see that file's own doc comment for why coupling them would be wrong).
4. **"Depth reached" is the score**: 1-indexed position of the last puzzle a run reached, right or wrong, capped at 10 — reaching puzzle 10 always ends the run (no puzzle 11), so depth alone can't distinguish a clean finish from losing the 3rd strike there. **`cleared` is `depthReached >= 10 AND finalStrikes < 3`** — a run whose 3rd strike lands on puzzle 10 is `cleared: false`, exactly like striking out anywhere earlier. `ended_reason: 'strikes' | 'completed'` names which ending condition actually fired, independent of `cleared`. (An earlier draft got this wrong — see "Final review" below.) `bossStats` tracks `bestDepth`/`clears`/`runs`/`lastRunAt`, mirroring `rushStats`'s null-until-first-run convention.
5. **Scope decision: no BossShareCard/BossChallengeCard this phase.** The build item list above asks only for an end-of-run summary, not share/challenge parity with Rush/Daily/Practice — built exactly what was asked, flagged as a fast-follow candidate if parity is wanted later, not silently added.
6. **`pnpm validate` green**: typecheck clean, lint clean, `validate:content` reports `214 puzzle(s) OK, 16 daily-calendar entries OK, boss run OK`, production build succeeds (`BossPage` gets its own code-split chunk, matching Rush's own chunk-isolation precedent). Full suite: one failure (`TraceRunner.od4.pool.test.tsx`, an OD-4 Trace-masking test, unrelated to Boss) is a confirmed pre-existing flake under full-suite parallel load: reproduced timing out at 5000ms in the full run, then passed cleanly (46/46) in isolation. Not a Boss regression; not silently ignored either — named here for the record.
7. **Still owed**: the desktop/mobile real-device playthrough (DoD line 1's remaining half) — Thomas's own pass, per this doc's standing convention.

**Final review, 2026-08-11.** A whole-branch review (most capable model, per `superpowers:subagent-driven-development`'s process) found no Critical issues but several real Important/Minor ones, all fixed same-session:

1. **`cleared`/`ended_reason` correctness (Important, fixed).** The build item 4 text above ("Depth reached is the score") originally computed `cleared` from depth alone — true whenever a run reached puzzle 10, _even if the final answer lost the 3rd strike there_ — and documented an `ended_reason` telemetry field that was never actually shipped. Both fixed together (see item 4, corrected above): `cleared` now requires not being struck out; `ended_reason: 'strikes' | 'completed'` added to `BossRunEndPayload`. Real product-correctness bug — a losing run could have shown "Boss cleared!" and incremented `bossStats.clears`, which Phase 2's mission trigger reads as "has this player ever cleared a boss run."
2. **Test coverage gaps (Important, fixed).** Added: a test seeding `loadProfile` with populated prior `bossStats` (the `priorStats?.x ?? 0` branches were previously only ever exercised with `null`), and the exact plan-flagged edge case (3rd strike landing on puzzle 10) plus its counterpart (a non-eliminating wrong answer on puzzle 10 still clears).
3. **Dev-stub toggle dead-ended Boss (Important, fixed).** `BOSS_RUN`'s curated ids don't exist in `DEV_STUB_PUZZLES`, so the dev toggle made `/boss` permanently show "not available" — the same problem Daily already solved for its own curated calendar. Added `resolveBossStubPuzzle` (`devPuzzleMode.ts`), mirroring `resolveDailyStubPuzzle` exactly.
4. **Run-started event: recorded as intentional, not added.** Build item 4's literal text calls for "run-started/run-ended events," but only run-ended shipped — matching Rush's own precedent (Rush has no start event either). **Direct user decision, 2026-08-11: follow precedent, don't add one.** Consequence, stated for the record: an abandoned run emits `attempt` events but no run-start/abandon signal, so `bossStats.runs` only counts finished runs.
5. **Home hub had no Boss card (finding, addressed).** No task in this plan's 9 tasks ever scoped `Home.tsx` — a real gap in the plan, not a skipped implementation step. **Direct user decision, 2026-08-11: add it.** Boss's card mirrors Rush's exactly (`Best depth {n}` chip from `bossStats.bestDepth`). `.home__cards-secondary`'s CSS grid was hand-tuned for exactly 3 tracks (documented minmax math) — re-tuned for 4 in the same change, not just copy-pasted, or Boss's card would have wrapped alone into a near-empty row.
6. **Minor fixes**: `useBossSession`'s mount-effect/`retryLoad` duplicated ~12 lines verbatim (extracted to `loadAndStart`, which also fixed a copy-pasted wrong error-context string); `BossPage` now imports `BOSS_STRIKE_LIMIT` instead of hardcoding `3`; a stale "four-entry list" comment in `routes.ts` corrected; an `exportImport.test.ts` v5-shaped fixture had `bossStats: null` incorrectly added (a genuine v5 profile predates that field) — removed.

Reviewer's verdict before these fixes: "Ready to merge: With fixes." All Important/Minor findings addressed same-session; `pnpm validate` re-verified green after.

## Phase 2 — Missions + click-meaningfulness UX pass (2–3 sessions + definition session)

v2 Phase 6c, never built. Missions chain existing modes into one directed arc — 🧠 Trace → ⚡ Speed Round → 🏆 Boss → Elo payoff — with a payoff at the end. Gated on Phase 1 (the chain's final link is the boss run). **Do not open this phase without the definition session** — the requirement v2 wrote and never satisfied.

**Definition session (blocking, before any build):** produces `docs/design/click-meaningfulness.md` answering, at minimum: what "every click feels meaningful" means operationally for this app (a testable lens — does every tap advance something the player can feel? — not a vibe); which existing surfaces currently fail it and why; what the mission flow's state machine is (entry point, per-stage completion criteria, abandonment/resume behavior, the payoff moment); and what's explicitly out of scope (full UI redesign is, unless the session decides otherwise in writing). Tooltips (v2 todo item 12) get dispositioned here too — they were parked to this phase's UX pass in v2.

**Build (shaped by the definition session; sketch only here, per the v2 convention that sketches don't bind build prompts):**

1. Mission state machine + persistence (schema bump rules as Phase 1's item 3).
2. Mission UI: the directed flow, per-stage transitions, the payoff moment.
3. The click-meaningfulness pass applied across the mission flow while it's being designed — not retrofitted, per v2's own note.
4. Telemetry: mission started/stage completed/abandoned/finished.

**DoD:**

- [x] `docs/design/click-meaningfulness.md` exists and the build demonstrably follows it (the amendment cites which decisions came from which section) — **met, 2026-08-11**: definition session run as a live dialogue with Thomas (not an offline write-up), doc committed. See amendment below.
- [x] Full mission chain playable end-to-end; resume-after-close works; export/import round-trips mission state — **met via automated coverage, 2026-08-11**: full 3-stage chain driven end-to-end in `useMissionSession.test.ts` (fake-timer-driven timer expiry through all three stages to `'complete'`), `MissionsPage.test.tsx` (phase→component routing), and each stage's own native-vs-timer tests. Resume-after-close: seeded mid-arc `missionProgress`, fresh mount, correct stage + fresh clock (`useMissionSession.test.ts`). Export/import: populated `missionProgress`/`missionStats` round-trip fixture (`exportImport.test.ts`). See build-item amendment below for what this doesn't cover.
- [x] Isolated migration test for any schema bump; telemetry verified locally; `pnpm validate` green — **met, 2026-08-11**: `MIGRATIONS[8]` tested in isolation (`migrations.test.ts`), not just via the full v1→v9 chain test. All four mission telemetry functions (`trackMissionStart`/`trackMissionStageComplete`/`trackMissionAbandoned`/`trackMissionFinished`) have capture-shape + no-op-when-key-unset tests (`telemetry.test.ts`), same convention as every other locked event. `pnpm validate` green throughout every build item (see amendment).

**Amendment — definition session complete, 2026-08-11.** Run live rather than offline, per this phase's own blocking requirement (never satisfied in v2). Locked decisions, direct user decisions this session, written out in full in `docs/design/click-meaningfulness.md`:

1. **Stage sizing**: uniform time-boxed stages, 60 seconds each (not the bounded-doses-per-mode alternative) — untuned by admission, same honest posture as Rush's own flat per-puzzle clock.
2. **Timer cutoff**: soft — the on-screen puzzle finishes before the clock is checked; never interrupts mid-puzzle.
3. **Stage end condition**: timer OR the mode's own native end (Rush's 3-strike limit, Boss's 3-strikes/depth-10), whichever fires first. Trace has no native end at all — the timer is its only one, a stated asymmetry, not an oversight. Boss's stage will almost always end via timer, not its own limit — accepted trade-off.
4. **Payoff**: celebration/recap screen only. **No bonus-Elo/rating mechanic invented** — a deliberate rejection of `docs/todo.md`'s literal "+24 Elo" framing, matching Boss Phase 1's own "no Elo integration" call and this app's no-fake-numbers rule.
5. **Replayability**: unlimited, anytime, mirroring Boss's "Run it back."
6. **Resume**: restarts at the current stage with a fresh clock; completed-stage results are kept. Achieved structurally — mission progress is persisted only at stage boundaries, never mid-stage, so there's nothing to distinguish a bare tab close from an ordinary resumable state.
7. **Abandon**: a distinct, explicit "Exit mission" action (not inferred from a tab close), which clears progress and fires its own telemetry event.
8. **Tooltips** (v2 todo item 12): deferred explicitly, same disposition as Phase 6's parked AI features — no tooltip component exists yet and there's no real-user confusion data pre-launch to design one against.

Full implementation plan (schema v8→v9, `useMissionSession` design, UI/routing, telemetry, test plan, session-sized sequencing) written to `docs/superpowers/plans/` this same session; build not yet started.

**Amendment — build complete, 2026-08-11.** Six session-sized build items, each committed individually with `pnpm validate` green: (1) `RushActivePlay`/`BossActivePlay` extraction (pure, zero behavior change — `RushPage.test.tsx`/`BossPage.test.tsx` passed unmodified immediately after); (2) schema v8→v9 (`missionProgress`/`missionStats`, isolated `MIGRATIONS[8]` test, export/import round-trip); (3) `useMissionSession`'s core state machine (phase transitions, the 60s stage clock, boundary-only persistence); (4) real `TraceStage`/`SpeedStage`/`BossStage` components; (5) `MissionsPage`/`MissionCheckpoint`/`MissionComplete` + routing/nav/Home wiring; (6) this amendment + final validate. Which build decisions came from which section of `docs/design/click-meaningfulness.md`, per this DoD's own requirement:

- **§1's gating-tap test** → `MissionCheckpoint.tsx` previews the next stage's icon/name/duration before the Start/Continue tap; the destination is legible before tapping, satisfying the test at exactly the boundary §2 flags as the highest-stakes place for Missions not to repeat the app's systemic answer→Continue gap (a blind advance into an entirely different mode would be a bigger miss than within one mode). §2's own audit of that systemic gap was explicitly _not_ fixed app-wide — out of scope per §4 — and stays unfixed everywhere outside Missions' own checkpoint boundary.
- **§3 decision 1 (60s uniform stages)** → `MISSION_STAGE_DURATION_MS` (`missionStageClock.ts`), reused as the single deadline math both `useMissionSession`'s display clock and every stage's own cutoff check read.
- **§3 decision 2 (soft cutoff)** → `hasStageClockExpired` is checked only at each stage's own Continue-tap interception (`TraceStage`/`SpeedStage`/`BossStage`'s `continueWithinStageOrEndStage`/`handleContinue`), never from a push-based timer that could interrupt an in-progress puzzle.
- **§3 decision 3 (timer OR native end, whichever fires first; Trace has no native end)** → the native-vs-timer branch in `SpeedStage`/`BossStage` (a pending strike-out/depth-reached takes priority over an already-expired clock, since it's the "real" ending — see `useMissionSession.ts`'s own doc comment); `TraceStage` has no such branch at all — every one of its completions is `endedReason: 'timer'`, the stated asymmetry made real in code, not just in prose.
- **§3 decision 4 (no invented rating/Elo number)** → `MissionComplete.tsx`'s `recapDetail` only ever reads `solvedCount`/`streak`/`depthReached`/`cleared` off `MissionStageStats` — there is no rating-delta field in that type to surface. Guarded by a regex-based test (`MissionsPage.test.tsx`) asserting no signed-integer rating-delta-shaped token ever renders on that screen.
- **§3 decision 5 (unlimited replay)** → `handleRunItAgain` starts a fresh run from `'complete'` with no gate.
- **§3 decision 6 (resume: fresh clock, prior stages kept)** → `hydrateFromProfile` reads a persisted `missionProgress` and resumes at `currentStage`/`completedStages`, but `handleStartStage` always issues a brand-new deadline — no paused-countdown serialization exists anywhere in the schema.
- **§3 decision 7 (abandon is a distinct explicit action)** → `missionProgress` is written to storage only at stage boundaries (`handleStartStage`'s first-run guard, `handleStageComplete`, `handleAbandon`) — structurally, a bare tab close has nothing to distinguish from an ordinary resumable state; only `MissionCheckpoint`'s two-step "Exit mission?" confirm reaches `handleAbandon`.
- **§5 (tooltips deferred)** → no tooltip component was added anywhere in this build, consistent with the deferral.

**What this build item did not do**, stated rather than silently skipped: Thomas's own manual desktop/mobile playthrough (start → all 3 stages → payoff → "Run it back", plus a real resume-after-close and a real abandon) has not run yet — the DoD box above is checked on the strength of full automated coverage of the same state machine, per this repo's standing build-vs-verify split (sessions build/test, Thomas verifies real widths/devices), not as a substitute for that pass. Telemetry "verified locally" means unit-tested against a mocked PostHog capture call, the same meaning Phase 1's own DoD used for that phrase — no live PostHog dashboard was checked.

## Phase 2b — UI/UX redesign (~10 sessions)

Sits between Phase 2 (Missions, merged as PR #57) and Phase 3 (Launch-readiness). Origin: `docs/design/click-meaningfulness.md` §2/§4 already named the systemic answer→Continue gap as "a full-UI-redesign question," explicitly out of scope for Missions — this phase is that deferred work, plus a working session with Thomas (2026-08-12) that surfaced the rest of the list below. Folded in here from `docs/ui-redesign-plan.md` (now deleted) per that file's own instruction, by the session that opened 2b.0.

**Explicitly not touched by this phase — already correctly resolved, do not re-open without new evidence:**

- Skeleton loaders — scoped correctly in Phase 7 (route-chunk `Suspense` boundary only; every other "loading" state resolves off IndexedDB in single-digit ms).
- Optimistic rendering — deferred, in writing, to v3 Phase 4 (first real network round-trip).
- Theme picker — direct user decision, 2026-08-12: **later**, not this phase. The token work is built theme-ready (CSS custom properties, no hardcoded hex) so a picker is cheap to add afterward, but no picker UI or second/third palette ships in 2b.

### 2b.0 — Tailwind migration (mechanical, zero visual change)

**Build:** installed Tailwind v4 + `@tailwindcss/vite`, CSS-first config (no `tailwind.config.js` — every existing design token in `src/index.css` aliased via `@theme inline`, not redeclared, so 2b.1's theme-picker work stays a single-source-of-truth edit). Converted all 17 feature CSS files (~3,400 lines) to Tailwind utility classes on the JSX elements, one cluster at a time, verifying tests green after each: app shell, Home, Practice (largest cluster — puzzle card, code snippet, mcq, status bar, pattern picker, mastery view), Daily/share-card family (wider than expected — reused verbatim across Rush/Boss/Missions), Rush, Trace/Scrubber/Checkpoint, Boss, and the remaining Missions/Challenge/Puzzle/Settings/Legal/PWA cluster.

**DoD:**

- [x] Full test suite green, unmodified except where a file's utility conversion is the only diff — **met**: 97 files / 1757 tests, identical count to the pre-migration baseline, all passing. Every test-asserted classname (grep-verified far beyond the plan's originally-flagged 5 — includes `className.toContain()` substring checks and Testing-Library `selector:` options, not just `querySelector`/`toHaveClass`) kept literal alongside the new utility classes.
- [x] Bundle size delta recorded — **met**: raw JS+CSS assets 1,146,599 → 1,131,618 bytes (−1.3%), gzip 342,478 → 340,886 bytes (−0.5%), CSS chunk count 14 → 4. Measured via a side-by-side worktree build of the pre-migration commit (`d457172`, PR #57's merge) against this phase's final commit.
- [ ] Before/after screenshot pass on every screen — **not met this session**: this session ran headless (background job, no live browser attached) — both `claude-in-chrome` and the Playwright MCP bridge require a connected browser extension neither could reach. Both a current-branch and a pre-migration dev server were stood up (ports 5173/5174) and confirmed reachable before this became clear. **Outstanding**: run a visual pass over every route (`/`, `/practice`, `/daily`, `/rush`, `/boss`, `/trace`, `/missions`, `/settings`, `/legal`, `/browse`, a `/challenge` link, a `/puzzle/:id` link) at mobile and desktop widths before merging, from a session with a live browser attached.

**What this build item deliberately did NOT convert, and why** (a real, considered scope narrowing, not an oversight):

- `DragOrder.tsx`/`SwipeBinary.tsx`'s `.drag-order__*`/`.swipe-fallback__*` CSS (practice.css): both components' own doc comments describe hard-won, real-device-verified touch/gesture behavior (SwipeBinary's OD-1 through OD-5 device-capture history; DragOrder's two-layer touch-action hit-target model), with explicit warnings that some of it (`.swipe-fallback__card`'s `touch-action: none`) has **no test coverage** and must be "kept in sync by hand." Converting those classnames for a phase whose entire premise is zero-behavior-change wasn't worth the regression risk. Left untouched, verbatim. Revisit only alongside a real device pass, not as a mechanical conversion.
- A handful of compound-selector cascades relying on CSS specificity (`.mastery-row.mastery-row--weak`, `button.mastery-row`) and every custom `@keyframes` animation (route-skeleton shimmer, combo-badge-pop, boss-strikes-hit, feedback-panel-slide-in) — no Tailwind utility-class equivalent exists without hand-authoring the keyframes in CSS anyway, so these stayed as small, deliberately-trimmed residual CSS files (7 remain, down from 18: `app.css`, `bossPage.css`, `practice.css`, `practicePage.css`, `routeSkeleton.css`, `tokens.css`, `index.css`).
- Prism's `.token.*` syntax-highlight classnames (`tokens.css`) — generated by Prism itself via `dangerouslySetInnerHTML`, not ours to rename.

**Cross-file coupling found during the build, not anticipated by the sketch below:** `.app-shell__main`/`.app-shell__sidebar` are shared by ~13 unrelated page components (not one); `.daily-hero`/`.share-card*` (dailyPage.css) are reused verbatim by Rush/Boss/Missions' own result and share/challenge cards, none of which import `dailyPage.css` directly — converting that cluster touched 13 files, not the ~5 the file's own line count suggested. Handled by grouping conversions around actual classname usage (grepped app-wide) rather than import statements alone.

### 2b.1 — Design tokens + layout shell (1 session)

**Build:**

1. Formalize `docs/design/codoro-v2-arena.html`'s palette as the canonical theme (direct user decision, 2026-08-12: still the intended direction) — dark surfaces, lime accent `#c6f83c`, danger/warning colors, code-syntax token set, Space Grotesk (UI) + JetBrains Mono (code). Every color as a CSS custom property, zero hardcoded hex outside `src/index.css` — theme-ready for the deferred picker. (2b.0 already wired every token through `@theme inline`, so this is a values-only pass, not a re-plumbing.)
2. Define a shared viewport-fit layout primitive: `dvh`-based page shell, primary action (Continue/Start/etc.) anchored/sticky rather than requiring scroll to reach. Direct fix for two of Thomas's complaints that are actually one root cause — "scrolling to reach Continue" and "empty space on every page" both trace to no screen having an intentional fit-to-viewport layout.
3. Apply the shell to at least one screen end-to-end as proof (candidate: Home, since it's getting redesigned in 2b.5 anyway).

**DoD:**

- [ ] Token file is the single source of truth — grep confirms no hardcoded hex/rgb color values remain in component CSS.
- [ ] Shell primitive in use on ≥1 real screen, no scroll needed to reach the primary action on a standard mobile viewport.

### 2b.2 — Systemic click-meaningfulness + Boss game-feel (1–2 sessions)

**Build:**

1. Fix the answer→Continue gating-tap gap app-wide (Practice/Daily/Rush/Trace/Boss) — `PuzzleCardShell`'s and `TraceRunner`'s Continue button previews the destination before the tap, matching the pattern Missions' own `MissionCheckpoint` already proved out.
2. **Trace arrow mis-click fix**: reserve space for (or detach the nav control from) the growing checkpoint stack so the arrow doesn't shift position under an in-flight tap. Treat as an interaction-correctness fix, not a cosmetic one — same rigor as the OD-1/OD-5 gesture defects.
3. **Boss game-feel pass** — code-verified gaps (`BossActivePlay.tsx`, `bossPage.css`): the existing hit-reaction (`boss-strikes-hit`, 250ms/3px shake) only fires on wrong answers and reads as a flinch, not an impact; there is no feedback at all on correct answers; the progress readout is plain text (`Puzzle {position} of {totalPuzzles}`); there is no boss "presence" (name/avatar/portrait) anywhere. Build:
   - Escalate the wrong-answer hit reaction (bigger motion and/or a color flash, not just translateX).
   - Add a new correct-answer beat — the player should feel like they're landing hits too, not just taking them.
   - Replace the plain puzzle counter with a themed progress element (segmented/pip-style, or "hits landed" framing).
   - **Open design question, settle in the build prompt**: does Boss get an actual character (name + simple icon/portrait that visibly reacts — no commissioned art required) or stay abstract with a punchier feedback loop only? Default to abstract-but-punchier unless Thomas says otherwise when this session opens.

**DoD:**

- [ ] Every mode's Continue action previews what's next before the tap.
- [ ] Trace's checkpoint arrow never moves under an already-in-flight tap.
- [ ] Boss shows a distinct, escalated reaction on wrong answers and a new, visible reaction on correct answers.
- [ ] Existing test suite green; Boss's `role="status"`/`aria-label` strikes announcement preserved (still true post-2b.0 — verified in that phase's own test run).

### 2b.3 — Missions staging + clarity pass (1 session)

**Build:**

1. Persistent stage tracker (🧠 Trace → ⚡ Speed → 🏆 Boss → payoff) visible throughout a mission run, not just at checkpoints — `MissionCheckpoint` today only lists _completed_ stages, and only when resuming mid-arc. Desktop: rail placement to the right (direct user request). **Open design question, settle in the build prompt**: mobile treatment — top stepper bar, bottom pip row, or a collapsible dots indicator. Default to a top stepper bar (cheapest, most conventional) unless Thomas specifies otherwise.
2. Expand `MissionCheckpoint`'s copy — today it's icon + label + duration only. Add explicit framing of what's about to happen at each stage, not just its name.

**DoD:**

- [ ] Current stage position is visible at all times during a run, not only at transition screens.
- [ ] A first-time player can state what's about to happen next without guessing, per a quick Thomas walkthrough.

### 2b.4 — Sharing consolidation (1 session)

**Build:** one `ShareMenu` component (Web Share API on mobile → native share sheet; clipboard-copy fallback on desktop) replacing today's oversized challenge-link UI and the share-text block repeated under every mode. Exposes two actions: share puzzle, share challenge. Note from 2b.0: the share-card markup this replaces is duplicated across `daily/ChallengeCard.tsx`/`ShareCard.tsx`, `practice/PracticeChallengeCard.tsx`/`PracticeShareCard.tsx`, and `rush/RushShareCard.tsx`/`RushChallengeCard.tsx` — six near-identical files, confirmed during that phase's own conversion pass.

**DoD:**

- [ ] Verified on ≥1 real mobile browser (real share sheet opens) and desktop (clipboard fallback works).
- [ ] Old inline share-text markup removed everywhere it was duplicated.

### 2b.5 — Home redesign (1 session)

**Build:** apply 2b.1's shell + tokens to Home. Address "empty space" via information density (recent activity, a mission entry point, stats teaser) rather than purely decorative filler — ties into 2b.7 if the stats page lands first.

### 2b.6 — Drag handle affordance (small; fold into 2b.2 or run standalone)

**Build:** hit target stays at 44px (already at Apple HIG minimum — confirmed functionally sound via the OD-5 investigation, closed "works as designed"). Fix the _visual_ affordance instead: the rendered grip icon should visually read as large as the actual tappable zone, so the size complaint is a perception fix, not a hitbox inflation.

### 2b.7 — Mastery/stats page (not sized — scope decision needed first)

Fully buildable off existing local IndexedDB history, not blocked on the Phase 4 backend. **Blocking question before this gets a session**: permanent nav slot (core-loop surface) or a secondary view nested under Settings? Starter directions once scope is picked: per-pattern accuracy heatmap, rating/streak history graph, a "weakest pattern" callout.

### 2b.8 — QA pass (1 session)

Batched screenshot review across all touched screens + a Lighthouse re-check (Phase 3 already gates on Lighthouse 90+, and a redesign is exactly the kind of change that regresses it). Absorbs 2b.0's own outstanding visual-pass DoD item if that hasn't been closed by then.

**Open design questions to settle in build prompts, not here** (carried from the original sketch):

- Boss: character (name + reactive portrait) vs. abstract-but-punchier feedback only (2b.2).
- Mission staging rail's mobile treatment: top stepper vs. bottom pips vs. collapsible dots (2b.3).
- Mastery/stats page: nav-level surface vs. Settings-nested (2b.7) — blocks sizing that phase at all.

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
