# Prompt for Claude Code — v2 Phase 7 (Export/import UI + performance)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

The authoritative spec is `docs/v2-build-plan.md`, **"Phase 7 — Export/import UI + performance"**, plus the standing rules at the top of `docs/prompts/claude_code_prompt_v2_phase5.md` (module boundaries, smallest-diff discipline, revert-check reviews, no new dependencies without a written reason). Read both before writing code. Nothing in either is relitigated here.

**Precondition:** `v2-phase-5c` must be **merged to `main`** before you branch. Work on `v2-phase-7` off the updated `origin/main`. If 5c is not merged, stop and say so — do not branch off `v2-phase-5c`. Phase 7's headline DoD item (Lighthouse ≥90 **on production**) is unmeasurable until the branch under it is deployed, and 5c's own two open DoD boxes are production checks queued behind the same deploy.

---

## Orchestration model — read this before Item 0

This phase is delegated deliberately, not uniformly. The repo already defines three subagents (`.claude/agents/scout.md`, `implementer.md`, `reviewer.md`); use them as written rather than inventing new roles.

**The lead (you) personally owns, and never delegates:**

- Every design call and every trade-off recorded in the amendment (see "Decisions the lead must make in writing" below).
- All amendment and plan-doc prose. Phase 5's amendment convention holds: written by the lead, not delegated.
- The judgement of whether a measurement actually met its bar. A subagent reporting "Lighthouse 91" is a claim; the recorded number and the conditions it was taken under are yours.

**Fan out `scout` (Haiku, read-only) in parallel — these are independent questions, dispatch them in one batch, not serially:**

1. Every current import of `exportData`/`importData` (`src/storage/exportImport.ts`) and every call site, plus the exact shape and version field of the export blob. Return signatures and file:line, not file dumps.
2. Every route registration site: `src/app/App.tsx` `<Route>` list, `src/app/routes.ts` (`ROUTES`, `ROUTE_META`, `DYNAMIC_ROUTES`, `labelForPath`), `src/app/routes.test.ts`'s drift guards, `public/_redirects`, and the SW `navigateFallbackDenylist` in `vite.config.ts`. Adding `/settings` touches all of them — the drift guard exists so that forgetting one turns a test red, so map them first.
3. The current bundle composition: what `vite.config.ts` already does about chunking, what `src/app/App.bootHomeChunk.test.tsx` currently asserts, and which interaction-type modules (`SwipeBinary`, `DragOrder`, `TraceRunner`/`Scrubber`, `CheckpointPanel`) are reachable from the initial chunk today.
4. Where a loading state would actually be observable in this app: enumerate every genuinely async boundary a user waits on (IndexedDB reads, dynamic `import()`, image/font loads). This one is load-bearing for a decision below — see Item 3.
5. The stable anonymous ID: where it's generated, where it's persisted, whether `exportData()` carries it, and every read site. Cross-reference `src/telemetry/client.ts`'s init config and `src/telemetry/README.md`'s identity claims. Load-bearing for Item 6.

**Delegate to `implementer` (Sonnet), one bounded brief each, named file list, non-overlapping files only:**

- The `/settings` route registration across the five sites scout #2 maps, once the lead has decided the route's shape.
- The export/import file I/O plumbing (Blob download, `<input type="file">` read, parse → validate → confirm → commit), once the lead has written the confirm-dialog contract.
- Mechanical lazy-route conversion for the routes the lead names, plus the `_headers` cache-policy rules.

Run at most two implementers concurrently, and only when their file lists are provably disjoint. `src/app/routes.ts` and `vite.config.ts` are shared-edit hotspots in this phase — do not let two agents hold either at once.

**`reviewer` (Opus) is mandatory on exactly two diffs**, each given the tight diff only, never the whole branch:

