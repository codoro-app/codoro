# Codoro v2 — build plan

v2 turns Codoro from a quiz app into a puzzle app. The flagship is the **execution scrubber** — stepping through code state and predicting what happens next — which the v1 retro identified as the actual fix for the quiz-vs-puzzle problem. The existing quiz modes stay and get upgraded, not replaced.

This plan absorbs `docs/v2-backlog.md`. Every backlog item is either assigned to a phase here or explicitly deferred to v3 — see the traceability table at the bottom. Nothing gets to hide.

## Locked decisions

| Decision           | Choice                                                                                                                                          | Why                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flagship           | Execution scrubber as a new `interaction` type; swipe/mcq/tap-line retained and upgraded                                                        | Retro's central finding: one-shot recognition isn't a puzzle. Scrubber requires holding state and reasoning forward.                                                             |
| Backend            | **None in v2.** Local-first stays. Leaderboard, accounts, and the entire security block (Clerk, 2FA, rate limits, token storage) deferred to v3 | No marketing planned for v2 → a leaderboard is an empty room. Accounts are pure infrastructure cost with zero users. See "Backend-ready seams" below for what v2 preserves.      |
| Shareability       | Client-side: real URL router + `/puzzle/:id` deep links. Puzzles ship in the bundle, so no server needed                                        | Gets the shareability backlog item and a real `/legal` URL without a backend.                                                                                                    |
| Trace ground truth | Scrubber traces are **derived by executing the code**, never asserted by an LLM                                                                 | v1's content weakness was unverifiable LLM assertions (ratings, explanations). Traces are mechanically checkable — build the pipeline so a wrong trace cannot pass validation.   |
| Scrubber languages | JS + Python first (tooling can execute both cheaply). Java/C stay quiz-only until/unless trace tooling justifies itself                         | Don't build a JVM instrumentation harness before the interaction is proven fun.                                                                                                  |
| Sizing             | Phases sized in **Claude sessions** (one session = one focused build block ending in a green `pnpm validate` and a merged PR)                   | Budget is Claude usage, not calendar hours. Every session ends mergeable — no long-lived branches.                                                                               |
| Validation posture | Build only, no marketing phases. But the scrubber gets a go/no-go checkpoint (end of Phase 2) before content/UI investment scales               | Retro lesson: v1 front-loaded infrastructure over validation. The checkpoint is self-validation — is authoring cost per scrubber puzzle sane, and is the prototype actually fun? |

## Phase map

| Phase | What                                                                                          | Est. sessions    |
| ----- | --------------------------------------------------------------------------------------------- | ---------------- |
| 0     | Carryover bug fixes + live-deploy verification                                                | 1–2              |
| 1a    | URL routing                                                                                   | 1                |
| 1b    | Shareable puzzle links (gated on Phase 2 go/no-go **and** Phase 3 completion — see amendment) | 1                |
| 2     | Scrubber spike: trace format, engine, tooling                                                 | 2–3              |
| 3     | Scrubber UI                                                                                   | 2–3              |
| 4     | Scrubber content pipeline + volume                                                            | 2–3              |
| 5     | Quiz upgrades: drag-and-drop, Daily, Rush                                                     | 2                |
| 6     | Content calibration + quiz volume                                                             | 1–2 + batch runs |
| 7     | Export/import UI + performance to Lighthouse 90+                                              | 1–2              |
| 8     | Hardening + regression                                                                        | 1                |

