# Codoro v4 — build plan (feel & control: the polish version)

v4 is the version that makes Codoro stop feeling like a prototype. It builds nothing new to play — it makes what already exists **controllable** (keyboard, desktop, settings), **trustworthy** (report a bad puzzle, filter by difficulty), and **finished** (affordances, the mobile defects, the QA pass v3 never ran). Its whole scope is `docs/todo.md`'s open items; anything not traceable to one of them is out.

**Inserted 2026-08-27 (direct user decision).** This version did not exist a day ago. The accounts plan written on 2026-08-26 was v4; it is now **v5** (`docs/v5-build-plan.md`, unchanged in substance), gamification/launch is **v6**, multiplayer is **v7**. The reasoning, recorded rather than implied:

1. **Nothing here needs a backend.** Every item is client-only and ships to production the day it merges. v5 is 10–14 sessions of infrastructure during which nothing a player can see improves; putting a shippable polish version in front of it means the app gets better continuously instead of in one distant step.
2. **v5 would otherwise build on surfaces this version rebuilds.** v5's 5.1 adds an account section to Settings — but Settings today is an export/import page reachable only from a footer link, and todo item 22 asks for a real one. v5's 5.3 carries "optimistic rendering" (todo item 11) for leaderboard display. Doing accounts first means building both twice.
3. **The launch is behind v6 anyway.** The 2026-08-26 resequence already bought the time this version spends. It does not delay the launch; it improves what the launch eventually shows.

**Entry gate: open.** Same gate v5 inherited from the 2026-08-26 decision — `perf/content-metadata-lazy-load` merged and v3 build-complete — with nothing added. This version is a prerequisite for v5, not the reverse.