- The import path (Item 1) **together with the retention-identity change (Item 6)** — one review, both diffs, because they collide on the stable anon ID and reviewing either alone misses it. This is the one surface in v2 that can destroy a user's data, and now also the one that can silently corrupt the retention number a v4 decision rests on. Review as a data-integrity change, not a UI change.
- The code-splitting + SW change (Item 2). Review it against the "returning PWA user re-downloads everything" failure mode specifically, not just bundle size.

The revert-check question is unchanged and non-negotiable: **does the new test fail if the fix is reverted?** If it still passes, the test is asserting the wrong thing.

`implementer`'s escalation rule stands: same error surviving two fix attempts → stop and escalate to `reviewer` with what was tried. Do not let an implementer thrash.

---

## Item 0 — Close the `docs/todo.md` traceability hole (documentation only, do this first)

`docs/v2-build-plan.md`'s own rule is "every item is assigned or explicitly deferred. Nothing gets to hide." Its todo.md traceability table stops at item 8. `docs/todo.md` has since grown items 9–17 with no disposition anywhere. Nine items are currently hiding. Close that before building, so this phase's scope is decided rather than discovered mid-session.

Append the rows below to the **"Traceability — every `docs/todo.md` item"** table, marking them as a 2026-08 second fold-in. The dispositions are pre-decided — do not relitigate them, but do flag in writing if implementing one contradicts something already shipped:

| todo.md item                       | Disposition                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 9. Skeleton loaders                | **Phase 7, scoped down** — only at the lazy-route boundary Item 2 creates. See Item 3's constraint before building any others.   |
| 10. Caching                        | **Phase 7** — the `_headers` cache policy + SW precache work already in Item 2. Not a new application-level cache layer.         |
| 11. Optimistic rendering           | **Deferred, with a written reason** — see Item 3. Revisit in v3 when a network round-trip exists to be optimistic about.         |
| 12. Tooltips                       | **Phase 6c** — an affordance question, belongs with the click-meaningfulness UX pass, not with performance work.                 |
| 13. _(blank in todo.md)_           | No content. Leave the row so the gap is visible rather than silently renumbered.                                                 |
| 14. No timer on regular Trace mode | **Phase 7, Item 4** — reverses a Phase 5b decision by direct user preference; the mechanism already exists. See Item 4.          |
| 15. Privacy policy                 | **Phase 7, Item 5** — `/legal` exists but goes stale the moment Item 1 ships. Lawyer review is a **v3.0** launch-readiness item. |
| 16. Terms of service               | **Phase 7, Item 5** — same page, same refresh.                                                                                   |
| 17. Tiered answers                 | **Undefined — deferred pending a definition session**, same standing as todo item 8. Do not scope it here.                       |

---

## Item 1 — Export/import UI (`/settings`)

Build-plan item 1, unchanged in intent. `exportData()`/`importData()` already exist and are tested in `src/storage/exportImport.ts`; this is a UI over them plus route registration. **Do not modify the storage functions** — if you find yourself wanting to, that's a finding to report, not a change to make.

Design calls the lead must settle before any implementer starts:

- **The confirm-overwrite contract.** The plan requires the dialog show "what's about to be replaced." Decide precisely what that means and record it: at minimum the current profile's rating, attempt count, and best streak, versus what the incoming file claims. A dialog that says "this will overwrite your data" without numbers is not what the DoD asks for.
- **Bad-input behavior, all four cases:** not JSON; JSON but not an export blob; a valid blob at an unknown/newer schema version; a valid blob at an older version that needs migration. Each gets a legible named state, same standard as `/puzzle/:id`'s bad-id branch and 5c's broken-link state. **A failed import must leave existing data untouched** — validate fully before writing anything, never partially commit.
- **Whether `/settings` is a NavRail/ModeSwitcher entry.** Recommendation: no — it belongs in the app-shell footer alongside `/legal`, which is already the established pattern for non-mode routes. Record the call either way, because `routes.ts`'s comment block explains exactly which routes are and aren't `ROUTES` entries and that comment must stay true.
- **The rating-reset procedure.** Phase 0's DoD line 125 has been open since Phase 0: "local rating reset available (export → edit → import)" with the note that it "needs to be written down somewhere durable." This UI is that durable place. Closing a long-open DoD line for free is worth the two extra sentences of copy — write the procedure into the settings page itself, then tick line 125 in the plan and say you did.

