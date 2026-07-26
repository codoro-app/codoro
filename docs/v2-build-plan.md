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

| Phase | What                                             | Est. sessions    |
| ----- | ------------------------------------------------ | ---------------- |
| 0     | Carryover bug fixes + live-deploy verification   | 1–2              |
| 1     | URL routing + shareable puzzle links             | 1–2              |
| 2     | Scrubber spike: trace format, engine, tooling    | 2–3              |
| 3     | Scrubber UI                                      | 2–3              |
| 4     | Scrubber content pipeline + volume               | 2–3              |
| 5     | Quiz upgrades: drag-and-drop, Daily, Rush        | 2                |
| 6     | Content calibration + quiz volume                | 1–2 + batch runs |
| 7     | Export/import UI + performance to Lighthouse 90+ | 1–2              |
| 8     | Hardening + regression                           | 1                |

Phases 0 and 1 are prerequisites. Phases 2→3→4 are the flagship arc and must run in order. Phases 5–7 are independent of each other and can interleave anywhere after Phase 1 if a scrubber session stalls.

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

- [ ] Swipe-binary `correct_direction` split lands in 45–55%, reproducible from a committed script, with a content-level test that would have caught the original 39/39 skew
- [ ] `validate:content` hard-fails a deliberately skewed fixture (>65/35) and passes the rebalanced library; generator and `devPuzzles.ts` no longer anchor to one direction
- [ ] Swipe gesture verified smooth and reliable on real iOS and Android phones — no dropped gestures, no accidental resolutions, no scroll fighting; root cause identified in writing and covered by a test
- [ ] Browse on desktop: selecting a pattern renders an interactive puzzle in-layout; mobile flow unchanged, both widths tested
- [ ] A production event is visible in PostHog, triggered from a real phone
- [ ] Bad path on getcodoro.com returns HTTP 404; SW update prompt observed after a real deploy

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

---

## Phase 1 — URL routing + shareable puzzle links (1–2 sessions)

v1 has no router at all — `AppMode` is in-memory state, `/legal` isn't a real URL. v2 needs routing for shareability, per-route OG tags, and route-level code splitting (which Phase 7's performance work depends on).

**Build:**

