# Codoro UI Redesign — Audit, Design System & Plan

2026-09-17 · @Someone

## Goals & non-negotiables

"Not vibe coded" means one deliberate system shows up on every screen instead of each page inventing its own nav, badge, and icon treatment. Codoro's infrastructure for that already exists — this pass is about applying it consistently, not building it from scratch.

Stays fixed:

- Dark theme default, lime accent `#c6f83c`, Space Grotesk (UI) + JetBrains Mono (code) — locked 2026-08-12, still the right call.
- The token system in `src/index.css`: a 10-step spacing scale, 6-step radius scale, and four complete theme palettes already wired (Default, Blue, Slate, Light) and exposed in Settings' theme picker.
- Tailwind (2b.0 migration already shipped, confirmed from `tokens.css`'s own comments).

In scope for this pass:

- Every route redesigned as a mockup, mobile-first (mobile is the actual complaint; desktop already reads fine).
- A custom icon set replacing the current mixed-source icons.
- A real motion/animation system, not one-off keyframes per component.
- Mobile treated as a first-class target — `.app-shell` currently has zero layout rules below `min-width: 1024px`, which is the root cause of most of what reads as unfinished below.

## Systemic audit findings

From a Playwright screenshot crawl (mobile 390×844 + desktop 1440×900) of all 13 routes, reviewed directly. Six patterns repeat across most or all screens — these are the actual redesign inputs, not per-page notes:

1. **Duplicate secondary nav on every page.** The icon bottom bar (Home/Practice/Daily/Compete/Stats) and a separate plain-text link row ("Settings Legal Feedback") both appear, stacked, on every screen. Two visual languages doing one job.
2. **Icon set doesn't match itself.** Home/Practice/Daily/Stats nav icons are thin outline glyphs; Compete's crossed-swords icon is bold/filled, reads like it's from a different source.
3. **Four unrelated progress/lives indicators for one mechanic.** Rush: a draining bar + three empty circles. Boss: a segmented dot row + a red-gradient bar + a "Glitch" avatar card. Missions: a small pill-dot stepper. Daily: none shown. No shared component.
4. **Dead vertical space on short-content screens.** Rush, Trace's start screen, and both Compete states (menu + challenge card) have content in the top third of the viewport with nothing below. Same root cause the 2026-08-24 Lighthouse audit found on `/practice`'s footer (`.app-shell` has no layout rules that pin content) — now confirmed on more routes.
5. **Badge/pill shapes don't share a system.** Practice's header alone has four shapes (rounded-rect, circle, text+check, circle) for the same "stat badge" concept.
6. **Two redundant empty-states stack on Stats** ("You haven't solved any puzzles yet…" banner at top, "Start your streak today" at bottom) — same message, two treatments.

Separately, `DuckMark` (the small wordmark icon) appears consistently, but `DuckMascot` (the five-pose expressive character already built in `Mascot.tsx`) doesn't appear anywhere in the current screens — not in empty states, not in Compete's challenge card. Boss already has its own mascot ("Glitch") occupying that role there. See Open decisions.

## Custom icon system

Current icons come from `Icons.tsx` (a mixed stroke-icon set, `currentColor` convention) plus at least one outlier — Compete's crossed-swords — that doesn't match the rest's weight. The fix isn't swapping one icon; it's replacing the whole nav + in-page set with one deliberately-drawn family so it reads as designed, the same way `Mascot.tsx`'s doc comments show real care going into the duck (anatomy notes on brow direction, pose consistency at 16– 96px).

Inventory to replace:

| Icon                                                  | Where used                             | Current source                                      |
| ----------------------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| Home                                                  | Bottom nav                             | `Icons.tsx` outline                                 |
| Practice                                              | Bottom nav                             | `Icons.tsx` outline                                 |
| Daily                                                 | Bottom nav                             | `Icons.tsx` outline                                 |
| Compete                                               | Bottom nav                             | Bold/filled crossed-swords — the confirmed mismatch |
| Stats                                                 | Bottom nav                             | `Icons.tsx` outline                                 |
| Rush, Boss, Trace, Missions, Browse                   | Mode entry points (Home / nav)         | `Icons.tsx` outline, not yet audited individually   |
| Settings (gear)                                       | Top-right, every page                  | `Icons.tsx` outline                                 |
| Rating/trophy, streak/fire, solved-count/check, sound | Practice header stat badges            | Mixed shapes, see audit #5                          |
| Copy-link, share                                      | `ShareMenu.tsx`, `ChallengeButton.tsx` | `Icons.tsx`                                         |

Direction brief: one stroke weight and one corner-radius language across the whole set, sized against `--radius-xs`–`--radius-md` so icons and card corners feel like the same hand. Worth deciding whether the icon family should read as a sibling to the duck's illustrated style (filled, a little playful) or stay a separate, more neutral UI-icon language that the duck sits on top of — flagged in Open decisions, since it changes how these get produced (hand-drawn SVG vs. a restyled existing icon set).

## Animation & motion principles

Motion exists today but as isolated, one-off pieces: `feedback-panel`'s slide-in keyframe (`tokens.css`), `ComboSurge.tsx`'s streak micro-feedback, `framer-motion` already a dependency but not used as a system. `tokens.css`'s own history is a warning here — `.token.*` rules were copy-pasted into `practice.css` and `scrubber.css` independently and silently drifted (wrong colors, a missing rule) until consolidated into one file. Animation risks the same drift if each component keeps inventing its own timing.

Direction: define motion as tokens, not per-component values — a small set of durations and easings (e.g. a fast \~120–180ms for taps/presses, a slower \~250–350ms for entrances, matching `feedback-panel`'s existing 0.18s as the baseline) and a handful of named interaction patterns reused everywhere:

- **Press/tap feedback** on every button and card — currently inconsistent, some elements have it (`active:scale-[0.98]` shows up in `LevelPicker.tsx`) and most don't.
- **Card/panel entrance** — one pattern, not a new one per route.
- **Success/fail moments** — currently a plain correct/incorrect-and-move-on per the 2026-09-03 first-run notes; this is where `DuckMascot`'s poses earn their keep.
- **Page/route transitions** — none today; worth deciding if this pass adds them or leaves routing instant (a real cost/benefit call, not free).

All of it through `framer-motion` (already installed) rather than new ad hoc CSS keyframes, so it stays in one place to audit later.

## New or updated components needed

Five fixes cover most of the audit — built once each, not per-page:

- **`SecondaryNav`** — merges the icon bottom bar and the plain-text link row into one component. Kills audit finding #1 everywhere in one change.
- **`StatBadge`** — one shape, sized/color variants, replacing Practice header's four different pill treatments.
- **`ProgressIndicator`** — one component for the "how am I doing / how many left" mechanic, reused by Rush, Boss, Missions, and added to Daily. Needs a shared prop shape across modes that currently don't share one (lives vs. stages vs. time).
- **Layout-shell fix** — a real viewport-height column rule so content doesn't float in the top third with dead space below. Scope this narrowly: it's about vertical centering/anchoring on short-content screens, not the full independent-scroll shell that was already evaluated and explicitly rejected for v4 (desktop rails, `PageShell.tsx` restructure) — don't reopen that decision by accident.
- **Icon set** — see above.

Open: the Glitch-vs-duck mascot question. `DuckMascot` has five built poses and isn't used anywhere yet; Boss's "Glitch" avatar already occupies the reaction-character role there. Resolve whether Glitch stays as Boss's own antagonist while the duck is the app-wide host elsewhere, or whether one absorbs the other, before mockups add duck moments to empty/success/fail states — see Open decisions.

## Per-page mockup plan

Priority follows traffic and how much of the audit each page carries — fixing the shared components on the highest-traffic pages first proves the system before rolling it out everywhere.

| Route                              | What's wrong today                                                                                                                                           | Priority    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Home (`/`)                         | Dual footer nav; first thing every visitor sees                                                                                                              | P0          |
| Practice                           | Dual footer nav; 4 mismatched badge shapes; chip row cut off with no scroll affordance                                                                       | P0          |
| Daily                              | Dual footer nav; no progress indicator at all                                                                                                                | P1          |
| Rush                               | Dual footer nav; dead space below the puzzle card; one of the four mismatched progress patterns                                                              | P1          |
| Boss                               | Dual footer nav; "Glitch" mascot conflict; its own progress pattern                                                                                          | P1          |
| Compete                            | Newest, rawest surface; dead space on both doors; Play Human path may be an unwired stub (`LevelPicker.tsx` comment) — confirm before mocking it as finished | P1          |
| Trace                              | Dual footer nav; large dead space on the start screen                                                                                                        | P2          |
| Missions                           | Dual footer nav; its own progress pattern                                                                                                                    | P2          |
| Browse                             | Dual footer nav; long flat list, no visual hierarchy between "not started" and "in progress" patterns                                                        | P2          |
| Stats                              | Dual footer nav; two redundant empty-state messages                                                                                                          | P2          |
| Settings                           | Dual footer nav; otherwise the most content-complete page in the set                                                                                         | P3          |
| Legal                              | Dual footer nav; static content, lowest risk                                                                                                                 | P3          |
| Challenge / Puzzle (`/puzzle/:id`) | Not yet screenshotted — need a real payload/id to capture                                                                                                    | Audit first |

The dual-footer-nav fix alone touches all 13 rows — it's one `SecondaryNav` build, not 13 separate fixes.

## Phased execution plan

"Complete" is the right end state, but committing to icons + motion + all 13 pages as one undivided effort — alongside a full-time job that started this month — is the way this stalls half-finished. Phasing it lets each phase ship as a real, visible win instead of one long project with nothing usable until it's entirely done.

1. **Foundation** — build `SecondaryNav`, `StatBadge`, `ProgressIndicator`, the layout-shell fix, and the motion tokens/patterns. Apply all five to Home and Practice only (P0). This is the phase that proves the system works before it's copy-pasted 11 more times.
2. **Icon set** — can run in parallel with phase 1 since it doesn't depend on component code. Production method is an open decision (see below) — pick it before starting, since hand-drawn SVG and AI-generated icons have very different timelines.
3. **Core-loop rollout** — Daily, Rush, Boss, Compete (P1) get the phase-1 components + new icons applied. Compete specifically needs the Play Human stub resolved first, or its mockup is designing around a placeholder.
4. **Remaining pages** — Trace, Missions, Browse, Stats (P2), then Settings, Legal (P3).
5. **Motion pass** — apply the interaction patterns from Animation & motion principles across whatever's landed by this point, once there's enough real UI to animate consistently rather than animating mockups that might still change.
6. **Device QA** — an on-device mobile pass was already owed from the swipe-gesture and iOS text-sizing fixes (`codoro-swipe-od6`, `codoro-code-rendering`) — fold this redesign's device check into that same pass rather than a third separate one.

Each phase is independently shippable — phase 1 alone already fixes the single most visible "vibe coded" tell (the dual nav) on the two highest-traffic pages.

## Open decisions

- [x] **Glitch vs. the duck.** Resolved 2026-09-18: `DuckMascot` is the single app-wide mascot. Glitch (Boss's bespoke `BOSS_NAME`/`BossCharacterIcon`) is retired — see the Status Update below.
- [ ] **Icon production method.** Hand-drawn SVG following `Mascot.tsx`'s construction approach (slower, most consistent with the duck), AI-generated against a written style brief (faster, needs a tight brief to stay consistent), or a licensed icon set restyled to the token system (fastest, least original). Picks the phase-2 timeline. The 2026-09-17 Recraft AI attempt was reverted (rendered filled shapes, not the intended stroke style) — still unresolved.
- [ ] **Icon family relationship to the duck.** Playful/illustrated sibling to the mascot, or a neutral UI-icon language the duck sits on top of.
- [x] **Does this fold into the already-locked v4 UI/polish phase** (`docs/v4-build-plan.md`, scope = `todo.md` items 9–26, gate open) or run as a separate effort alongside it? Resolved 2026-09-19: runs as its own track, alongside v4, not folded into it — see the Status Update below. (This ticks only this doc's own checkbox; no `docs/v4-build-plan.md` box was touched.)
- [x] **Page transitions.** Resolved 2026-09-19 (motion foundation pass): stay instant. This pass is "the eventual motion pass" the note above deferred to — routing stays untouched; motion is scoped to press/entrance patterns on existing surfaces, not route changes. See the Status Update below for the reasoning.
- [x] **Compete's Play Human path** — confirmed wired (not a stub) during the 2026-09-17 SecondaryNav/StatBadge/Compete pass; `Play Human` → `LevelPicker` → `useCompeteSession` → `ChallengeButton` is a real, working flow.
- [ ] **Target timeline** — no date attached yet; worth picking one per phase so "complete" has an actual finish line rather than running open-ended.
- [x] **Dead-space fix mechanism (audit #4).** Resolved 2026-09-18, confirmed still standing 2026-09-19: whole-viewport vertical centering (`CENTERED_PAGE_SHELL_CLASS`) was tried on Compete, Rush, and Trace, then reverted the same day — it redistributes dead space above the content instead of removing it, which reads as content "sitting lower," not fixed. All pages stay top-anchored; the class was removed from `PageShell.tsx` entirely (not just left unused). If a real fix is attempted again it needs a different mechanism (a capped top-offset, or extra bottom padding) — not whole-viewport centering. See `PageShell.tsx`'s own doc comment.

## Status update — 2026-09-18 (Phase 1: Foundation, completed)

Both remaining Phase 1 build items shipped and are committed. Read this before starting the next session so state doesn't have to be re-derived from git history.

**Shipped:**

- **`ProgressIndicator`** (`src/app/ProgressIndicator.tsx`) — the fourth and final Phase 1 shared component. One prop shape (`value`/`max`/`variant: 'dots' | 'bar'`/`tone: 'accent' | 'danger'`/optional `label`+`announceAs`) covers every mode: Rush's strikes (dots, danger tone) and per-puzzle timer (bar), Boss's health meter (bar, danger tone) and puzzle-position pips (dots, accent tone — now small dots like Missions' stage stepper, not a full-width segmented bar — a real visual simplification, flagged below), Missions' StageTracker mobile pill stepper (dots), and a new indicator on Daily (see judgment call below). `label` switches the indicator from decorative (`aria-hidden`) to accessible; `announceAs` picks `role="status"` (infrequent changes — lives, stage advances; matches Rush's/Boss's pre-existing "X of 3 strikes" contract exactly) vs `role="progressbar"` with real `aria-value*` (continuously-ticking values, avoiding `status`'s implicit live-region spam on Rush's per-second timer).
- **Boss's Glitch → DuckMascot.** `BOSS_NAME`, `BossCharacterIcon()`, and their CSS reactions (`bossPage.css`, now deleted — every rule in it targeted classnames this pass removed) are gone. `BossActivePlay.tsx` now shows `DuckMascot` reacting live: `debugging` while a puzzle is unanswered, `happy`/`sad` right after a correct/wrong answer, `idle` if no puzzle is loaded; `BossPage.tsx`'s existing end-of-run duck now shows `celebrating` (was `happy`) specifically when the boss is cleared. `DuckMascot` gained a `data-pose` attribute (no visual effect) purely so this is testable without depending on exact SVG paths.
- **Layout-shell centering, generalized.** CompetePage's 2026-09-17 vertical-centering fix is now `CENTERED_PAGE_SHELL_CLASS`, exported from `PageShell.tsx` (not a new component — none of the six page files render through `<PageShell>`, each keeps its own page-shell classname constant, so a shared string constant fit the existing convention better than a component migration). Applied to Rush (dead space below the puzzle card) and Trace (dead space on the start screen); Compete itself now imports the same constant instead of defining it locally.
- **Daily's new progress indicator** — Daily had none before. Added a 1-of-1 `ProgressIndicator` (hollow before the first attempt today, filled after) next to the day-number heading.

**Real design judgment calls made (flag for review):**

1. **Daily's "N of M"**: Daily is one puzzle a day, so there's no natural multi-step count. Chose a 1-of-1 "have you done today's puzzle" indicator over inventing a Daily-specific widget or skipping the requirement — smallest honest interpretation of "add one," not a literal port of another mode's pattern.
2. **Boss's puzzle-position pips**: were a full-width segmented bar (`flex-1` pips spanning the row); now small fixed-size dots (`ProgressIndicator`'s shared `dots` variant), visually matching Missions' stage stepper. Same information (10 discrete positions, done/current/upcoming), narrower on screen.
3. **Rush's per-puzzle timer accessible role**: kept as `role="progressbar"` with real `aria-value*` (via `announceAs="progressbar"`) rather than folding it into the same `role="status"` pattern used everywhere else, specifically to avoid `status`'s implicit polite-live-region behavior re-announcing every tick to screen readers on a value that changes every ~100ms.
4. **`data-pose` on `DuckMascot`**: a small, additive attribute (not requested explicitly) needed to make Boss's pose-swapping testable without brittle SVG-path assertions. No visual/behavioral change.
5. **Missions' StageTracker mobile dots**: simplified from a 3-state pill row with no distinct visual regression (still done/current/upcoming via `ProgressIndicator`'s accent-tone dots) — the richer per-stage icon+label+description breakdown on tap is untouched, only the collapsed row's rendering moved to the shared component.

**Verification:** `pnpm lint`, `pnpm test` (2766/2766), `pnpm typecheck` all pass. Single commit covers every file above.

**Still open, per the original audit (unchanged by this pass):**

- **Icon set** (Phase 2) — production method still undecided (hand-drawn vs AI-generated vs restyled licensed set); can run in parallel with future phases once picked.
- **Motion/animation system** — still one-off keyframes per component (`feedback-panel`, `ComboSurge`), not the token-based system the audit calls for. Explicitly out of scope for this pass (dropped the old `.boss-strikes__fill--hit`/`.boss-character__icon--hit/--struck` keyframes as dead code when Glitch was removed, added no new animation in their place).
- **Stats' two redundant empty states** (audit finding #6) — untouched, not in this pass's scope.
- **Remaining page rollout** — Phase 3 (Core-loop: Daily/Rush/Boss/Compete) now has the Phase 1 components applied for layout/progress, but still needs the new icon set once Phase 2 lands. Phase 4 (Trace/Missions/Browse/Stats, then Settings/Legal) hasn't started — Trace only got the layout-shell centering fix from this pass, nothing else. Browse, Stats, Settings, Legal, and Challenge/Puzzle are completely untouched by any redesign pass so far.
- **Page transitions** and the **v4-build-plan fold-in question** — still open, unchanged.

## Status update — 2026-09-19 (Phase 4: remaining pages, completed)

This pass covers everything the 2026-09-18 update above listed as still open for Phase 4 (Trace/Missions/Browse/Stats, Settings/Legal) plus the previously-unaudited Challenge/Puzzle routes, per this doc's own per-page plan. Filename fixed in the same pass — this file was misnamed `phase8-content-status.md` (a v1 content-status filename, not what it documents); the real content-status doc stays at `docs/phase8-content-status.md`, unrelated to this one.

**Shipped:**

- **Browse (`PatternPicker.tsx`) grouping** — the flat `PATTERN_SLUGS` list is now three sections: **In progress** (learning + weak, weakest accuracy first), **Not started** (new), **Mastered**, each hidden when empty. Ties within a section keep `PATTERN_SLUGS`' own order, for free, via `Array#sort`'s stability. "Practice all patterns" stays pinned above all sections; `singleColumn` and the 44px touch targets are untouched. Tests cover mixed data (grouping + weakest-first order), an empty section disappearing, and the all-new (first-time user) case.
- **Stats' duplicate empty state (audit #6)** — `StatsPage.tsx`'s Activity card no longer shows "Start your streak today" (or "🔥 N day streak") when `attempts.length === 0`; the card itself (heading + calendar grid) stays as a layout anchor. The top `emptyBanner` is now the only "you haven't solved anything yet" message. One existing test relied on the old dual-message state to exercise the zero-day-streak label swap — it now seeds one real attempt so it's testing the _lapsed-streak_ case (has history, `currentStreak: 0`), which is what that label swap is actually for; a new test covers the true zero-attempts case.
- **Challenge progress indicator (audit #3)** — `ChallengePage.tsx` showed "Puzzle N of M" as plain text, desktop-only (right rail); mobile had nothing, the same gap the audit already found on Daily. Replaced with one shared row — the text stays (still the clearest "N of M" at a glance) paired with a labelled `ProgressIndicator` (`dots`, `accent` tone, `announceAs="status"`) — rendered once, visible at both breakpoints instead of desktop-only. Since `CompetePage.tsx` renders the same `ChallengePageForSession`, Compete's Play Human/Computer races get this fix for free. `FirstRunSequence.tsx`'s own "Puzzle N of M" line got the same treatment (decorative dots this time, no separate `label` — matching Boss's already-shipped convention of "visible text is the accessible readout, dots are decorative") since no test asserts on its rendered text (`Home.test.tsx` mocks the component outright).
- **Doc rename** — `git mv docs/redesign/phase8-content-status.md docs/redesign/ui-redesign-audit-2026-09-17.md`; the two source comments that pointed at the old path (`BossActivePlay.tsx`, `ProgressIndicator.tsx`) now point at the new one.

**Findings table — Challenge & Puzzle (never screenshotted before this pass), scored against audit patterns #1–#6:**

| Screen                                              | #1 dual nav    | #2 icon mismatch   | #3 progress indicator                                   | #4 dead space                                                                                                         | #5 badge shapes | #6 dup empty state              | Other                                               |
| --------------------------------------------------- | -------------- | ------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------- | --------------------------------------------------- |
| `/challenge` intro (mobile+desktop)                 | Fixed globally | Deferred (Phase 2) | N/A (pre-accept, no puzzle yet)                         | Present, top third — same pattern as Compete's door menu; **accepted per the top-anchored decision**, not re-centered | N/A             | N/A                             | None                                                |
| `/challenge` mid-puzzle (mobile)                    | Fixed globally | Deferred           | **Was missing entirely — fixed this pass**              | N/A (puzzle fills the screen)                                                                                         | N/A             | N/A                             | None                                                |
| `/challenge` mid-puzzle (desktop)                   | Fixed globally | Deferred           | **Was plain text only — now paired with labelled dots** | N/A                                                                                                                   | N/A             | N/A                             | None                                                |
| `/challenge` comparison (mobile+desktop)            | Fixed globally | Deferred           | N/A (run is over)                                       | Present, top third — same accepted tradeoff as above                                                                  | N/A             | N/A                             | None                                                |
| `/challenge` broken link                            | Fixed globally | Deferred           | N/A                                                     | Present (short message + one CTA) — accepted                                                                          | N/A             | Only one message shown, not two | Legible message + "Go to Practice" CTA; no dead end |
| `/puzzle/:id` — tap-line, drag-order, mcq, scrubber | Fixed globally | Deferred           | N/A — one puzzle per link, no "N of M" concept to show  | Content fills the viewport on every sampled puzzle                                                                    | N/A             | N/A                             | None                                                |
| `/puzzle/:id` not-found                             | Fixed globally | Deferred           | N/A                                                     | Present (short message + one CTA) — accepted                                                                          | N/A             | Only one message shown          | Legible message + "Go to Practice" CTA; no dead end |

No outright breakage found on either route: nothing was cut off at 390×844, the primary action (Accept/answer/Check order) was reachable in every screenshot, and both terminal "nothing here" states (broken link, not-found) have exactly one message and a working way out. Everything logged as "present, accepted" above is the same top-anchored dead-space tradeoff already accepted for Compete/Rush/Trace on 2026-09-18 — not a new defect, and explicitly not re-centered per that decision.

**Verify-only results (no content changes):**

- **Settings** — single nav confirmed, otherwise unchanged from the audit's own note ("the most content-complete page in the set"). No action.
- **Legal** — single nav confirmed, static content unchanged. No action.
- **Trace** — single nav confirmed; the start screen's dead space is the same pattern already tried-and-reverted on 2026-09-18 (see the "Dead-space fix mechanism" open decision above) — logged as accepted, not re-centered.
- **Missions** — single nav confirmed; its own progress pattern was already replaced by `ProgressIndicator` dots in the 2026-09-18 pass (visible top-left on the stage-select screen). No action.
- **Practice's chip-row fade (P0 note)** — confirmed via a real browser query, not just eyeballing the screenshot: `.interaction-filter-scroll` has genuine horizontal overflow (67px hidden at 390px wide), and `.interaction-filter-scroll-wrap`'s trailing `::after` fade is a 28px gradient from transparent to `rgb(14, 15, 19)` — the exact computed `body`/`--surface-0` background color, confirmed via `getComputedStyle`. The fade is real and correctly colored to blend into the page background, not a leftover no-op. **Recorded as already-fixed**; no code change made.

**Real design judgment calls made (flag for review):**

1. **ChallengePage's progress row is labelled + `role="status"`, but FirstRunSequence's is decorative.** Challenge had zero accessible progress signal on mobile before this pass, so making its new indicator carry the real `aria-label` closes that gap directly. FirstRunSequence already had visible "Puzzle N of M" text before this pass (Boss's own established split: visible text is the accessible readout, `ProgressIndicator` dots are decorative) — matching that convention there instead of adding a second, redundant `role="status"` right next to existing text.
2. **Stats' zero-day-streak test was rewritten, not just left broken.** Its default fixture (`baseProfile()` + no attempts) exercised the "🔥 0 day streak" → "Start your streak today" swap — exactly the redundant state Part C removes. Seeded one real attempt so it now tests the actual case that swap is for (a lapsed streak with real history), and added a separate test for the true zero-attempts case (label absent entirely).
3. **`tools/mockupCapture.ts` was extended, not duplicated.** Rather than writing a one-off script for this pass's scenario-specific captures (seeded mastery data, zero-attempts Stats, per-interaction-type `/puzzle/:id`, real `/challenge` payloads), the existing committed capture tool gained a `runPhase4Extras()` pass appended after its normal crawl, gated by a `PHASE4_TAG` env var (`before`/`after`) so the two passes' output files sit side by side in `docs/redesign/mockups/` by filename. Fixed one latent bug in the process: the scrubber puzzle's forward-step control's accessible name ("Next step") only exists as an `aria-label`/tooltip — its visible glyph is "›" — so a `:has-text("Next step")` locator silently never matched it; switched to `getByRole('button', { name: 'Next step' })`.

**Verification:** `pnpm typecheck`, and every touched test file (`PatternPicker.test.tsx`, `StatsPage.test.tsx`, `ChallengePage.test.tsx`, `CompetePage.test.tsx`) individually — all green. Full `pnpm validate` run before the PR (see that PR's description for the final combined result).

**Still open, unchanged by this pass:**

- **Icon set** (Phase 2) and the **motion/animation system** — both still deferred; no icon or animation change anywhere in this pass's diff, per this session's own hard constraints.
- **Page transitions** — still instant; routing untouched.
- **Target timeline** — still no date attached.
- **`CENTERED_PAGE_SHELL_CLASS`** — already fully removed from `PageShell.tsx` (not just unused) by the 2026-09-18 revert (commit `647591c`, predating this session's pull) — nothing left to clean up.

**Open questions:**

- Is the top-anchored dead-space tradeoff (content in the top third, nothing below, on short-content screens) worth a real fix later using a different mechanism than whole-viewport centering — e.g. a capped top-offset or extra bottom padding, as `PageShell.tsx`'s own removal comment suggests? It now visibly applies to Challenge's intro/comparison screens and both terminal states too, not just Compete/Rush/Trace — a wider footprint than when it was last evaluated.
- `FirstRunSequence.tsx` has no automated test coverage of its own rendered output at all (only its underlying hook, `useFirstRunSession.test.ts`, is tested) — the progress-indicator addition there rode on that gap rather than closing it; worth a real component test in a future pass, independent of this redesign. **Closed 2026-09-19** — see the Status Update below.
- Icon production method and its relationship to `DuckMascot` (playful sibling vs. neutral UI layer) remain unpicked, blocking Phase 2 from starting.

## Status update — 2026-09-19 (Motion foundation, completed)

This session finishes the one non-deferred piece the audit's "Animation & motion principles" section still listed: motion defined as tokens plus a few reusable patterns, instead of one-off timings per component. Icons and success/fail duck moments stay deferred (unchanged by this pass). Also covers the two small Phase 4 follow-ups the previous status update's own "Open questions" flagged.

**Part A — Phase 4 follow-ups:**

- **Challenge desktop rail orphan border.** `ChallengePage.tsx`'s right-rail `<aside>` (audit #4.5's "right rail") rendered its `border-l`/padding unconditionally, so before an answer is submitted (the slot is empty) it showed a bare vertical line with nothing next to it. Fixed with a `has-[>div:empty]:border-0 has-[>div:empty]:p-0` Tailwind variant on the `<aside>` itself — the slot's own `empty:hidden` already collapsed the slot; this collapses the aside's border/padding to match, without unmounting the aside (still the portal target). One new test (`ChallengePage.test.tsx`, "desktop right rail" describe block) renders at a stubbed >=1024px viewport and asserts the slot is empty pre-answer, non-empty after a click. Screenshot re-captured: `docs/redesign/mockups/challenge-midpuzzle--desktop--after.png` (via a scratch, uncommitted Playwright script against a local `vite preview` server — mirrors `tools/mockupCapture.ts`'s own `challenge-midpuzzle` capture block, not a permanent addition to that tool).
- **`FirstRunSequence.tsx` render test.** Added `FirstRunSequence.test.tsx` — a single end-to-end test driving a 2-puzzle mcq fixture run (not real content, matching `useFirstRunSession.test.ts`'s own fixture-pool convention) through the real component: asserts "Puzzle 1 of 2" + 2 progress dots on first render, advances via real button clicks (queried by each fixture's exact choice text, not a positional `findAllByRole('button')[0]` — that raced the puzzle-to-puzzle remount and was flaky ~1 in 3 runs during development), reaches `FirstRunComplete`'s "You solved your first puzzles" screen with the correct `2/2 correct` stat, and confirms `onComplete` only fires after the exit CTA, not automatically at `phase === 'ended'` (matches `FirstRunComplete.tsx`'s own doc comment on that distinction). Mocks `../../content` (fixture `FIRST_RUN_SET`), `../../storage`, and `../../telemetry` — the same module paths `Home.test.tsx`/`useFirstRunSession.test.ts` already mock, one directory shallower.

**Part B — Motion foundation:**

**Inventory** (full grep pass: `@keyframes`, `animate-`, `transition`, `duration-[`, `ease-`, `active:scale`, `framer-motion`, `useNumberTween`):

| Pattern                                                                                                              | Where                                                                                                                                                                                 | Duration/easing                                                                                | Disposition                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Press (`transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90`), duplicated | `BossPage.tsx`, `ChallengePage.tsx`, `RushPage.tsx`, `PatternPicker.tsx`                                                                                                              | 50ms ease-out                                                                                  | **Migrated** to `PRESS_CLASS` (150ms)                                                                                                                                                                                                                                                                                                  |
| Same string, already correct                                                                                         | `ShareMenu.tsx`, `ChallengerNameSheet.tsx`, `ChallengeButton.tsx`, `FirstRunComplete.tsx`, `MissionComplete.tsx`, `PuzzleCardShell.tsx`, `TraceRunner.tsx`, `ReportPuzzleControl.tsx` | 50ms ease-out                                                                                  | Left as-is — not one of the plan's named 6 files or a "found without" case; a 9-file sweep beyond the named scope wasn't justified by the DoD's own wording                                                                                                                                                                            |
| Card hover-lift, no mobile press                                                                                     | `Home.tsx` `CARD_BASE`, `CompetePage.tsx` `DOOR_CARD_CLASS`                                                                                                                           | `lg:duration-150`; mobile had none (Home) or an untransitioned `active:scale-[0.98]` (Compete) | **Added** `PRESS_CLASS`, mobile/tablet only — `lg:`'s own transition-property/duration still wins on desktop, hover-lift feel unchanged                                                                                                                                                                                                |
| Nav items, zero press feedback                                                                                       | `NavRail.tsx` (`ITEM_BASE`, Settings link, collapse button), `BottomNav.tsx` (`ITEM_BASE`)                                                                                            | none                                                                                           | **Added** `PRESS_CLASS` — always-visible chrome on every page, the audit's own "most don't have it" finding at its most visible                                                                                                                                                                                                        |
| `.feedback-panel` entrance                                                                                           | `tokens.css`                                                                                                                                                                          | 0.18s ease-out                                                                                 | **Migrated** onto `var(--motion-feedback) var(--ease-out)` — identical resolved value, now token-sourced                                                                                                                                                                                                                               |
| New entrance, 4 named surfaces                                                                                       | Challenge intro hero, Challenge comparison, `FirstRunComplete`, `MissionComplete`                                                                                                     | none (no prior entrance)                                                                       | **Added** `.motion-enter` (300ms)                                                                                                                                                                                                                                                                                                      |
| Combo badge pop                                                                                                      | `practicePage.css` `.status-bar__combo`                                                                                                                                               | 0.18s ease-out                                                                                 | Protected (ComboSurge) — untouched, despite coincidentally matching `--motion-feedback`                                                                                                                                                                                                                                                |
| Impact pulse/glow/shake/shield-pulse, rating-delta scale-in, auto-advance drain                                      | `practice.css`                                                                                                                                                                        | various, 0.2s–0.5s                                                                             | Protected (`feel.ts`/combo/auto-advance) — untouched                                                                                                                                                                                                                                                                                   |
| Rating/delta number tweens                                                                                           | `StatusBar.tsx` (600ms), `PuzzleCardShell.tsx` (500ms) via `useNumberTween`                                                                                                           | n/a                                                                                            | Protected ("tween" explicitly named) — untouched                                                                                                                                                                                                                                                                                       |
| DragOrder row/drag transitions                                                                                       | `practice.css` (`.drag-order__row*`)                                                                                                                                                  | 0.22s/0.15s                                                                                    | Protected (gesture-adjacent, `practice/interactions/*` carve-out extended to its CSS) — untouched                                                                                                                                                                                                                                      |
| Ghost-race fill                                                                                                      | `GhostBar.tsx`/`ghostBar.css`                                                                                                                                                         | `--ghost-duration-ms`, set per-race from real elapsed time                                     | Data-driven, not decorative — out of scope                                                                                                                                                                                                                                                                                             |
| Route-skeleton shimmer                                                                                               | `routeSkeleton.css`                                                                                                                                                                   | 1.4s ease infinite                                                                             | No named pattern covers a loading shimmer — left alone                                                                                                                                                                                                                                                                                 |
| Nav-rail width/collapse, Tooltip, ProgressIndicator bar fill                                                         | `NavRail.tsx`, `Tooltip.tsx`, `ProgressIndicator.tsx`                                                                                                                                 | 150ms ease-out (all three, already)                                                            | Already correct, distinct concern (layout/hover/fill, not press/entrance) — untouched                                                                                                                                                                                                                                                  |
| `framer-motion` (only real usage)                                                                                    | `PracticePage.tsx`'s `AnimatePresence`/`motion.div` around the puzzle card                                                                                                            | spring (stiffness 400, damping 32) — no fixed duration                                         | **Not gated** on `data-reduced-motion` — a real, pre-existing gap (JS-driven, the CSS kill-switch only reaches `transition-duration`/`animation-duration`). Not touched: not in this pass's named scope, and a spring has no duration to move onto a token. Flagged here rather than left silently implicit — worth its own follow-up. |

**Tokens introduced** (`src/index.css`'s `:root` design-token block + `@theme inline` mapping):

- `--motion-press: 150ms` (was a hardcoded, duplicated `0.05s`/50ms — a deliberate change, not a straight port: the audit's own guidance is ~120-180ms, and 50ms reads as a glitch rather than feedback)
- `--motion-feedback: 0.18s` (unchanged — `.feedback-panel`'s pre-existing value, kept as the baseline rather than picked fresh)
- `--motion-enter: 300ms` (new, no prior entrance existed to inherit a value from)
- `--ease-out: cubic-bezier(0, 0, 0.2, 1)` / `--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)` — both exactly Tailwind's own built-in `ease-out`/`ease-in-out` values, so mapping the existing `ease-out`/`ease-in-out` utility classes onto them (`@theme inline`'s `--ease-out`/`--ease-in-out` keys) is a pure rename, zero visual change
- **Correction, 2026-09-19:** the durations are _not_ mapped into `@theme inline` the same way. Tailwind v4 has no `--duration-*` theme namespace, so a `--duration-press: var(--motion-press)` entry there silently generates no `duration-press` utility at all (verified against the built CSS — the class never appeared, `PRESS_CLASS` was falling back to Tailwind's stock 150ms `--default-transition-duration` by coincidence, not by design). `--ease-out`/`--ease-in-out` do map cleanly since `--ease-*` is a real namespace. Fixed by reading `--motion-press` directly via a `duration-[var(--motion-press)]` arbitrary value in `PRESS_CLASS` (`src/app/motion.ts`) instead; `--motion-feedback`/`--motion-enter` never needed a Tailwind utility to begin with (`tokens.css`'s `animation` shorthand reads them as plain CSS `var()`s). The dead `--duration-press`/`--duration-feedback`/`--duration-enter` entries were removed from `@theme inline`.
- No JS numeric mirror was added: neither `PRESS_CLASS` nor `.motion-enter` needs the raw millisecond values in JS (no `setTimeout` keyed off them), so there is nothing that could drift from `tokens.css`/`index.css`, and no drift test was needed for the same reason the plan made it conditional ("if any JS needs the numbers"). `feedback-panel-slide-in`'s own drift risk is closed structurally instead: it now reads `var(--motion-feedback)` rather than a second hardcoded `0.18s`, so there is no longer a duplicate value to drift from the token.

**What adopted the tokens:**

- `PRESS_CLASS` (new `src/app/motion.ts`) — `transition-[transform,opacity] duration-[var(--motion-press)] ease-out active:scale-[0.98] active:opacity-90`. Applied to `RushPage.tsx`, `ChallengePage.tsx`, `BossPage.tsx`, `PatternPicker.tsx` (migrated from the old literal string), `Home.tsx`, `CompetePage.tsx` (added — see inventory), `NavRail.tsx`, `BottomNav.tsx` (added — found-without-feedback case).
- `.motion-enter` (new rule in `tokens.css`, alongside `.feedback-panel` — same bare-classname convention, since a named `@keyframes` has no Tailwind arbitrary-value equivalent worth reaching for) — applied to exactly the 4 suggested surfaces: Challenge intro hero (`INTRO_HERO_CLASS`), Challenge comparison (`ChallengeComparison.tsx`'s root), `FirstRunComplete.tsx`'s root, `MissionComplete.tsx`'s root. The latter two needed a new `import '../tokens.css'` (previously not a consumer); Challenge's two already ride `ChallengePage.tsx`'s existing import (same chunk).
- `.feedback-panel` (`tokens.css`) — migrated onto `var(--motion-feedback) var(--ease-out)`, verified byte-for-byte identical resolved timing (0.18s ease-out) via the full test suite for every consumer (`PuzzleCardShell.test.tsx`, `TraceRunner.test.tsx`, `ChallengePage.test.tsx`) passing unchanged.

**Reduced-motion test** (`src/app/motion.test.tsx`, new): proves both patterns collapse under `data-reduced-motion="true"` — but as a CSS-source structural proof, not a live `getComputedStyle` read. Empirically confirmed first: vitest's `css: true` transforms CSS imports so they don't error, but does not inject the resulting stylesheet into jsdom's document (a probe against both classes returned browser defaults — `0s`/`auto` — regardless of the attribute). No test anywhere in this codebase asserts real cascaded CSS values for exactly that reason (only `toHaveClass`-style presence checks exist). What's asserted instead: (1) `src/index.css`'s universal `[data-reduced-motion='true'] *, *::before, *::after` rule still sets `animation-duration`/`transition-duration` to `0.001ms !important` — CSS's cascade rules guarantee an `!important` declaration on those exact properties always wins regardless of specificity/source order; (2) `PRESS_CLASS` routes its timing through `duration-[var(--motion-press)]`/`transition-[transform,opacity]` with no `!important` of its own to out-cascade the kill-switch; (3) `.motion-enter` routes through a plain `animation` shorthand, same check. Together this is a complete proof, not an approximation.

**Bundle diff** (play-loop chunks — `pnpm run build`, gzip sizes; recorded before starting Part A, verified again after Part B):

| Chunk                | Before   | After    | Δ        |
| -------------------- | -------- | -------- | -------- |
| `PuzzleCardShell.js` | 52.48 kB | 52.48 kB | 0        |
| `TraceRunner.js`     | 13.82 kB | 13.82 kB | 0        |
| `PracticePage.js`    | 9.30 kB  | 9.24 kB  | −0.06 kB |
| `ChallengePage.js`   | 3.64 kB  | 3.62 kB  | −0.02 kB |
| `RushActivePlay.js`  | 3.37 kB  | 3.37 kB  | 0        |
| `RushPage.js`        | 1.69 kB  | 1.65 kB  | −0.04 kB |
| `BossActivePlay.js`  | 2.50 kB  | 2.50 kB  | 0        |
| `BossPage.js`        | 1.65 kB  | 1.60 kB  | −0.05 kB |
| `CompetePage.js`     | 2.73 kB  | 2.74 kB  | +0.01 kB |
| `Home.js`            | 5.31 kB  | 5.34 kB  | +0.03 kB |
| `MissionsPage.js`    | 4.31 kB  | 4.33 kB  | +0.02 kB |
| `tokens.css`         | 0.28 kB  | 0.32 kB  | +0.04 kB |

No chunk grew beyond a fraction of a kB, and every genuine play-loop chunk (Practice/Rush/Boss/Challenge/Trace/PuzzleCardShell) is flat or smaller — the shared `PRESS_CLASS` import is shorter at each call site than the literal string it replaced, more than paying for the import itself. `Home`/`MissionsPage`/`tokens.css`'s small growth is real added functionality (press/entrance feedback that didn't exist, plus the new tokens/`.motion-enter` rule), not incidental bloat. No new dependency was added.

**Still open, per the original audit (unchanged by this pass except where noted):**

- **Icon set** (Phase 2) — production method still undecided, unchanged.
- **Success/fail duck moments** — explicitly the next session's scope, not touched here.
- **Page transitions** — resolved this pass (see open-decisions checklist above): stay instant.
- **Target timeline** — still no date attached.
- **The dead-space alternative-mechanism question** — unchanged, still open (see the 2026-09-19 Phase 4 update's own open question above).
- **`framer-motion`'s un-gated spring transition** (`PracticePage.tsx`) — a real gap surfaced by this pass's inventory, not created by it. Not fixed here (out of named scope, no fixed duration to tokenize) — worth its own follow-up.
- **`FirstRunSequence.tsx` test coverage** — closed this pass (Part A).

**Verification:** `pnpm typecheck`, `pnpm exec vitest run` (all touched test files individually, then the full suite) all green. `pnpm validate` run before the PR (see that PR's description for the final combined result). No changes under `practice/interactions/*`, `Scrubber.tsx`, `practice/feel.ts`, sound, or haptics.