---

## Item 2 — Performance to Lighthouse 90+

Build-plan item 2: route-level code splitting (Rush/Browse/Legal/Settings lazy), the ~460 ms of render-blocking resources, ~58 KB unused JS, LCP preload, `_headers` cache policy. Measured **on production after deploy**, not locally.

Two things the plan doesn't name, both of which this phase should close because it is already in this code:

1. **Lazy chunks change the SW precache manifest every deploy.** `docs/roadmap.md`'s v3.0 scaling-validation gate, item 1, requires exactly this: "the SW precache doesn't force a full re-download per deploy for every returning user." You are about to multiply the number of precached chunks. Verify the returning-user update cost against a real deploy and **record the measured number as an amendment** — that closes a v3.0 gate item early, from inside the phase that caused the risk, instead of discovering it during launch prep.
2. **Splitting must not break the routing drift guards.** `routes.test.ts`, `_redirects`, and `navigateFallbackDenylist` all have to keep holding for every lazily-loaded route. The 1a/1b/5c lesson (Finding 4) applies unchanged: **verify a cold load on production in a fresh incognito window**, not through an installed SW's cache. A green suite has already twice failed to catch a broken cold load in this repo.

Report Lighthouse as before/after numbers with the run conditions recorded. If any category lands under target, that is a finding to write down, not a number to re-run until it's flattering.

---

## Item 3 — Skeleton loaders and optimistic rendering, scoped honestly

todo items 9 and 11. **Push back on these rather than implementing them as written**, and record the reasoning in the amendment.

Codoro is local-first with content in the bundle. There is no network round-trip in the play loop — puzzles come from the bundle, profile and attempts come from IndexedDB in single-digit milliseconds. Optimistic rendering is a technique for hiding server latency; there is no server. A skeleton for a synchronous read is a fake loading state that makes the app _slower to feel_, not faster.

Where a loading state is genuinely real is the boundary **Item 2 is about to create**: a lazy route's `React.Suspense` fallback on a cold or slow connection. Build a skeleton there, sized to the incoming route so there's no layout shift when it resolves — and nowhere else, unless scout #4 surfaces an async boundary this brief didn't anticipate. If it does, name it and decide; don't build speculatively.

Recording _why_ item 11 is deferred is the deliverable here, not code. "Deferred, revisit in v3 when a network round-trip exists" is a real disposition; silence is not.

---

## Item 4 — Remove the Trace timer from the regular Trace mode

todo item 14, by direct user preference. This **reverses a Phase 5b decision**, so it gets an explicit amendment entry rather than a quiet commit.

The mechanism already exists: `TraceRunner`'s `timed` prop, added in 5b, and `/puzzle/:id` already renders Trace with `timed={false}` on the reasoning that a stranger on an unchosen link shouldn't be timed. Extending that to `/trace` is a small change; the care goes into the surrounding decisions:

