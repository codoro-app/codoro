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
- [ ] **Icon production method.** Hand-drawn SVG following `Mascot.tsx`'s construction approach (slower, most consistent with the duck), AI-generated against a written style brief (faster, needs a tight brief to stay consistent), or a licensed icon set restyled to the token system (fastest, least original). Picks the phase-2 timeline.
- [ ] **Icon family relationship to the duck.** Playful/illustrated sibling to the mascot, or a neutral UI-icon language the duck sits on top of.
- [ ] **Does this fold into the already-locked v4 UI/polish phase** (`docs/v4-build-plan.md`, scope = `todo.md` items 9–26, gate open) or run as a separate effort alongside it? Unresolved since it first came up — worth settling so Claude Code builds against one plan, not two.
- [ ] **Page transitions** — in scope for the motion pass, or left instant? Real engineering cost either way.
- [x] **Compete's Play Human path** — confirmed wired (not a stub) during the 2026-09-17 SecondaryNav/StatBadge/Compete pass; `Play Human` → `LevelPicker` → `useCompeteSession` → `ChallengeButton` is a real, working flow.
- [ ] **Target timeline** — no date attached yet; worth picking one per phase so "complete" has an actual finish line rather than running open-ended.

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