1. Add a router. Recommendation: **wouter** (~2 KB) over react-router (~20 KB) — Phase 7 has to claw back ~58 KB of unused JS to hit Lighthouse 90+, so don't spend 20 KB on routing when the route table is seven entries. Tradeoff: less ecosystem; fine at this scale.
2. Routes: `/` (home), `/practice`, `/daily`, `/rush`, `/browse`, `/legal`, `/puzzle/:id`. `AppMode` state is replaced by the route; NavRail/ModeSwitcher become links.
3. `/puzzle/:id` renders any bundled puzzle in its native interaction type, unrated, with a "practice more like this" CTA into the app. This is the shareability feature — a URL anyone can open.
4. Share affordance on the post-solve screen (Daily already has ShareCard/shareText — extend to include the puzzle URL; add share to Practice's solve state).
5. Per-route `<title>`/OG description; update `404.html` links; ensure Cloudflare Pages SPA fallback still serves the app shell for valid deep links.

**DoD:**

- [ ] Direct load of `getcodoro.com/legal` and `getcodoro.com/puzzle/<real-id>` on production renders the right content (no SPA-boot-to-home behavior)
- [ ] Back/forward navigation behaves; PWA launch and SW update flow unaffected (re-verify installed-app launch on a real phone)
- [ ] Bad puzzle id → real not-found state, not a crash
- [ ] Rating semantics unchanged: `/puzzle/:id` attempts are never rated

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

- [ ] `validate:content` rejects a trace/checkpoint mismatch (test with a deliberately corrupted fixture)
- [ ] Trace generator produces identical traces on repeated runs (determinism — no timestamps, no randomness without a seed)
- [ ] Engine scoring unit-tested including the attempt-log shape for per-checkpoint results
- [ ] 5 pilot puzzles pass validation and are playable on the debug route
- [ ] Go/no-go checkpoint answered in writing, appended to this file as an amendment

---

## Phase 3 — Scrubber UI (2–3 sessions)

**Build:**

1. **Scrubber component** (`src/app/practice/interactions/Scrubber.tsx` + supporting pieces): code pane with current-line highlight, a state panel showing live variable values, and a scrub control. Mobile-first: the scrub control is a horizontal drag surface (chess.com-analysis-style), with prev/next tap targets; desktop gets arrow keys.
2. **Checkpoint flow**: scrubbing forward locks at a checkpoint; player answers the prediction (reuses MCQ answer plumbing); reveal shows correct value + the state diff; scrubbing continues. After the final checkpoint, the standard explanation/solve screen.
3. Integrate as a first-class interaction type in Practice (selection, rating via Phase 2 engine work, spaced-repetition requeue, telemetry events for per-checkpoint results).
4. Daily and `/puzzle/:id` support scrubber puzzles automatically (interaction types are already per-puzzle).
5. Respect v1's hard-won mobile lessons: safe-area insets, no scroll-vs-gesture conflicts (the drag surface must not fight page scroll), haptics on checkpoint results.

**DoD:**

- [ ] All 5 pilot puzzles playable start-to-finish on a real phone and desktop
- [ ] Scrub gesture doesn't conflict with page scroll or PWA edge gestures on iOS
- [ ] Rated attempt lifecycle (attempt log, rating update, requeue on miss) verified in tests for the scrubber path
- [ ] Telemetry: `attempt` events carry interaction type + per-checkpoint results

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

| Backlog item                                                     | Disposition                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Execution scrubber (named v2 flagship)                           | Phases 2–4                                                                                                   |
| Drag-and-drop code blocks interaction                            | Phase 5                                                                                                      |
| Drag-and-drop jank / sizing on phone                             | Phase 5 (built into the new interaction's DoD)                                                               |
| Puzzle shareability                                              | Phase 1                                                                                                      |
| Puzzle separation + bigger libraries                             | Phase 6                                                                                                      |
| Show puzzle rating on Daily after solving                        | Phase 5                                                                                                      |
| Browse Puzzles selection bug                                     | Phase 0 (desktop-only layout defect)                                                                         |
| LCP / Lighthouse 82 → 90+                                        | Phase 7                                                                                                      |
| Swipe-binary always resolves "right"                             | Phase 0 — **rediagnosed**: content skew (39/39 `correct_direction: "right"`), not a `SwipeBinary.tsx` defect |
| Swipe-binary has no genuinely-correct-code puzzles (deeper tell) | Phase 6 (surfaced by the Phase 0 rediagnosis)                                                                |
| Swipe gesture buggy on phone                                     | Phase 0 (separate bug from the skew, not a symptom of it)                                                    |
| Rush: progress bar, escalating difficulty, timer stakes          | Phase 5                                                                                                      |
| No URL routing / `/legal` not deep-linkable                      | Phase 1                                                                                                      |
| Export/import has no UI                                          | Phase 7                                                                                                      |
| Production telemetry inactive                                    | Phase 0 (verify the out-of-repo fix)                                                                         |
| 404 re-verification after next deploy                            | Phase 0                                                                                                      |
| `generatePuzzles.ts` model/pricing split                         | Phase 4 (blocking precondition to any batch)                                                                 |
| LLM difficulty ratings anchor to round numbers                   | Phases 4 & 6                                                                                                 |
| No target language mix                                           | Phases 4 (scrubber) & 6 (quiz)                                                                               |
| Content volume ceiling (108 ≈ four sessions)                     | Phases 4 & 6                                                                                                 |
| Backend / leaderboard / social loop                              | **Deferred to v3** (locked decision)                                                                         |
| Security/accounts block (Clerk, 2FA, rate limits, token storage) | **Deferred to v3** (follows backend)                                                                         |
| AI features (unspecified)                                        | **Deferred** — undefined; define before scoping. The scrubber pipeline _is_ the v2 AI investment.            |
| AI-generated reel videos (marketing)                             | **Deferred** — v2 is build-only, no marketing                                                                |

## Deferred to v3 — the trigger

The decision to put Codoro in front of real users **has been made**: v3 is the launch version. The full arc — v3 launch (anonymous backend + distribution), v4 accounts, v5 multiplayer — lives in `docs/roadmap.md`. v2 itself stays build-only; the backend-ready seams above are its only concession to that future.