- **Does `TRACE_CHECKPOINT_TIME_LIMIT_MS` and its whole clock stay in the code?** Recommendation: yes, keep the timed path alive and tested — Phase 6b's boss run and 6c's "⚡ Speed Round" are the obvious future consumers, and deleting a tested 30s per-checkpoint clock now means rebuilding it in two phases. But `/trace` becomes untimed, and nothing may be left claiming otherwise. 5b's own decision 5 set the precedent: do not leave a stale locked-decision claim in source. Sweep the comments.
- **Telemetry.** `timed_out` on Trace attempts becomes structurally unreachable from `/trace`. Don't delete the field (the timed path survives); do note the change in `src/telemetry/README.md` so a future reader doesn't diagnose the drop to zero as a bug.
- **Amendment text.** State plainly that the 5b clock decision is superseded for `/trace`, why (user preference — scrubbing is Trace's core interaction and a clock discourages it, which was the same reasoning that made the clock per-checkpoint rather than per-puzzle in the first place), and where the timed path still lives.

---

## Item 5 — `/legal` refresh

todo items 15 and 16. The page exists (`src/app/legal/LegalPage.tsx`, 53 lines, "Last updated 2026-07-26", good-faith developer-written, not lawyer-reviewed). It is not missing — it is about to go **stale**, which is worse, because Item 1 changes something the page currently asserts.

Read it and correct at minimum:

- The privacy section tells users to export or clear data "from your device settings." After Item 1 there is a real in-app `/settings` export. Point at it.
- Challenge links (5c) put puzzle results in a URL that gets shared. That is not personal data and it never touches a server, but the page currently says nothing about it and it is the one surface where a user's data leaves their device by design. One honest sentence.
- Bump the "Last updated" date.

**Do not** upgrade the disclaimers, add a cookie banner, or write GDPR/CCPA language. The page's own framing ("good-faith developer-written notice, not lawyer-reviewed") is accurate and appropriate for a pre-launch, no-accounts, no-PII app. Real legal review is a **v3.0 launch-readiness** item — add it to `docs/roadmap.md`'s v3.0 phase row if it isn't there, and leave it there.

**Sequencing:** Item 6 may also change what this page must say. Settle Item 6's decision first, then write the notice **once**. Do not edit `LegalPage.tsx` twice in this branch.

---

## Item 6 — Retention identity: attach the stable anonymous ID to telemetry

**Not a todo.md item — a gap found reviewing the telemetry wiring after PostHog activation (2026-08-06).** It lands here because it is time-sensitive and because Item 5 is already editing the one file its privacy implication touches.

**The finding.** `src/telemetry/client.ts` sets `person_profiles: 'identified_only'` and deliberately never calls `posthog.identify()` — its doc comment says so explicitly, and `src/telemetry/README.md:87-88` repeats the claim. So every event rides PostHog's own device-scoped anonymous `distinct_id`, and no person profile is ever created. Separately, the app already generates and persists a **stable anonymous ID** in the profile store (`docs/v2-build-plan.md`, "Backend-ready seams" #1) which is **never attached to any event**.

**Why it matters now.** `docs/roadmap.md`'s v3.0 phase requires "growth dashboards prebuilt in PostHog (day-2 return, session length, puzzles/session)," and names day-2 return as "the honest signal" gating v3 → v4. A cookie/localStorage-scoped device ID does not reliably survive a site-data clear, and does not necessarily bridge the installed-PWA vs. browser-tab boundary — the two places this app's own users actually live. **Retention data cannot be backfilled.** Every week collected on the current wiring is a week that can't answer the v3 gate question, which is the entire reason telemetry was just turned on.

**Verify before building.** Do not take the paragraph above as settled PostHog behavior. First establish, against the live project, what PostHog will actually compute for retention given `identified_only` + anonymous-only events. If it turns out day-2 return is already computable as-is, **say so and stop** — that is a valid outcome and a finding worth recording. The rest of this item is conditional on it not being.

**Decisions the lead must make in writing:**

- **Mechanism.** `posthog.identify()` with the stable anon ID as `distinct_id`, versus attaching it as a registered super property on every event, versus something narrower. `identify()` creates person profiles, which PostHog **prices differently from anonymous events** — check the current plan's billing implication before choosing, and record the number. This is the same discipline the Phase 4 cost finding earned the hard way.
- **The doc-comment and README claims.** `client.ts`'s comment block and `README.md`'s "we never call `posthog.identify()`" are load-bearing documentation of a deliberate decision. If the decision changes, both change **in the same commit** — 5b's decision 5 precedent: never leave a stale locked-decision claim in source.
- **The import collision — this one is genuinely subtle and Item 1 creates it.** Backend-ready seam #1 says the stable anon ID is carried by export/import. Item 1 of this very phase ships the import UI. So a user who imports someone else's export blob inherits that person's anonymous ID, and from PostHog's side two humans silently become one. Rare at friend scale, but this is exactly the shape of thing that quietly corrupts the retention number you're about to make a v4 decision on. Decide explicitly: regenerate the anon ID on import, preserve it, or prompt. Record the reasoning either way. **Do not let this be discovered later** — the whole point of doing Item 6 alongside Item 1 is that they collide.

**Hard constraints — the locked schema stands.** Do **not** enable pageview capture, autocapture, session recording, surveys, dead-click detection, or web-vitals. `client.ts`'s comment block explains why each is off, and `disable_external_dependency_loading` exists as a blanket guard. This item changes _identity_, not _what is collected_. If retention genuinely requires a new event, that is a schema change with its own privacy-notice implication — name it and hand it to v3.0 rather than sneaking it in here.

**Privacy notice.** Whatever ships, `/legal` must describe it accurately in Item 5's single edit. The honest framing is available and short: the ID is app-generated, contains no personal information, and exists to count returning visits without knowing who anyone is.

**Verification.** Deploy, then confirm in PostHog that a returning visit on the same device resolves to the same identity across a browser tab and the installed PWA. A code-verified identity claim is worth nothing here — this exact class of "green locally, wrong in production" failure has now bitten this repo three times (Phase 1b Finding 4, 5c's fragment bug, and telemetry itself never firing since launch).

---

## Explicitly out of scope

Do not touch, even if you see the opportunity: OD-1 (swipe reliability) and OD-4 (containment leak) — both owned by Phase 8, and OD-4's fix requires a full-pool sweep first, per its own row. Phase 6b (boss challenges), Phase 6c (missions, tooltips, click-meaningfulness), todo item 17 (tiered answers). Any content generation or authoring. Any backend, any dependency addition.

---

## Definition of done

Build-plan Phase 7's DoD in full, plus this phase's additions:

- [ ] Export → wipe site data → import → identical rating/history, verified **on production in a real browser** (build-plan DoD)
- [ ] Lighthouse performance ≥90 on production, accessibility ≥94 (no regression), SEO ≥90 — numbers and run conditions recorded as an amendment (build-plan DoD)
- [ ] Bundle report checked: no interaction-type code loads on routes that don't use it (build-plan DoD)
- [ ] A failed import leaves existing data byte-identical — asserted in a test, not by inspection
- [ ] `/settings` passes every `routes.test.ts` drift guard; cold load verified on production in a fresh incognito window
- [ ] Returning-PWA-user update cost measured against a real deploy and recorded (closes v3.0 scaling-gate item 1 early)
- [ ] Phase 0 DoD line 125 (rating-reset procedure) ticked, with the durable location named
- [ ] `/trace` untimed; no stale timed-mode claim survives anywhere in source or comments; timed path still tested
- [ ] `/legal` refreshed and dated **once**, covering Item 6's outcome; v3.0 legal-review item present in `docs/roadmap.md`
- [ ] todo.md items 9–17 all carry a disposition in the build plan's traceability table
- [ ] Retention identity resolved: either day-2 return is demonstrably computable on the current wiring (recorded as a finding), or the stable anon ID is attached — with the mechanism, the PostHog person-profile billing implication, and the import-collision behavior all recorded
- [ ] `client.ts`'s doc comment and `telemetry/README.md`'s identity claims match what ships, in the same commit that changes it
- [ ] Same-identity-across-tab-and-PWA confirmed **in PostHog against a real deploy**, not by inspection
- [ ] No new telemetry collection: pageview/autocapture/recording/surveys/dead-clicks/web-vitals all still disabled
- [ ] Amendment appended to `docs/v2-build-plan.md`'s Phase 7 section — written by the lead, not delegated — covering: the confirm-dialog contract, the skeleton/optimistic-rendering scope-down and its reasoning, the Trace-timer reversal, the retention-identity decision and its import collision, and the measured performance numbers
- [ ] `pnpm validate` green; zero new dependencies; one PR: `v2-phase-7` → `main`