Phases 0 and 1a are prerequisites. Phases 2→3→4 are the flagship arc and must run in order. **Phase 1b is gated on the Phase 2 go/no-go _and_ Phase 3 shipping a scrubber renderer** (amended post-Phase-2-corrective — see the Phase 1 amendment and the Phase 1b section's own note for why: `/puzzle/:id` renders a puzzle in its native interaction, and there is no scrubber renderer until Phase 3). Phases 5–7 are independent of Phase 1b and each other and can interleave anywhere after the Phase 2 checkpoint if a scrubber session stalls.

## Known open defects

Defects that are confirmed real but deliberately not being fixed right now. This table lives here — above the phases — rather than inside a phase amendment, because a defect buried in an amendment chain is a defect nobody reads again. **Nothing is removed from this table without a commit that fixes it.** Anything unfixed by the end of Phase 8 either blocks the phase or gets an explicit written waiver.

| #    | Defect                                                                                                                                                                                                | Confirmed on                                                                                                                                    | Owner phase | Status                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-1 | Swipe gesture still unreliable on phone _after_ both Phase 0 gesture fixes (32ms kinematics + axis lock)                                                                                              | Real device, Cloudflare preview build of `v2-phase-0-hotfix` (i.e. both fixes present)                                                          | Phase 8     | Open — **undiagnosed, no repro captured yet.** Do not fix speculatively; see notes below                                                                                                                                                     |
| OD-2 | JS traceGen (`jsTraceGen.ts`) runs the snippet in-process via `node:vm`, which is not a security boundary — a crafted snippet can escape it (e.g. `this.constructor.constructor('return process')()`) | Phase 2 corrective review (`docs/v2-phase2-review.md`, P6); escape payload confirmed against this exact sandbox shape, not asserted generically | Phase 4     | Open — **deliberate, not urgent.** Fine while snippets are hand-authored (Phase 2/3); decide child-process isolation before Phase 4 runs LLM-generated snippets, where the threat model changes from "my own code" to "code I did not write" |

### OD-1 — swipe still unreliable on phone (third defect)

Phase 0 found and fixed two independent `@use-gesture` bugs (see the Phase 0 amendments: the 32ms `BEFORE_LAST_KINEMATICS_DELAY` staleness in `velocity`/`direction`, and `DragEngine`'s zero `axisThreshold.touch` silently locking the gesture to the wrong axis). A real-device pass on a preview deploy of the branch carrying **both** fixes still shows swipe problems, so this is a third, separate defect — not a regression of either fix, and not the stale-build case.

**Deliberately not diagnosed yet.** Phase 0 already spent two rounds on this, and the standing rule on this repo is no fix without a root cause read out of source. A third round of guesswork is worse value than deferring it behind Phase 1's routing work, which has to touch real-device PWA verification anyway. Two prior wrong diagnoses on this exact bug (the v1 retro's "`SwipeBinary.tsx` always resolves right", then the first `vx * dirX` hypothesis, which was right in effect but wrong in mechanism) are the reason.

**What must be captured before anyone writes code for this** — without it the next round is guesswork too:

- Device, OS version, browser, and whether it was the installed PWA or a browser tab
- Which failure it is, precisely: swipe does nothing (no commit), commits the wrong direction, commits when it shouldn't (accidental), fights vertical scroll, or card animates and then snaps back
- Whether it reproduces on a fresh page load vs. only after several puzzles
- Whether the tap fallback buttons still work when the gesture fails

**Candidate hypotheses, none verified — listed so the next session doesn't re-derive them, not as a shortlist to try:**

1. **PWA/service-worker cache.** Ruled unlikely (a preview deploy, not the installed app) but the installed PWA has its own cache lifetime; confirm the build hash on device before anything else.
2. **`touchAction: 'pan-y'` vs. iOS Safari.** The card allows vertical panning; iOS can hand a near-diagonal gesture to the scroller and cancel the pointer stream mid-gesture (`pointercancel`), which `@use-gesture` surfaces as a gesture that just ends. Related to but distinct from the axis-lock bug already fixed.
3. **The 20px `axisThreshold.touch` is now too generous** in the other direction — a short, fast, deliberate flick may not accumulate 20px before lift on a small screen, so the axis never locks and the drag never engages. This would be a tuning error introduced by the Phase 0 fix itself and is the first thing to test if the symptom is "short flicks do nothing, long drags work".
4. **`DEFAULT_SWIPE_THRESHOLD` (120px / 0.3 px/ms) is simply too high for a phone-width card.** Still last resort, same reasoning as Phase 0: don't retune to paper over a mechanism bug.
5. **framer-motion `x` spring fighting the drag transform** on lower-end Android — the card's own animation and the gesture writing to the same motion value.

**Not in scope for OD-1:** any redesign of the swipe interaction, and any change that lowers a threshold without a written mechanism for why the current value is wrong.

### OD-2 — `node:vm` is not a security boundary for JS trace generation

`jsTraceGen.ts`'s doc comment used to overstate this ("no require, process, fs, or timers are reachable from the sandboxed snippet"), which is true of the naive path but not a security claim `node:vm` actually backs — Node's own docs say so, and the Phase 2 corrective review confirmed the standard escape payload (`this.constructor.constructor('return process')()`) resolves the real host `process` object against this exact sandbox shape, not just in the abstract.

This is fine right now: Phase 2/3 snippets are hand-authored, so the threat model is "my own code," not "code I did not write." It stops being fine the moment Phase 4's batch pipeline runs LLM-generated snippets through this same generator unreviewed. **Not fixed here, deliberately** — the corrective PR that found this scoped the fix to enforcing determinism (Math.random/Date) and softening the doc comment to match reality, not to moving the JS backend to a child process (the Python backend already runs in a subprocess; JS does not). Phase 4 must decide, in writing, whether to isolate JS generation before its first batch run — this row stays open until that decision (and, if isolation is chosen, the commit implementing it) lands.

---

## Phase 0 — Carryover fixes + live verification (1–2 sessions)

Known bugs and unverified production state inherited from v1. All small, all worth clearing before new feature code lands on top of them.

**Build:**

1. **Fix the swipe-binary answer skew** — a rating-integrity bug, but **not** the one v1's retro and backlog recorded. Those describe a component defect ("`SwipeBinary.tsx` always resolves 'right'"); that diagnosis is wrong and was corrected on inspection — `SwipeBinary.tsx` and `gestureThreshold.ts` resolve direction correctly. The real defect is in the content: **all 39 swipe-binary puzzles carry `correct_direction: "right"`, zero carry `"left"`**, and every label pair is phrased safe-on-left / buggy-on-right. Root cause is the single worked example in `generatePuzzles.ts`'s system prompt (`correct_direction: 'right'`), which every generation run anchored to; `devPuzzles.ts` repeats it. Effect: 39 of 108 puzzles (36% of the library) are a free Elo climb for anyone swiping right without reading, so rated attempts on them carry no signal.
   - Rebalance the existing 39 to a 45–55% split by swapping `left_label`/`right_label` and flipping `correct_direction` (semantics-preserving), deterministically seeded by puzzle id so the result is reproducible.
   - Add a **hard `validate:content` failure** when the direction split skews past 65/35 — a warning is not enough, the point is that a future batch cannot quietly re-anchor.
   - Fix the generator's worked examples and instruction text, and `devPuzzles.ts`'s sample.
   - **Deferred to Phase 6, deliberately:** rebalancing sides does not fix the deeper tell — the label that _names a bug_ is still always correct, because every snippet in the library contains a bug. Puzzles whose code is genuinely fine are content-authoring work, not a Phase 0 fix.
2. **Fix the swipe gesture on phones** — separate bug, confirmed on real hardware. Audit the touch path end-to-end (`gestureThreshold.ts`, `@use-gesture` config, `touch-action`, scroll interference) on real iOS and Android, not devtools emulation. First suspect: the commit path derives signed velocity as `vx * dirX`, and `@use-gesture` reports `direction` from the _last_ movement delta — on a real finger lift (which typically pauses or micro-reverses) `dirX` goes to `0` or flips sign, failing the velocity or same-direction check so the swipe silently does nothing. Rule that out before retuning `DEFAULT_SWIPE_THRESHOLD`; lowering thresholds to paper over a sign error trades one bug for accidental commits.
3. **Fix Browse selection on desktop** — selection doesn't reflect in the puzzle view on the right; the rendered puzzle should also be directly interactive. Symptom is layout-specific (≥1024px): `PracticePage`'s `view === 'patterns'` branch returns early and renders only `.app-shell__main`, unmounting both the sidebar and the puzzle card, so Browse is a full-page takeover with no puzzle pane to reflect into. Fix within the existing `view` state machine — Phase 1 owns routing and gives Browse a real `/browse` route; don't pull that forward. Mobile keeps the full-screen picker.
4. **Verify telemetry is actually live** — `VITE_POSTHOG_KEY` was being set on Cloudflare Pages outside the repo during v1 wrap-up. Confirm real events (`session_start`, `attempt`) arrive in PostHog from production. If not, fix the env var and redeploy until they do.
5. **Verify the two unconfirmed v1 checks**: `public/404.html` actually serves a 404 on production for a bad path, and the service-worker update flow works against a real deploy (v1 wrap-up couldn't confirm a redeploy landing).

**DoD:**

- [x] Swipe-binary `correct_direction` split lands in 45–55%, reproducible from a committed script, with a content-level test that would have caught the original 39/39 skew — **verified: 20 left / 19 right = 51.3% left**, `rebalanceSwipeDirection.ts` committed, `src/content/index.test.ts` asserts the distribution
- [x] `validate:content` hard-fails a deliberately skewed fixture (>65/35) and passes the rebalanced library; generator and `devPuzzles.ts` no longer anchor to one direction — **verified**: `SWIPE_DIRECTION_SKEW_THRESHOLD` in `validatePuzzles.ts`, four fixture tests including the exact-boundary case; `generatePuzzles.ts` now ships both-direction worked examples
- [ ] ~~Swipe gesture verified smooth and reliable on real iOS and Android phones~~ — **not met. Two root causes found, fixed, and tested (see amendments); a third defect survives both.** Tracked as **OD-1** in "Known open defects" above, owned by Phase 8. Phase 0 does not block on it
- [x] Browse on desktop: selecting a pattern renders an interactive puzzle in-layout; mobile flow unchanged, both widths tested — **verified**: `PracticePage.tsx`'s early return is now `view === 'patterns' && !isDesktop`, covered in `PracticePage.test.tsx`
- [ ] A production event is visible in PostHog, triggered from a real phone — **Thomas's, outstanding**
- [ ] Bad path on getcodoro.com returns HTTP 404; SW update prompt observed after a real deploy — **Thomas's, outstanding.** Note this check is about to change meaning: Phase 1a adds `_redirects` and a SW `navigateFallbackDenylist`, and until those land the answer differs between a browser tab and the installed PWA. Verify it now against the current build anyway — it's the baseline 1a is measured against
- [ ] Local rating reset available (export → edit → import) — the Phase 0 prompt asked for this as a PR note, since the stored rating is inflated by blind-right swipes taken before the rebalance. **Unconfirmed as delivered.** `exportData`/`importData` exist in `src/storage/exportImport.ts` and have no UI until Phase 7, so the procedure needs to be written down somewhere durable, not left in a PR description

**Status: code complete, verification outstanding.** Every code item is merged or on `v2-phase-0-hotfix` and passing. The three unchecked boxes are all live-environment checks that cannot be done from the repo, plus OD-1. **Blocking on the last two before Phase 1 is correct** — Phase 1 changes URLs, which changes exactly what a 404 check and a service-worker update check mean, so verifying them against the current routing is the last moment they're cheap.

**Amendment (code portions, post-implementation):** the swipe-direction skew,
validator, generator, and desktop-Browse items above matched the plan as
written — rebalanced 20/39 to "left" (48.7%/51.3% split), no schema change
surfaced, and the Browse fix stayed inside the existing `view` state machine
as expected. The gesture root cause is a refinement of this section's
hypothesis, not a contradiction, worth recording precisely: reading
`@use-gesture/core` v10.3.1's own source (not just its types) showed the bug
isn't really "`direction` reported from the last movement delta" in general —
it's that the library only recomputes `direction`/`velocity` on a gesture's
last frame when the gap since the previous frame exceeds an internal 32ms
threshold (`BEFORE_LAST_KINEMATICS_DELAY`), and recomputes from the delta
_since that gap started_, not the whole gesture. A finger that pauses before
lifting (common, and >32ms) makes that delta ~0, collapsing both fields
regardless of the drag's real distance/speed. Fix: `SwipeBinary.tsx` now
derives velocity from `movement`/`elapsedTime` (whole-gesture totals,
immune to any single frame's timing) via a new `signedVelocityFromGesture` in
`gestureThreshold.ts`, instead of `vx * dirX`. `DEFAULT_SWIPE_THRESHOLD` was
not retuned. Device verification (real iOS/Android feel) is still Thomas's,
per this section's original split of responsibilities.

**Amendment 2 (post-merge, real-device report):** after merging, real-phone
testing surfaced two further defects the above work didn't reach, both
confirmed by reading source/simulating before touching code (no fix without
root cause):

- **Gesture still dropped on phone.** A second, independent `@use-gesture`
  bug beyond the 32ms kinematics staleness fixed above: `DragEngine.ts`'s
  axis-intent lock (`axis: 'x'` in `SwipeBinary.tsx`'s `useDrag` config)
  defaults `axisThreshold` to `{ mouse: 0, touch: 0, pen: 8 }`. Zero tolerance
  for touch means the very first touchmove sample permanently locks the
  gesture's axis; real touchscreen jitter easily makes that first sample's
  vertical delta exceed its horizontal one, locking axis to `'y'` and then
  silently blocking every subsequent frame — including the final pointerup
  one — before it ever reaches the bound callback (`Engine.ts`'s `_blocked`
  emit-skip). The swipe just vanishes, with no error. This can't reproduce
  through a mouse or through the component test's mocked `useDrag` (both
  produce clean axis-dominant deltas), which is why it survived the previous
  fix and the full test suite. Fix: `axisThreshold: { touch: 20 }` added to
  the `useDrag` config, giving touch a few pixels of grace before locking the
  axis, matching the tolerance `@use-gesture` already gives `pen` by default.
- **Wrong-answer requeue starved fresh puzzles ("cycles through the same
  4").** Confirmed by simulating `src/engine/selection.ts` + `requeue.ts`
  directly: `selectNext`'s due-entry loop unconditionally preempts a fresh
  window pick whenever anything is due, with no bound on consecutive requeue
  serves. Missing a requeued puzzle again resets its ladder to a 3-tick
  countdown (`recordMiss`); once 3+ puzzles are cycling on that reset, at
  least one is due on literally every tick, so window picks never run again —
  the session gets permanently stuck replaying only the missed set. This also
  produced the reported "all swipes are left": a new user's rating-window
  puzzle set is small (5 swipe-binary puzzles within ±200 of the 1200
  starting rating, 4 of them "left" by chance), and getting caught in the
  starvation loop on that small, skewed set reads as "always left" even
  though the full library is a genuine 48.7%/51.3% split. Fix: `selectNext`
  gained a `lastSource` input — the caller's previous serve source — and now
  skips due-entry injection entirely when the previous serve was itself a
  requeue entry, bounding the requeue share of servings to at most every
  other serve. `usePracticeSession.ts` tracks this in a plain ref
  (`lastSourceRef`), the same pattern already used for `recentIds`.

The fourth report — "the label naming a bug is always the correct
answer" — is not a new defect: it's this section's already-documented
"deeper tell" above, already scoped to Phase 6 (content-authoring: snippets
that are genuinely correct code, not a code-level fix). Left as-is pending a
scope decision on whether to pull it forward.

**Amendment 3 (second real-device pass):** a device test against a Cloudflare
preview of `v2-phase-0-hotfix` — a build carrying **both** gesture fixes
above — still shows swipe problems. That makes it a third, independent
defect rather than a regression or a stale build. It is **not** diagnosed
here and **not** fixed here: logged as **OD-1** in the "Known open defects"
table at the top of this document, owned by Phase 8, with the repro
information that must be captured first and the unverified candidate
hypotheses recorded so the next session starts from evidence rather than
re-deriving them. Deferring rather than attempting a third same-session fix
is deliberate — two prior diagnoses of this bug were wrong, and the standing
rule is no fix without a root cause read out of source.

---

## Phase 1 — URL routing + shareable puzzle links (split into 1a + 1b, see amendment)

v1 has no router at all — `AppMode` is in-memory state, `/legal` isn't a real URL. v2 needs routing for shareability, per-route OG tags, and route-level code splitting (which Phase 7's performance work depends on).

**Amendment (pre-implementation, split into 1a/1b):** this phase originally bundled two things with different risk profiles — routing infrastructure, and a shareability feature. They are now separate.

The locked "validation posture" decision names v1's mistake as front-loading infrastructure over validation. Shipping share affordances, puzzle-link URLs, and OG work for an app with **no users and no marketing planned in v2**, _before_ the Phase 2 scrubber go/no-go, repeats it: if the checkpoint comes back "not fun," that work was spent making a product shareable that's about to be rethought. The routing half is different — it's a genuine prerequisite (Phase 7's code splitting depends on it, and retrofitting a router after Phases 3–4 add scrubber surfaces costs more than doing it now).

So: **Phase 1a runs next. Phase 1b is gated on the Phase 2 go/no-go** and can then interleave anywhere, same as Phases 5–7 — **amended post-Phase-2-corrective: Phase 1b is additionally gated on Phase 3 completion.** See the Phase 1b section's own note for why.

### Phase 1a — Routing (1 session)

**Build:**

1. Add a router. **wouter** (~2 KB) over react-router (~20 KB) — Phase 7 has to claw back ~58 KB of unused JS to hit Lighthouse 90+, so don't spend 20 KB on routing when the route table is six entries. Tradeoff: less ecosystem; fine at this scale.
2. Routes: `/` (boot decision), `/practice`, `/daily`, `/rush`, `/browse`, `/legal`. `AppMode` state is replaced by the route; NavRail/ModeSwitcher/footer/Home CTAs become real links (`<a href>`, so cmd-click and middle-click work — that is most of the point of having URLs).
3. `/` preserves `resolveBootMode`'s rule: a first-ever visitor still lands in Practice, a returning one in Home. Route-level code splitting stays, **and so does the eager prefetch of the landing route's chunk** — losing it silently regresses first paint and undercuts Phase 7.
4. `/browse` becomes a real route, extracted from `PracticePage`'s `view` state machine (where Phase 0 deliberately left it). Desktop master-detail behavior from Phase 0 is preserved; mobile keeps the full-screen picker. `view === 'mastery'` stays internal state — not this phase's problem.
5. **Cloudflare Pages deep-link serving.** There is no `public/_redirects` today, so a cold load of `getcodoro.com/legal` hits `404.html` rather than the app. The reflex fix (`/* /index.html 200`) is wrong: it makes every URL on the domain return 200 and kills the "bad path returns 404" requirement carried over from Phase 0. Enumerate real routes instead, and leave unknown paths falling through to `404.html`.
6. **Service-worker navigate fallback.** `vite.config.ts` sets `workbox.navigateFallback: '/index.html'` with no denylist, so once the SW is installed _every_ navigation — including bad paths — is served the app shell from cache. 404 behavior therefore differs between a browser tab and the installed PWA, which makes the production 404 check pass or fail depending on which was tested. Add a denylist; do not touch `registerType: 'prompt'` or the update flow.
7. Per-route `<title>` and meta description (browser- and screen-reader-facing; see 1b for why this does **not** fix unfurls). Update `404.html`'s links to real routes. Route-change focus and scroll management — a router regresses both by default.

**DoD:**

- [x] All six routes render; nav is real links; back/forward behaves — **verified**: wouter `Switch`/`Route`, `NavRail`/`ModeSwitcher`/`AppShell`/`Home`/`PracticePage`'s Browse entry all converted to real `<Link>`s
- [x] `/` still boots a first-ever visitor into Practice, a returning one into Home — with a test — **verified**: `App.test.tsx`, plus a regression test for the specific bug this extraction almost shipped (see amendment below)
- [x] Route-level code splitting intact **and** landing-route chunk still prefetched eagerly, with a test that would catch losing it — **verified, but not fully true — see the `v2-phase-1a-followup` amendment below**: the prefetch survived; the splitting property did not, on the first-visit path (a first-ever visitor's cold boot still downloaded the Home chunk, briefly, before the redirect committed)
- [x] `/browse` is a real route; desktop master-detail preserved, mobile picker unchanged, both widths tested — **verified**: Phase 0's existing `PracticePage.test.tsx` coverage, unchanged in intent, still green
- [x] Route changes move focus to the new page heading and reset scroll — **verified, with a scope note**: see amendment below (focus target is `<main>`, not a per-page `<h1>`)
- [x] `_redirects` enumerates real routes; `/nonsense` still returns a real 404; SW `navigateFallbackDenylist` decision written down — **verified, but not fully true — see the `v2-phase-1a-followup` amendment below**: true for bare paths, false with a query string
- [ ] Direct load of `getcodoro.com/legal` on production renders the app (no SPA-boot-to-home) — **Thomas's, outstanding** (production check, not reproducible from the repo)
- [ ] PWA launch and SW update flow unaffected — re-verify installed-app launch on a real phone — **Thomas's, outstanding**
- [x] `pnpm validate` green; exactly one new dependency (wouter) — **verified**

**Amendment (post-implementation):**

1. **Focus target is `<main>`, not a literal per-page heading.** Only `LegalPage` and `ErrorBoundary` have a real `<h1>` today; `Home`, `PracticePage`, `DailyPage`, and `RushPage` don't. Retrofitting a heading onto every branch of every page (each has multiple loading/error/empty states) is a broader content/markup pass than routing plumbing, and doing it shallowly — adding an `<h1>` only to the happy-path branch and forgetting the others — would be worse than one solid mechanism. Implemented instead: `AppShell`'s `<main>` gets `tabIndex={-1}` and an `aria-label` naming the active route (`routes.ts`'s `labelForPath`), and focus moves there on every route change. This satisfies the underlying accessibility goal (a screen-reader user is told a new page loaded and what it is) without a page-content pass this phase didn't otherwise need. Flagged here rather than left silent, per this repo's standing rule on plan/implementation divergence.
2. **Bundle-size delta:** built both `origin/main` and this branch from clean installs and compared `dist/`. Total `dist/` size: **+7,912 bytes** (main 1,268,704 → phase-1a 1,276,616). The entry chunk that carries wouter + the new routing/focus/meta code specifically: **+6,890 bytes raw / +2,710 bytes gzipped** (195.54 kB → 202.43 kB raw; 61.31 kB → 64.02 kB gzip). This is the baseline Phase 7 should measure its ~58 KB reclaim against.
3. **`/nonsense` after this phase's changes, by context:** browser tab (SW absent or request passed through) → real HTTP 404 from Cloudflare's `404.html` (no `_redirects` rule matches). Installed PWA, online → now identical to the browser-tab case: the SW's `navigateFallbackDenylist` stops it intercepting the request, so it reaches the network and gets the same 404 — this unification is the point of the denylist fix. Installed PWA, offline → a browser-native offline error, not `404.html`, since there's no network to ask and the path is denied the cached-shell fallback; this is an inherent consequence of an offline app having no way to ask a server what does or doesn't exist, not a bug. A _known_ route (e.g. `/practice`) offline still correctly serves the cached shell.

**Amendment 4 (`v2-phase-1a-followup` branch, post-merge read):** four routing defects found reading the merged Phase 1a code, none caught by the original review. Three passed every existing test at merge time — that's how they survived — each one below names the test that should have caught it and didn't; a new/extended test now does.

1. **A first-ever visitor still downloaded the Home chunk.** The boot redirect ran in `useLayoutEffect` (commit phase), but wouter's `<Switch>` matches `/` and mounts `<Home />` during the render phase, which is when `React.lazy`'s ctor fires the chunk request — before the redirect to `/practice` ever commits. `App.test.tsx`'s first-visit test only asserted which page ended up in the DOM, and Home is unmounted by the time that assertion runs, so it passed regardless. Fixed with `bootRedirectPending`, set from the same initializer that decides `bootMode` and cleared inside the same layout effect that navigates, gating the `/` route's child so Home never mounts during the one pending render. (Gating on `bootMode === 'practice'` alone was the obvious-looking wrong fix: `bootMode` never resets after the initial mount, so that would have permanently blanked `/` for that visitor's later logo-click visits too.) New test (`App.bootHomeChunk.test.tsx`) mocks `./Home` with an import counter and asserts it stays zero across a first-ever visit's boot — confirmed failing against `main` before the fix (counter was 1).
2. **SW `navigateFallbackDenylist` denied real routes with any query string.** Confirmed from `workbox-routing`'s source (`NavigationRoute.js:85`, `node_modules/.pnpm/workbox-routing@7.4.1/...`) that `NavigationRoute._match` tests the denylist against `url.pathname + url.search`, not `pathname` alone. Every alternative in the original regex was anchored with `$`, so a shared/campaign link like `/practice?utm_source=twitter` matched no alternative and got denied the offline shell, even though bare `/practice` worked — masked online because Cloudflare's `_redirects` matches on path alone. Replaced the six `$`-anchored alternatives with `(?:practice|daily|rush|browse|legal)?(?:\?|$)`, admitting an optional query string on any real route (and on `/` itself). `routes.test.ts`'s hand-maintained mirror updated with query-string cases for all six routes plus `/nonsense?x=1`.
3. **Leaving Browse pushed instead of replaced.** `PatternPicker`'s `onSelect`/`onBack` handlers (both `PracticePage`'s mobile branch and its desktop sidebar branch — 4 call sites) called plain `navigate('/practice')` on exit. Combined with Browse's own entry push, the history stack read `/practice → /browse → /practice`, so a real Back press from there returned to Browse instead of wherever the user was before opening it. All 4 exit calls now pass `{ replace: true }`; entering Browse is still a push. `App.test.tsx`'s Browse round-trip test gained a real Back-button assertion — first draft used `waitFor()` on a negative assertion (`pathname !== '/browse'`), which passed trivially before jsdom's async `history.back()` had actually resolved (verified by running it against the unfixed handlers and watching it pass anyway); fixed by awaiting the real `popstate` event before asserting.
4. **`public/_redirects` had no drift guard.** The SW denylist at least had a hand-synced mirror test; `_redirects` — the file deciding whether a route exists at all on production — had none. `routes.test.ts` gained a test that reads the real file off disk and asserts a `200` rewrite for every `ROUTE_META` key except `/` (explicit assertion that `/` has no rewrite rule, not an implied gap — Vite emits `index.html` at the root directly) and that the file has no `/*` catch-all. Verified both assertions actually catch drift before landing (temporarily dropped `/daily`'s line, temporarily appended a `/*` catch-all — each failed the corresponding test).

None of these four change Amendment 3's per-context `/nonsense` table above: `/nonsense` and `/nonsense?x=1` were already denied under both the old and new denylist regex (checked directly) — Item 2's fix only affects query strings on the six _real_ routes, not the unknown-path case.

**Bundle-size delta from `16036c3`:** built both commits from a shared `node_modules` (no dependency changes between them) and compared `dist/`. Total: **+230 bytes** (1,276,498 → 1,276,728) — effectively the "~0" this kind of change should cost. Per-chunk: `PracticePage-*.js` +52 bytes (four `{ replace: true }` additions), the App-entry chunk (`index-*.js`) +54 bytes (`bootRedirectPending`), `sw.js` +6 bytes (the longer denylist regex), `Home-*.js` and `LegalPage-*.js` unchanged.

### Phase 1b — Shareable puzzle links (1 session, gated on the Phase 2 go/no-go **and** Phase 3 completion)

**Do not start this before the Phase 2 checkpoint returns "go."** **Amended post-Phase-2-corrective: also do not start this before Phase 3 ships.** `/puzzle/:id` renders a puzzle in its native interaction type (build item 1, below) — for a scrubber puzzle, that native interaction doesn't exist until Phase 3 builds it. Sequencing Phase 1b before Phase 3 would recreate this corrective PR's own P0 bug (a puzzle interaction type reachable with nothing to render it) at the shareable-link surface instead of Practice.

**Build:**

1. `/puzzle/:id` renders any bundled puzzle in its native interaction type, **unrated**, with a "practice more like this" CTA into `/practice` filtered to that puzzle's pattern. Bad id → real in-app not-found state. Consumes **`puzzlePool`** (the full union, every interaction type) — this is the reason `puzzlePool` survives as an export alongside `quizPool`/`scrubberPool` rather than being replaced by them; `/puzzle/:id` is the one app-facing surface where the full union is genuinely correct.
2. **Decide how "unrated" is enforced.** `shouldRateAttempt` switches exhaustively over `AttemptMode = 'practice' | 'daily' | 'rush'`, and that union is persisted (`src/storage/schema.ts`, `mode: z.enum([...])`, records stamped `schema_version: 3`). Three options, not equivalent: reuse `'rush'` (**no** — corrupts the attempt log and the event stream Phase 6 calibrates against); add a fourth mode (the exhaustive switch forces handling, but widens a persisted enum and drags in a schema-version decision); or **don't record link attempts at all** (recommended — leaves storage untouched and makes "never rated" structurally true rather than dependent on a correctly-written switch case).
3. **Instrument the share loop.** If this ships uninstrumented, at the end of v2 nobody can answer "did anyone open a shared link," which makes the feature unevaluable — the exact v1 mistake. Additive to the locked telemetry schema, snake_case, nothing renamed: `puzzle_link_view` (`{ puzzle_id, interaction, found }` — `found: false` is the signal that someone shared a broken link), `puzzle_link_attempt`, `share_click` (`{ surface, puzzle_id }`). Update `src/telemetry/README.md` in the same commit. If option 3 above was taken, these events are the _only_ record of link activity — that's the point.
4. Share affordance on post-solve screens. Daily and Rush already have parallel `ShareCard`/`shareText` implementations — extend Daily's text to carry the puzzle URL and add share to Practice's solve state, following the existing duplication convention rather than unifying all three as a drive-by.
5. **Per-route OG: decide, don't default.** Client-side `<meta>` updates do not affect unfurls — Twitter, Slack, iMessage and Discord read served HTML and never run the JS. So every shared `/puzzle/:id` link unfurls with the generic site card no matter how correct the runtime meta handling from 1a is. Options: **(a)** accept it for v2 (zero cost, defensible while v2 is build-only); **(b1)** prerender static HTML per route at build time with per-puzzle title/description over the shared image (~114 files from a Vite `closeBundle` hook; also makes the `_redirects` problem mostly disappear, and is a Lighthouse win Phase 7 wants anyway); **(b2)** per-puzzle OG _images_ — note that `generateOgImage.ts` is deliberately text-free because fonts aren't guaranteed in the script environment, so this means bundling a font and rasterizing 108 cards, which is real work, not a variant of b1; **(c)** a Cloudflare Pages Function injecting meta at the edge — rejected, "no backend in v2" is locked. Recommendation: **(a) now, (b1) priced and handed to Phase 7, (b2) not before v3.**

**DoD:**

- [ ] Direct load of `getcodoro.com/puzzle/<real-id>` on production renders the right puzzle
- [ ] Bad puzzle id → real not-found state, not a crash
- [ ] `/puzzle/:id` attempts are never rated — asserted at the storage/profile layer, not just by reading the code
- [ ] Share telemetry lands in PostHog from production (depends on the Phase 0 PostHog verification actually being done)
- [ ] OG option chosen and recorded here as an amendment, with the real cost of (b1)

---

## Phase 2 — Scrubber spike: trace format, engine, tooling (2–3 sessions)

The risk phase. Everything unknown about v2 lives here: what a trace is, how prediction is scored, and whether trace generation can be automated. **UI polish is explicitly out of scope** — the deliverable is a proven format, engine support, and five end-to-end pilot puzzles rendered through a deliberately ugly debug harness.

**Build:**

1. **Trace schema** (in `src/content/schema.ts`, new `interaction: 'scrubber'` member of the discriminated union). Keep the trace minimal and flat:
   - `steps: Array<{ line: number; vars: Record<string, string>; output?: string }>` — one entry per executed line, variables as display strings (post-line state)
   - `checkpoints: Array<{ afterStep: number; question: 'next-line' | 'var-value' | 'output'; target?: string; choices: string[]; correct: number }>` — 2–4 pause points where the player predicts before the scrubber advances
   - Zod refinements: checkpoint answers must be consistent with the trace itself (e.g., a `var-value` checkpoint's correct choice must equal the trace's value at that step). **The schema mechanically rejects internally inconsistent puzzles** — this is the whole game for content quality.
2. **Trace generator tooling** (`src/content/tools/traceGen/`):
   - JS: instrument the snippet (babel transform inserting a per-line trace call) and execute in `node:vm` with a step budget and no I/O; capture line + locals per step.
   - Python: a `sys.settrace` harness run via subprocess, same output shape.
   - Output feeds the puzzle JSON directly. An LLM (or a human) writes the snippet and picks checkpoint locations; the machine writes the trace.
3. **Engine** (`src/engine/`): scoring for multi-checkpoint attempts. Locked rule: **all checkpoints correct on first try = solve; any miss = fail** — one binary rated outcome per puzzle, same as v1, so Elo semantics don't change. Per-checkpoint results are recorded in the attempt log for future partial-credit tuning, but rating stays binary in v2. Engine stays pure TS, lint boundary enforced.
4. **Five pilot puzzles**, at least two per language, authored end-to-end through the real tooling — not hand-written JSON. Rendered via a bare debug page (dev-only route).

**Go/no-go checkpoint (end of phase):** answer three questions honestly before Phase 3:

- Authoring cost: can one scrubber puzzle go from idea → validated JSON in under ~15 minutes of tooling-assisted work? If not, what's the bottleneck?
- Is scrubbing the pilot puzzles actually more engaging than the v1 quiz, even ugly? (Self-test + one friend on the debug build — two data points beat zero.)
- Does the flat trace model hold, or do the pilots immediately demand call stacks/objects/closures that break the schema?

If any answer is bad, renegotiate here — shrink checkpoint types, restrict to JS-only, or simplify the trace model — before UI and content spend.

**DoD:**

- [x] `validate:content` rejects a trace/checkpoint mismatch (test with a deliberately corrupted fixture) — **verified**: `schema.test.ts` has one deliberately-corrupted fixture per refinement (13 cases), not one blanket "invalid puzzle" test
- [x] Trace generator produces identical traces on repeated runs (determinism — no timestamps, no randomness without a seed) — **verified**: both backends have a two-runs-deep-equal test; the Python backend additionally needed `PYTHONHASHSEED=0` (set/frozenset repr order is otherwise randomized per process) and, discovered mid-phase while authoring the pilots, a recursive sanitize pass so a container holding a function/object doesn't leak a memory address through Python's own `repr()` recursion — both are now regression-tested
- [x] Engine scoring unit-tested including the attempt-log shape for per-checkpoint results — **verified**: `scoreScrubberAttempt` + `CheckpointResult`, storage schema v4 bump with `checkpoint_results` on `AttemptSchema`
- [x] 5 pilot puzzles pass validation and are playable on the debug route — **verified**: 113/113 puzzles pass `validate:content`; `ScrubberDebugPage.test.tsx` drives a real pilot through a full SOLVED and a full FAILED run via the actual UI
- [x] Go/no-go checkpoint answered in writing, appended to this file as an amendment — below

**Amendment — go/no-go checkpoint:**

1. **Authoring cost.** Not a clean under-15-minutes-flat answer. Once the generator tooling was solid, designing a snippet, running it through `generateJsTrace`/`generatePyTrace`, hand-picking 2 checkpoints from the real trace output, and writing the puzzle JSON took roughly 8–12 minutes per puzzle for 4 of the 5 pilots — comfortably under budget. The 5th (`scl-010`, Python closures) is what actually surfaced a real determinism bug in `pyTracer.py` (a list of lambda objects leaked raw memory addresses — `<function <lambda> at 0x...>` — through Python's own recursive `repr()`, since the generator only sanitized the top-level value, not nested container elements). Diagnosing and fixing that added on the order of 20 extra minutes, and it was authoring time in every practical sense — you can't tell a puzzle is going to hit a tooling gap until you've hit it. **Bottleneck, named specifically:** not snippet design or checkpoint placement (both were fast and mechanical once the trace was in hand) — it was trace-inspection catching a tool bug, which is exactly what a spike phase is for. With that fix landed, the same class of puzzle is back to the 8–12 minute range. Net honest read: **yes, under 15 minutes is achievable once the tooling is correct**, but "the tooling is correct" isn't free the first time a given trace shape gets exercised — Phase 4's batch pipeline should expect a similar one-time tax the first time it hits container-of-functions traces, closures, or other shapes these 5 pilots didn't cover.

2. **Is it fun?** Self-test only — the human half (handing the debug build to someone else) is outstanding and is explicitly Thomas's, not attempted here. What I can report: the mechanism structurally produces a genuine predict-then-reveal beat that multiple-choice recognition doesn't — e.g. `oob-009` asks you to predict `sum`'s final value before revealing it silently became `NaN`, and `scl-009`/`scl-010` ask you to predict a closure array's contents before revealing every entry converged to the same value. That's a different cognitive task than "spot the bug in this static snippet," which was the retro's whole complaint about v1. Whether it's actually _fun_ — as opposed to structurally sound — is not something I can self-report honestly, since I authored these knowing the answers and can't experience the surprise a first-time player would. **Outstanding, by design**, per the division of responsibility above.

3. **Does the flat trace model hold?** Yes, for what these 5 pilots needed — no pilot required a call stack, object graph, or anything the `steps`/`checkpoints` shape couldn't express. Two real, narrower limitations surfaced, both Python-specific and both worth naming for Phase 4's authoring guidance rather than treated as blockers:
   - A nested function's own frame doesn't expose the outer variables it closes over via `frame.f_locals()` (a CPython introspection fact, not a schema limitation) — `scl-010`'s checkpoints had to target the _outer_ scope's view of `i`/`vals` rather than "what does the lambda see internally," which happened to be exactly the right pedagogical angle for that puzzle, but would block a puzzle that specifically needs to show a captured value from inside the nested call itself.
   - List/generator comprehensions introduce a synthetic per-comprehension frame with an opaque iterator variable (`.0`) and their own line-only vars — harmless here (those steps just weren't used in any checkpoint) but something a puzzle author needs to know to route around, not something the trace format needs to change to accommodate.
   - A structural asymmetry between backends, not a defect in either: Python's real `sys.settrace` fires one extra "loop line" event on the final, failing iteration check before a loop exits (confirmed against real CPython, not assumed); the JS backend's babel-instrumented header only fires on a _successful_ iteration. Traces for structurally-equivalent JS/Python snippets are therefore not step-count-identical — expected, since each backend is faithful to its own language's real execution, and nothing in the schema assumes cross-language parity.

   None of these forced a schema change. **The flat model holds** for the pattern space these pilots targeted (loop state, aliasing, closures, truthiness); call-stack- or object-graph-shaped puzzles are simply out of scope until proven necessary, which the pilots didn't demand.

4. **Bundle bytes.** Measured directly, not estimated: built `dist/` twice from the same tree, once with the 5 pilot puzzle files present and once with them removed (all other Phase 2 code — schema, engine, generators — held constant, since that's real infrastructure cost the puzzles don't carry).
   - Raw authored JSON (as written to disk): mean **1,814 bytes**/puzzle, worst case **2,241 bytes** (`scl-010`, the longest trace at 16 steps).
   - `dist/` delta for exactly these 5 puzzles: **6,967 bytes** total (1,289,710 with vs. 1,282,743 without) — **1,393 bytes**/puzzle average once Vite's JSON-to-module transform and minification strip the pretty-printing overhead.
   - Both numbers land well under the "if pilots land above ~5 KB each, say so loudly" threshold from the locked-decisions table — no alarm here.
   - Extrapolated to Phase 4's 40–60 scrubber puzzle target, using the more conservative raw-JSON rate: **≈73–109 KB** of new puzzle content; using the measured bundled rate: **≈56–84 KB** actually added to `dist/`. That range is comparable to, and at the high end _exceeds_, the ~58 KB Phase 7 is separately trying to reclaim (per Phase 1a's amendment) — not a red flag on its own, but a real number Phase 7's performance budget should be planned against rather than discovered after the fact. Lazy-loading content per puzzle (ruled out this phase as premature at 5 puzzles, per the plan) becomes a more concrete candidate to revisit once Phase 4's volume is real.

**Net go/no-go: proceed to Phase 3.** No answer above is bad enough to renegotiate the format, shrink checkpoint types, or restrict to JS-only. The one concrete carry-forward for Phase 4: price the bundle-bytes number above into its volume/pipeline planning rather than re-deriving it, and expect (not fear) a similar tooling tax the first time batch generation hits a trace shape these 5 pilots didn't exercise.

**Amendment — post-merge corrective (P0–P6, `docs/v2-phase2-review.md`):** a post-merge review of the merged Phase 2 work found one critical defect live on `main` and one design flaw baked into the schema and all five pilots, plus four lower-severity issues. This corrective PR actioned six of the seven (P0, P1, P2, P3, P4, P5; P6's doc-comment half — the code half is **OD-2**, above):

- **P0 (critical).** Scrubber puzzles were servable in Practice/Daily/Rush with no case in `PuzzleCardShell`'s interaction dispatch, rendering an empty, un-escapable interaction div. Fixed structurally, not by a rule to remember: `quizPool`/`scrubberPool` now partition `puzzlePool` once in `src/content/index.ts`; Practice/Daily/Rush consume `quizPool` only, and `PuzzleCardShell`'s dispatch is an exhaustive `switch` (`assertNever` default) that throws loudly for a scrubber puzzle instead of rendering nothing. Daily's calendar validator now rejects a scrubber id by rule (it was previously safe only by accident of the curated list's contents).
- **P1 (design).** `var-value`/`output` checkpoints could ask about state that had already been visible on screen for one or more prior steps — a masked value the player didn't actually have to compute. **Locked decision: Option B** (keep `steps[afterStep]` semantics; mask the target row at the pause — Phase 3's job, not this PR's) **over Option A** (shift every question forward to `steps[afterStep + 1]`). Option A was rejected in one sentence: it silently fuses two questions into one at a loop boundary — "predict which line runs next, then predict its effect" — and a miss can't tell you which half was wrong, exactly where the interesting puzzles live. Option B ships with two new hard schema refinements (see Phase 2 corrective PR): a `var-value` checkpoint's target must have changed value since the previous step, and an `output` checkpoint must sit on a step that actually produced output. Two real pilot checkpoints (`scl-010`, and `tc-009` — found only by running the new rule, not anticipated by the review) needed re-picking as a result.
- **P2.** JS trace determinism was claimed but unenforced (`Math.random`/`Date.now`/`new Date()` all reachable, and the existing determinism test could never fail regardless of whether the guarantee held). Now enforced: the sandbox throws a named authoring error for all three; `new Date(...)` with explicit arguments stays allowed, since that form is genuinely deterministic.
- **P3.** `vars` key order reordered mid-scrub as bindings entered nested scopes (a loop counter jumping ahead of outer-scope variables). Fixed to first-seen order across the whole trace, computed at snapshot-display time. Python's backend was checked and found not to share this instability (no block scoping; frame/module-namespace order is already stable).
- **P4.** Multiple `console.log` calls between two trace steps joined with `' '` instead of `'\n'`, able to disagree with what a real terminal would show for an `output` checkpoint. Fixed; the dev debug harness's "output so far:" label (which was never cumulative) is now "output since previous step:".
- **P5.** An `output` checkpoint's inability to sit on an output-less step was an emergent, undocumented side effect of two unrelated schema rules. Made an explicit, stated refinement with an authoring-quality error message (folded into the P1 fix above, since both land in the same `superRefine` pass).
- **P6 (doc comment only; code tracked as OD-2).** `jsTraceGen.ts`'s isolation claim overstated what `node:vm` provides. Softened to state plainly that it is not a security boundary, with the concrete escape payload confirmed against this sandbox's actual shape — fine for hand-authored snippets now, a decision Phase 4 must make deliberately before batch-generating from LLM output.

**This amendment supersedes Phase 3 build items 3–4 below and the Phase 1b gating note** — see each section's own amendment for the mode-boundary and sequencing consequences.

---

## Phase 3 — Scrubber UI (2–3 sessions)

**Build:**

1. **Scrubber component** (`src/app/practice/interactions/Scrubber.tsx` + supporting pieces): code pane with current-line highlight, a state panel showing live variable values, and a scrub control. Mobile-first: the scrub control is a horizontal drag surface (chess.com-analysis-style), with prev/next tap targets; desktop gets arrow keys.
2. **Checkpoint flow**: scrubbing forward locks at a checkpoint; player answers the prediction (reuses MCQ answer plumbing); reveal shows correct value + the state diff; scrubbing continues. After the final checkpoint, the standard explanation/solve screen.
3. **Own mode, not a fourth Practice branch** (amended — see the Phase 2 corrective amendment above). Scrubber gets a dedicated route + session hook (`useScrubberSession.ts`/`ScrubberPage.tsx`, following Rush's structural precedent: `useRushSession.ts`/`RushPage.tsx` — a session shape distinct enough from Practice's single-commit-per-puzzle loop to warrant its own hook, same reasoning that already justifies Rush's). It consumes **`scrubberPool`** (never `quizPool`/`puzzlePool` directly — the pool split is a structural guarantee, not a per-caller filter to remember). Rated on the **same shared Elo ladder** as the quiz modes: one binary rated outcome per puzzle (all checkpoints correct on first try = solve, any miss = fail), exactly the decision already locked in `scrubber.ts` — no second rating number, no `UserProfile` schema bump. `checkpoint_results` is already logged per attempt (Phase 2's storage v4 work), so splitting the ladder later is possible on evidence if Phase 6 calibration ever calls for it; it is not this phase's job.
4. Practice, Daily, and Rush stay quiz-only, serving from `quizPool` exclusively — this was the corrective PR's P0 fix and must not regress. **Daily serving a scrubber puzzle is explicitly out of scope for this phase** — the curated calendar and its validator already support the idea structurally (and already hard-reject a scrubber id today), but whether Daily ever serves one is a deliberate Phase 3+ **content** call, not a rendering decision this phase makes by default. `/puzzle/:id` (Phase 1b) is sequenced after this phase — see its own amended gating note — and will need its own dispatch decision (`puzzlePool`, the full union, is why that export still exists) when built.
5. Respect v1's hard-won mobile lessons: safe-area insets, no scroll-vs-gesture conflicts (the drag surface must not fight page scroll), haptics on checkpoint results.

**DoD:**

- [ ] All 5 pilot puzzles playable start-to-finish on a real phone and desktop
- [ ] Scrub gesture doesn't conflict with page scroll or PWA edge gestures on iOS
- [ ] Rated attempt lifecycle (attempt log, rating update, requeue on miss) verified in tests for the scrubber path
- [ ] Telemetry: `attempt` events carry interaction type + per-checkpoint results
- [ ] Scrubber mode serves from `scrubberPool`, never `quizPool`/`puzzlePool` — asserted in a test, not by inspection (same standard as the Phase 2 corrective's `quizPool`-exclusion test)
- [ ] The checkpoint's target row is masked at the pause — a render test asserts the target value is absent from the DOM until the player answers (Option B, docs/v2-phase2-review.md, P1)

**You verify:** hand the phone to someone and say nothing. If they can't figure out scrubbing within ~15 seconds, the affordance is wrong — fix before Phase 4.

---

## Phase 4 — Scrubber content pipeline + volume (2–3 sessions + generation runs)

**Build:**

1. **Pipeline** extending `generatePuzzles.ts` (or a sibling `generateScrubberPuzzles.ts`): LLM proposes snippet + bug + checkpoint placements → trace generator executes the code → validator asserts checkpoint consistency → anything inconsistent is rejected automatically, not reviewed by a human. Human/LLM review is only for "is this interesting," never "is this correct."
2. **Before any batch run**: split generate/review into separate per-model constants with per-model pricing feeding `COST_CEILING_USD` — the backlog's explicit warning that the cost guard is silently wrong for non-Sonnet models. This is a blocking precondition, not a nice-to-have.
3. **Difficulty anti-anchoring**: rubric prompt applies S/T/D/C dimensions with explicit instruction to sum to non-round values; add a `content:stats` validation warning when >15% of the library sits on any single rating value. (v1: most of 104 puzzles at exactly 1000/1600/1700/1900.)
4. **Language mix target for scrubber content**: 60/40 JS/Python (only languages the trace tooling supports). Quiz content keeps all four languages — targets set in Phase 6.
5. Generate + curate **40–60 scrubber puzzles** spanning ≥800 rating points per major pattern represented, no empty 200-point bucket in the 800–2199 range.

**DoD:**

- [ ] Pricing constants are per-model and correct before the first batch (checked against current API pricing on the day of the run)
- [ ] ≥40 scrubber puzzles live, `content:stats` shows the curve targets met and no round-number clustering warning
- [ ] Zero puzzles in the library whose checkpoints a machine couldn't verify

---

## Phase 5 — Quiz mode upgrades (2 sessions)

The v1 modes stay worth playing. Everything here is from the todo-list items in the backlog.

**Build:**

1. **Drag-and-drop code blocks** as a fourth quiz interaction type (`interaction: 'drag-order'`): rearrange shuffled lines/blocks into correct order (or drag the fix into place). Schema + validation + generation support. This directly re-fights v1's known enemy — **drag jank and sizing on phones** — so build it mobile-first with pointer events, explicit touch-action handling, and generous hit targets; test on a real phone before merging, not after.
2. **Daily**: reveal the puzzle's rating after solving (not before — don't anchor the attempt).
3. **Rush**: right-side progress bar; difficulty escalates as the run progresses (selection window shifts upward with streak length — engine change, unit-tested); timer pressure escalates (e.g., shrinking per-puzzle bonus time) to raise stakes late in a run. Rush stays unrated; best-score stats only, per v1's locked decision.

**DoD:**

- [ ] Drag interaction is smooth on a real mid-range phone — no layout shift, no scroll fighting, no mis-sized cards
- [ ] Rush escalation logic unit-tested in `engine/rush.ts`; progress bar reflects actual run state
- [ ] Daily shows rating only post-solve; share text unchanged unless trivially improved

---

## Phase 6 — Content calibration + quiz volume (1–2 sessions + generation runs)

**Build:**

1. **Recalibrate the existing 108** against the rubric using the Phase 4 anti-anchoring prompt; manually spot-check 15 random puzzles (≥12 within ±200, same bar as v1's unfinished checkpoint).
2. **Set a language mix target for quiz content** (e.g., 40/25/25/10 JS/Python/Java/C) and steer generation toward it — v1 drifted to 61% JS because no target existed.
3. **Volume**: grow the quiz library toward ~200 (including new drag-order puzzles) — the backlog's "puzzle separation + bigger puzzle libraries" item. 108 puzzles ≈ four sessions before repeats; combined with 40–60 scrubber puzzles this roughly triples total content.
4. Self-review pass over every new explanation — the explanation is the educational product (carried forward from v1's unfinished Phase 8 checkbox).
5. **Give swipe-binary a real negative class** — the half of the Phase 0 skew bug that Phase 0 deliberately didn't fix. Every snippet in the v1 library contains a bug, so the label naming a bug is always correct and a player who reads only the labels still wins without reading code. Author swipe puzzles whose code is genuinely fine (the "Safe" label is the correct answer), and extend the Phase 0 direction-skew validator with a second check on the correct-label _semantics_, not just the side. Target: at least a third of swipe-binary puzzles answer "the code is fine."

**DoD:**

- [ ] Calibration spot-check passes; round-number clustering warning clean across the full library
- [ ] Language mix within ±10 points of target
- [ ] ≥200 total puzzles passing `validate:content`
- [ ] ≥⅓ of swipe-binary puzzles have non-buggy code as the correct answer; label-semantics check enforced in validation

---

## Phase 7 — Export/import UI + performance (1–2 sessions)

**Build:**

1. **Export/import UI**: a settings surface (new `/settings` route) with export-to-file and import-from-file, calling the existing tested `exportData()`/`importData()`. Import shows a confirm-overwrite dialog with what's about to be replaced. This is also the cross-device answer for v2 (no backend, no sync — move your data by file).
2. **Lighthouse 90+ on production** (v1 shipped at 82): route-level code splitting (router from Phase 1 makes this natural — Rush/Browse/Legal/Settings lazy-loaded), attack the ~460 ms of render-blocking resources and ~58 KB unused JS, preload the LCP element, fix the inefficient cache policy on the flagged static resource via `_headers`. Measure on production after deploy, not just local.

**DoD:**

- [ ] Export → wipe site data → import → identical rating/history (on production, real browser)
- [ ] Lighthouse performance ≥90 on production, accessibility ≥94 (no regression), SEO ≥90 (routing + per-route meta should get this nearly free)
- [ ] Bundle report checked: no interaction-type code loads on routes that don't use it

---

## Phase 8 — Hardening + regression (1 session)

Feature freeze. Verification only — the v1 Phase 9 checklist, minus the adoption/marketing items (deliberately out of scope for v2, same reasoning as the v1 wrap-up).

- [ ] `pnpm validate` green from a fresh clone
- [ ] **Every row in "Known open defects" is closed by a commit, or carries a written waiver here.** OD-1 (swipe reliability on phone) is the one currently open — it is a flagship-interaction defect on the app's most-used gesture, so a waiver is a high bar, not a formality
- [ ] Full interaction regression on two real phones (iOS + Android): all four quiz types + scrubber, Practice/Daily/Rush/Browse/puzzle-link paths
- [ ] PWA: install, offline boot, SW update prompt against a real deploy
- [ ] Production checks: 404, robots, per-route OG/meta, deep links, Lighthouse numbers recorded here as an amendment
- [ ] Telemetry: scrubber and drag-order events visible in PostHog from production
- [ ] Storage: migration test covers any v2 schema bumps (v1 fixture → v2 schema → asserted shape)

---

## Backend-ready seams (built in v2, used in v3)

No backend code in v2, but three cheap conventions keep v3's door open:

1. **Stable anonymous ID** in the profile store (generate once, export/import carries it) — becomes the sync/leaderboard identity if v3 adds one.
2. **Attempt log stays append-only and self-describing** (it already is) — it's the natural sync payload.
3. **`exportData()` format is versioned** (it already is, via storage schema versioning) — a v3 backend can accept an export blob as its onboarding import.

## Traceability — every `v2-backlog.md` item

| Backlog item                                                      | Disposition                                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution scrubber (named v2 flagship)                            | Phases 2–4                                                                                                                                    |
| Drag-and-drop code blocks interaction                             | Phase 5                                                                                                                                       |
| Drag-and-drop jank / sizing on phone                              | Phase 5 (built into the new interaction's DoD)                                                                                                |
| Puzzle shareability                                               | Phase 1b (gated on the Phase 2 go/no-go)                                                                                                      |
| Puzzle separation + bigger libraries                              | Phase 6                                                                                                                                       |
| Show puzzle rating on Daily after solving                         | Phase 5                                                                                                                                       |
| Browse Puzzles selection bug                                      | Phase 0 (desktop-only layout defect)                                                                                                          |
| LCP / Lighthouse 82 → 90+                                         | Phase 7                                                                                                                                       |
| Swipe-binary always resolves "right"                              | Phase 0 — **rediagnosed**: content skew (39/39 `correct_direction: "right"`), not a `SwipeBinary.tsx` defect                                  |
| Swipe-binary has no genuinely-correct-code puzzles (deeper tell)  | Phase 6 (surfaced by the Phase 0 rediagnosis)                                                                                                 |
| Swipe gesture buggy on phone                                      | Phase 0 — **two root causes fixed** (32ms kinematics staleness, zero touch `axisThreshold`); a third defect survives both → **OD-1**, Phase 8 |
| Rush: progress bar, escalating difficulty, timer stakes           | Phase 5                                                                                                                                       |
| No URL routing / `/legal` not deep-linkable                       | Phase 1a                                                                                                                                      |
| No `_redirects` file — deep links 404 on Cloudflare Pages         | Phase 1a (surfaced while scoping 1a; the naive `/* /index.html 200` fix would break the 404 requirement)                                      |
| SW `navigateFallback` has no denylist — 404 differs in PWA vs tab | Phase 1a (surfaced while scoping 1a)                                                                                                          |
| Per-route OG tags don't unfurl (bots don't run JS)                | Phase 1b decides; prerender option (b1) priced and handed to Phase 7                                                                          |
| Share loop uninstrumented                                         | Phase 1b (otherwise shareability is unevaluable at end of v2)                                                                                 |
| Route-change focus/scroll management                              | Phase 1a (a router regresses both by default)                                                                                                 |
| Swipe still unreliable on phone after both Phase 0 gesture fixes  | **OD-1** — Known open defects table, owned by Phase 8                                                                                         |
| Export/import has no UI                                           | Phase 7                                                                                                                                       |
| Production telemetry inactive                                     | Phase 0 (verify the out-of-repo fix)                                                                                                          |
| 404 re-verification after next deploy                             | Phase 0                                                                                                                                       |
| `generatePuzzles.ts` model/pricing split                          | Phase 4 (blocking precondition to any batch)                                                                                                  |
| LLM difficulty ratings anchor to round numbers                    | Phases 4 & 6                                                                                                                                  |
| No target language mix                                            | Phases 4 (scrubber) & 6 (quiz)                                                                                                                |
| Content volume ceiling (108 ≈ four sessions)                      | Phases 4 & 6                                                                                                                                  |
| Backend / leaderboard / social loop                               | **Deferred to v3** (locked decision)                                                                                                          |
| Security/accounts block (Clerk, 2FA, rate limits, token storage)  | **Deferred to v3** (follows backend)                                                                                                          |
| AI features (unspecified)                                         | **Deferred** — undefined; define before scoping. The scrubber pipeline _is_ the v2 AI investment.                                             |
| AI-generated reel videos (marketing)                              | **Deferred** — v2 is build-only, no marketing                                                                                                 |

## Deferred to v3 — the trigger

The decision to put Codoro in front of real users **has been made**: v3 is the launch version. The full arc — v3 launch (anonymous backend + distribution), v4 accounts, v5 multiplayer — lives in `docs/roadmap.md`. v2 itself stays build-only; the backend-ready seams above are its only concession to that future.