## Locked decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Scope boundary | **`docs/todo.md`'s open items and nothing else.** Every phase below traces to a numbered item (table at bottom); every open item traces to a phase or to a written "not here, and here's where" | This version's job is closing a list, not opening a design space. The moment it grows a feature nobody wrote down, it stops being the cheap version that goes in front of accounts. |
| Skeletons / caching / optimistic rendering (todo 9, 10, 11) | **Not built here.** Deferred to v5, where a network first exists | `src/app/RouteSkeleton.tsx`'s own doc comment already settled this in v2: Codoro is local-first — puzzles ship in the bundle, profile/attempt reads resolve off IndexedDB in single-digit milliseconds. A skeleton over a synchronous read makes the app feel *slower*; there is no network response to cache and nothing to render optimistically. The one genuine loading boundary (the lazy route chunk) already has its skeleton. These three items become real work the day sync and leaderboards exist — v5's 5.2/5.3 — and the v5 plan already claims item 11. Building them now would mean inventing fake latency to decorate. |
| Difficulty filter (todo 17) | **Browse only, never the rated flow** | `difficulty_rating` is already in the lazy metadata index (`src/content/index.ts`), so the filter itself is cheap — but Practice's rated selection uses an Elo rating window. Letting a player pin "easy" either breaks rating convergence (farm easy, rating means nothing) or does nothing (the window already bounds difficulty). In Browse, where the player is exploring content rather than being rated, the filter has a real job. Thomas's own instinct on this item was "not sure if that is a great one" — this is the version of it that is. |
| Daily's interaction mix (todo 21) | **Rebuild the calendar around scrubber / drag-order / tap-line; drop mcq and swipe-binary** — and treat the content shortfall as part of the item, not a surprise | Measured, not assumed: of 214 puzzles, 45 are rated ≥1600 (Daily's floor) — and only 22 of those are scrubber (13), tap-line (6) or drag-order (3). Today's 16-entry `DAILY_CALENDAR` is **100% mcq/swipe/tap-line with zero scrubber entries**. So this is not a filter change; it is a curation pass plus a content ask. The one piece of luck: `DAILY_EPOCH` is still the `2026-01-01` placeholder, so the append-only contract is not yet binding and the calendar can be rebuilt freely. **That stops being true at launch — this is the last cheap moment to do it.** |
| Report button (todo 18) | **Not in v4 — moved to v5** (endpoint in 5.0, client control in 5.1), decided 2026-08-27 | The backend-free version was a `mailto:` hack; once Workers and D1 exist the real thing costs about an hour, and it is live *at* launch — the highest-signal content-feedback window this project will ever get. Deferring it also keeps 4.2 to a single, clean item. One design note carried to v5: reports must work signed-out (guest-first is law, and most reporters won't have accounts), which makes it the one write endpoint accepting anonymous input, and therefore an abuse surface v5's rate limiting and 5.6's hardening must both cover. |
| Desktop rails vs. page scroll (todo 26) | **Sticky sidebar, one page scroll container.** `.app-shell__sidebar` gets `position: sticky` so it pins the way `NavRail` already does. The independent-scroll restructure — viewport-height shell, middle column its own `overflow-y: auto` — was **considered and rejected for v4** | The provable defect is the right rail: it is `self-start` with no sticky, so it scrolls away with the middle column. That's a ~10-line fix. The full three-region restructure is what `PageShell.tsx` deliberately avoided, and it would drag in `useRouteFocusAndScroll` (scrolls the page today, would have to scroll a container), the footer's placement, and re-verification of the perf pass's CLS fixes — destabilizing the shell immediately before v5 has to build an account surface on it. If the app-like shell is still wanted, it belongs in v6, where the desktop experience gets rethought anyway. |
| Preference storage | **Every new preference goes into the versioned export format** (schema version bump), not a loose `localStorage` key | The export format is v5's sync payload — the seam v2 built deliberately. A preference stored outside it silently fails to sync the moment accounts land, and that bug surfaces as "my settings didn't follow me to my phone" months later. One serialization, one migration path, same as every other stored field. |
| Bundle discipline | Carried from v5's table, unchanged: nothing this version adds lands on the play loop's critical chunks | PR #80 + the metadata/body lazy-load split are the baseline. A tooltip library or a settings surface on the boot path would regress a pass that was expensive to earn. Prefer no new runtime dependency at all here. |
| Sizing | Phases sized in **Claude sessions**, same convention as v2/v3/v5 | Unchanged. |
| Practices | Every binding practice carried from v3 applies unchanged | This version touches no PII, so v5's new PII practice does not yet bind. |

## Phase map

| Phase | What | Est. sessions |
| --- | --- | --- |
| 4.0 | Desktop & keyboard control: submit/advance on Enter, arrow-key interaction, the desktop rails (sticky sidebar), Practice scroll | 1–2 |
| 4.1 | Settings, for real: a first-class route with actual preferences, export/import folded in, versioned storage | 1–2 |
| 4.2 | Browse difficulty filter (deliberately *not* the rated flow) | 1 |
| 4.3 | Daily, made hard: calendar rebuilt around scrubber/drag-order/tap-line — **gated on a content batch**, so it runs last | 1–2 + content |
| 4.4 | Affordances: drag-handle target and hint, tooltips where a control isn't self-evident | 1 |
| 4.5 | The verification tail: v3's 2b.8 QA pass, the mobile defects, Thomas's device backlog | 1–2 |

**Sequencing.** 4.0 first — it is the largest behavioral change and the one most likely to shake loose regressions in the interaction components everything else sits on. 4.1 next, because it establishes the preference-storage seam 4.2's filter default and 4.4's hint-dismissal both write into. 4.2 and 4.4 are independent after 4.1 and can interleave. **4.3 runs last, and its content batch is commissioned on day one of 4.0** — the decision to gate it on real content (rather than ship a short calendar) makes content authoring the long pole of this whole version, so the authoring must run in parallel with every other phase or 4.3 becomes a stall at the end. 4.5 closes the version and is only meaningful against the finished build.

**The one scheduling risk in this plan, named up front:** content authoring is the slowest activity in this project, and 4.3 is now gated on it by choice. If the batch isn't moving by the time 4.4 is done, the honest options are to ship the short calendar after all (append later — the append-only contract permits growth) or to let v4 close without 4.3 and carry it. Deciding that at the end, under pressure, is how a version slips quietly; deciding it in writing here is why it's written here.

## Phase 4.0 — Desktop & keyboard control (1–2 sessions)

Codoro is a keyboard-less mobile game running on desktop. This phase is the largest single jump in how the app feels to the audience most likely to try it from a link — and the one that plays worst in a screen recording today.

**Build:**

1. **Enter to submit, Enter to advance** (todo 23). One binding, two states: with an answer staged, Enter commits it; on the result state, Enter advances to the next puzzle. Applies across every interaction type (mcq, swipe-binary, tap-line, drag-order, scrubber) through the shared commit path, not per-component. Must not fire while focus is in a text input or a dialog.
2. **Arrow-key interaction** (todo 24). Per interaction type, the obvious mapping: mcq = ↑/↓ (or 1–4) to select; swipe-binary = ←/→ to answer; tap-line = ↑/↓ to move the line cursor; drag-order = ↑/↓ to move the focused item (`DragOrder.tsx` already has key handling — extend, don't replace); scrubber = ←/→ to step, already partially present in `Scrubber.tsx`. Every mapping discoverable, not secret: see 4.4's tooltips and a keyboard-shortcut list in Settings (4.1).
3. **Desktop rails must not scroll with the middle column** (todo 26, clarified 2026-08-27 to cover the right rail too). Two halves, and only one of them is a confirmed defect:
   - **Right sidebar — confirmed defect, fix it.** `.app-shell__sidebar` is `align-items: start` + `self-start` with no `position: sticky` (see `app.css` and `PracticePage.tsx`'s `<aside>`), so it scrolls out of view with the middle column. Give it `position: sticky; top: 0`, a `max-height` of the viewport, and its own `overflow-y: auto` for the case where sidebar content is taller than the screen. Both consumers (`PracticePage`, `DailyPage`) share the class, so this is one change, not two.
   - **NavRail — verify before touching.** It is already `sticky top-0 h-screen`, which should hold it; the usual way that silently breaks is an ancestor with `overflow` or `transform`. Reproduce at ≥1024px with a screenshot first. If it holds, close this half as not-reproducible **in writing** and do not "fix" it.
   - **Out of scope, recorded:** the full three-region restructure (viewport-height shell, middle column its own scroll container). Locked decision above says why, and where it goes if it's still wanted.
4. **Practice page scroll** (todo 25). Reproduce and fix the reported scrolling-down defect on `/practice`. Likely candidates given the shell: `PageShell`'s pinned header/sticky-action interaction with the page scroll container, or the bottom-nav height offset in `AppShell.tsx`. Capture the failing case in a test, not just a fix.

**DoD:**

- [ ] Every interaction type is fully playable with keyboard only, verified per type; Enter never fires inside inputs or dialogs (tested)
- [ ] Keyboard mappings documented in one place and surfaced in Settings
- [ ] Practice-page scroll defect has a failing-then-passing test, not just a visual fix
- [ ] Right sidebar stays pinned while the middle column scrolls, at ≥1024px, on both `/practice` and `/daily`, with a before/after screenshot; a sidebar taller than the viewport scrolls internally rather than clipping
- [ ] NavRail either fixed with a before/after screenshot, or closed as not-reproducible **in writing**
- [ ] Page still has exactly one scroll container — the restructure stayed out (grep: no new `overflow: hidden` on `.app-shell`)
- [ ] No regression to touch/pointer paths — the OD-6 swipe suite and the drag/scrubber suites stay green
- [ ] `pnpm validate` green

## Phase 4.1 — Settings, for real (1–2 sessions)

Settings today is an export/import page reachable only from a footer link (`src/app/settings/SettingsPage.tsx` says so in its own header comment). Todo item 22 asks for a settings page; v5's 5.1 then bolts an account section onto whatever exists. This phase builds the thing both are pointing at.

**Build:**

1. **A first-class route**: `/settings` reachable from the nav (rail on desktop, an obvious path on mobile — settle placement against the 2b shell rather than inventing a new pattern), not only from a footer link.
2. **Real preferences**, sectioned. Candidate set — settle the exact list in the build prompt, and justify each one that costs a stored field: timer visibility (todo 14's "no timer on regular trace mode" is already shipped; make it a preference rather than a hardcode if that's cheap), reduced motion / animation intensity, sound if any exists, code font size, keyboard-shortcut reference (4.0's output), theme if more than one exists. **A preference nobody will change is a maintenance cost, not a feature** — a short honest list beats a long aspirational one.
3. **Storage through the versioned export format**: schema version bump, migration written and tested with the existing `MIGRATIONS` convention, preferences travel in export/import. This is the locked decision above; it is what makes v5's sync pick these up for free.
4. **Export/import folded in** as a section of the new page, behavior and tests unchanged — the confirm-overwrite contract and the four named bad-input states carry over intact. This is a re-home, not a rewrite.
5. **Leave the account-shaped hole**: no auth UI, no placeholder "Sign in" button. v5's 5.1 adds its section; this phase just makes sure the page has a natural place for it.

**DoD:**

- [ ] `/settings` reachable from primary nav at both breakpoints; old footer link still resolves
- [ ] Every preference round-trips through export → import (test), and the schema migration has an isolated test
- [ ] Existing `SettingsPage.test.tsx` assertions on export/import all still pass, unmodified where possible
- [ ] Each shipped preference is justified in one line in the phase amendment; the ones considered and dropped are named too
- [ ] `pnpm validate` green

## Phase 4.2 — Browse difficulty filter (1 session)

**Build:**

1. **Browse difficulty filter** (todo 17): easy / medium / hard chips on the Browse surface, alongside the existing patterns/mastery filter row (#77's compact row — extend it, don't add a second row). Bands derived from `difficulty_rating` with the cut points **recorded as named constants with reasoning**, not magic numbers; reads from the lazy metadata index only, so no puzzle body loads. **Not added to the rated Practice flow** — locked decision above; write the reason into the code comment so the next session doesn't "helpfully" add it.
2. Empty-state handling: a band × pattern × mastery combination that matches nothing must say so, not render a blank list.

**DoD:**

- [ ] Filter narrows Browse correctly at every band incl. combinations with the existing pattern/mastery filters (tested); band cut points documented
- [ ] Zero puzzle bodies loaded by filtering — verified against the metadata/body split, not assumed
- [ ] Empty combination renders a named empty state (tested)
- [ ] Rated Practice selection provably unchanged (its existing selection tests untouched and green)

## Phase 4.3 — Daily, made hard (1–2 sessions + a content batch)

The item behind this phase is "no swipe or mcq for daily, make daily better." **No mcq and no swipe-binary in the Daily pool is firm** (re-confirmed 2026-08-27). The measurement that makes this a phase rather than a line change: dropping those two takes Daily's eligible ≥1600 pool from 45 puzzles to 22 — scrubber 13, tap-line 6, drag-order 3 — and today's 16-entry `DAILY_CALENDAR` is **100% mcq/swipe/tap-line with zero scrubber entries**.

**Gated on content, by decision (2026-08-27).** The alternative — ship a 22-entry calendar now and append as content lands — was considered and rejected in favour of rebuilding the calendar once, at full length, from real content. That makes authoring this phase's blocking prerequisite, and content authoring is the slowest activity in the project. **Commission the batch on day one of 4.0, not at the start of this phase.** The lowered rating floor was also considered and rejected: leaving the ≥1600 floor alone keeps Daily's difficulty story consistent with the calibration the whole pool was rated against.

**Build:**

0. **Content prerequisite (starts first, finishes last):** author hard scrubber and drag-order puzzles until the eligible ≥1600 non-mcq/non-swipe pool supports a full calendar without duplicates. Target length is an open question below; the gap today is 22 against roughly 40. This runs through `GENERATING_PUZZLES.md` and the normal calibration path — no shortcuts that would put uncalibrated puzzles in the hardest surface the app has.
1. **Rebuild `DAILY_CALENDAR`** from scrubber / drag-order / tap-line puzzles only, hardest-first-biased, no duplicates. Legal right now precisely because `DAILY_EPOCH` is still the `2026-01-01` placeholder — `dailyCalendar.ts`'s own pre-launch note authorizes this, and the day the real epoch is frozen it becomes forbidden. Update the test pin accordingly.
2. **Enforce the rule in code, not in a comment**: `validate:content` (or `dailyCalendar.test.ts`) fails the build if any calendar entry is mcq or swipe-binary. A convention that only lives in a doc comment gets violated by the next content batch — and this one is a locked decision, not a preference.
3. **"Make daily better" beyond the interaction mix** is explicitly *out of scope here* and belongs to v6's game-feel definition session — the session shape, the stakes, the payoff of a Daily are exactly what that session exists to define. This phase changes what Daily asks you to do; v6 changes what Daily *is*.

**DoD:**

- [ ] Every calendar entry is scrubber / drag-order / tap-line; **enforced by a failing build**, not a comment (tested with a deliberately-bad fixture)
- [ ] Calendar reaches the agreed target length with no duplicate ids and every id resolving (existing `validate:content` gates hold)
- [ ] Every newly authored puzzle went through the normal calibration path; none added to the calendar uncalibrated
- [ ] The pre-launch editing window is called out in the amendment with the exact condition that closes it (`DAILY_EPOCH` frozen)

## Phase 4.4 — Affordances (1 session)

**Build:**

1. **Drag-handle target + hint** (todo 20): larger hit target on `DragOrder`'s handles (the 2b.6 affordance work is the precedent — check what actually landed on `main` before re-doing it), plus a first-use hint that says the row is draggable. Hint dismissal persists through 4.1's preference storage, so it does not nag.
2. **Tooltips** (todo 12): there is no tooltip anywhere in the codebase today. Add them **only where a control is not self-evident** — icon-only buttons, the new difficulty bands, keyboard shortcuts on hover. Build the minimum yourself rather than adding a runtime dependency (bundle-discipline decision); must work on touch (long-press or tap-to-reveal) and be reachable by keyboard, or it is an accessibility regression rather than a polish win.
3. Audit pass: any icon-only control with no accessible name is a defect this phase closes on the way past.

**DoD:**

- [ ] Drag handles meet the touch-target minimum at mobile widths (measured); hint appears once and stays dismissed across reloads
- [ ] Tooltips keyboard-reachable and touch-usable (tested), and add no new runtime dependency
- [ ] Every icon-only control has an accessible name (grep/axe-style check, not eyeballed)
- [ ] Bundle diff shows no growth on play-path chunks

## Phase 4.5 — The verification tail (1–2 sessions)

This phase absorbs work v3 left open. It sits here rather than in v5 because it is the same class of work as the rest of this version, and because it is the honest place to notice the mobile defects that todo item 19 names.

**Build:**

1. **v3's 2b.8 QA pass**, carried verbatim: batched screenshot review of every route at mobile and desktop widths, plus a Lighthouse re-check; absorbs the visual-verification boxes 2b.0/2b.1/2b.3/2b.4 left open because those sessions ran headless.
2. **Mobile defects** (todo 19): the Lighthouse and swipe items, re-checked against the current build. The swipe half may already be closed by OD-6 and the August hardening wave — **verify before fixing**; a re-fix of a fixed bug is how regressions get introduced.
3. **Thomas's device-verification backlog**, unchanged and still his: two-phone interaction regression (incl. boss/missions), PWA install/offline/SW-update, live telemetry check, week-long storage soak, cross-device Daily, boss/missions playthroughs. This runs on real hardware and cannot be done from a session.
4. **Regression sweep over 4.0–4.4**: the keyboard work touched every interaction component; the QA pass is where that gets checked at both breakpoints, not asserted.

**DoD:**

- [ ] Every route reviewed at both breakpoints with screenshots attached to the amendment
- [ ] Lighthouse re-checked against the `perf/content-metadata-lazy-load` baseline; any regression from 4.0–4.4 named and fixed or written-waived
- [ ] Todo item 19's two halves each closed as fixed, already-fixed, or not-reproducible — in writing
- [ ] Device backlog either run or explicitly carried into v5 with a date

## Open questions (settle in build prompts, not here)

- Exact keyboard mappings per interaction type, and where the shortcut reference lives (4.0)
- The final preference list, and which ones are worth a stored field (4.1)
- Difficulty band cut points, and whether "easy/medium/hard" or the rating numbers are shown (4.2)
- **Daily's target calendar length** — and therefore the size of the content batch 4.3 is gated on (4.3). This is the number that decides how long v4 runs; settle it before commissioning the batch, not after
- Tooltip touch interaction: long-press vs tap-to-reveal (4.4)

## Traceability — every open `docs/todo.md` item

| # | Item | Disposition |
| --- | --- | --- |
| 9 | Skeleton loaders | **Not built** — the one real loading boundary already has one; the rest would be fake latency (locked decision). Revisit in v5 |
| 10 | Caching | **v5** — nothing to cache until there is a network |
| 11 | Optimistic rendering | **v5 (5.3)** — already claimed by the v5 plan's traceability table |
| 12 | Tooltips | **4.4** |
| 14 | No timer on regular trace mode | **Done** (v3). 4.1 may make it a preference if cheap |
| 15 | Privacy policy | **v5 (5.6)** — the lawyer review is engaged there, covering accounts + email + sync at once |
| 16 | Terms of service | **v5 (5.6)**, same review |
| 17 | Tiered answers easy/medium/hard | **4.2**, scoped to Browse only (locked decision) |
| 18 | Report question button | **v5** — endpoint in 5.0, client control in 5.1. Moved out of v4 on 2026-08-27: the real thing is an hour once Workers exist, and it's live at launch |
| 19 | Mobile errors (Lighthouse, swipe) | **4.5**, verify-before-fix |
| 20 | Drag-and-drop handle bigger / hint | **4.4** |
| 21 | No swipe or mcq for Daily; make Daily better | **4.3** for the interaction mix + calendar rebuild (firm; gated on a content batch); **v6** for what a Daily *is* (game-feel definition session) |
| 22 | Settings page | **4.1** |
| 23 | Press Enter to submit and go next | **4.0** |
| 24 | Use arrows/keys on computer | **4.0** |
| 25 | Practice tab scrolling down | **4.0** |
| 26 | Desktop nav bar not floating | **4.0** — right sidebar sticky (confirmed defect); NavRail repro-required-before-fix; full shell restructure out of scope |

Items 1–8 and 13 are already dispositioned in `docs/todo.md`'s original 2026-08-02 fold-in (all landed in v2/v3, or carried to v6); 13 was never written.
