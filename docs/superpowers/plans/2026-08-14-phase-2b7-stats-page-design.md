# Phase 2b.7 — Stats page: design record

**Origin:** `docs/ui-redesign-plan.md`'s 2b.7 entry — "Mastery/stats page (not sized — scope decision needed first)." This document resolves that phase's blocking question (nav placement) and every other open call, via a brainstorming session with Thomas (2026-08-14). It is the design record; a follow-up task-by-task implementation plan (same shape as `docs/superpowers/plans/2026-08-12-phase-2b1-layout-shell.md`) is generated next via the `writing-plans` skill, not written here.

**Goal, in Thomas's words:** "a cool feature the user wants to check out" — a page people return to, not a buried utility screen. Every design call below is weighed against that bar, not just technical correctness.

---

## Locked decisions

| Question           | Decision                                                                                                                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nav placement      | Reachable from Home only (a card, like Daily/Rush/Trace/Boss/Missions) — **not** a NavRail/ModeSwitcher slot.                                                                                                                                                                                                          |
| Page name          | **Stats** (route `/stats`, card title "Stats").                                                                                                                                                                                                                                                                        |
| Content scope      | All five: rating history graph, streak/activity calendar, per-pattern accuracy heatmap, weakest-pattern callout, lifetime totals.                                                                                                                                                                                      |
| Page hierarchy     | Layout **A — Progress-forward**: hero rating stat + graph first, then the weakest-pattern callout, then the pattern heatmap, then the activity calendar + streak, then the lifetime-totals stat row. (Chosen over a streak-forward or snapshot-dashboard ordering — see visual-companion mockups, session transcript.) |
| Rating graph range | Windowed, with a 7d / 30d / all toggle (not all-time-only).                                                                                                                                                                                                                                                            |
| MasteryView's fate | **Fully replaced.** `PracticePage.tsx`'s desktop sidebar and mobile "Mastery" nav view stop rendering the full per-pattern list; both are replaced by a compact teaser (weakest pattern + "View full stats →" link to `/stats`). `MasteryView.tsx` itself is deleted once nothing references it.                       |
| Tooling used       | `ui-ux-pro-max:design` (routing/composition guidance — confirmed this task has no matching generator sub-skill, guidance-only, per the phase's own constraint) + `dataviz` (chart form/color rules) + the brainstorming skill's visual companion (3 real-token mockups, A/B/C compared, A chosen).                     |

---

## Why no new persisted data

Every piece is derivable from the existing `Attempt` record (`userRatingBefore/After`, `mode`, `correct`, `time_ms`, `localDateString`, `puzzleId`) plus `UserProfile.streak` (`longestStreak` already persisted). No `UserProfile` schema change, no migration, nothing new written to IndexedDB — this whole phase is a read-side feature. The one caveat: there is no persisted _daily streak history_, only the current/longest counters — the activity calendar is reconstructed from attempt dates (which days had ≥1 attempt), which is a real activity calendar but is not literally "streak over time" (a day can be active without extending the _current_ streak, e.g. after a break already reset it). This is an accepted approximation, not a gap to fix — good enough for the visual, and inventing a persisted daily-streak log for this alone would be overbuilding.

## Data layer

New file `src/app/stats/statsData.ts` — pure functions, no React/DOM, same shape as `src/app/homeActivity.ts` (unit-testable without rendering):

- `getRatingHistory(attempts, windowDays, nowIso)` → array of `{ date, rating }`, one point per calendar day: the **last** `userRatingAfter` recorded that day (a "daily close," not one point per attempt — keeps the line readable after hundreds of solves and matches how a real progress chart reads, per `dataviz`'s form-heuristic step). `windowDays: 7 | 30 | null` (`null` = all-time, same function, just a wider/no lookback cutoff — no separate bucketing path per window).
- `getActivityCalendar(attempts, nowIso)` → last 12 weeks × 7 days, `{ date, active: boolean }[]`, active = ≥1 attempt with that `localDateString`.
- `getLifetimeTotals(attempts, profile)` → `{ solved, bestStreak, totalTimeMs, modesPlayed }`. `solved` = `attempts.length`; `bestStreak` reads `profile.streak.longestStreak` directly (already persisted, no re-derivation); `totalTimeMs` sums `attempt.time_ms`; `modesPlayed` = distinct `attempt.mode` count.

Pattern heatmap and weakest-pattern callout **reuse `computeMastery()` from `src/app/practice/mastery.ts` unchanged** — no second accuracy implementation. Weakest-pattern callout = the lowest-`accuracy` row where `accuracy !== null` (i.e., already cleared `MIN_ATTEMPTS_FOR_MASTERY`, the existing threshold — not a new number invented for this page). If every pattern is still below that threshold, the callout doesn't render (see Empty states).

## Chart/visual treatment (`dataviz` rules applied)

- **Rating graph**: single series → no legend needed (title names it). 2px line, rounded end-cap, thin marks, hover crosshair + tooltip per point (line chart's default interaction layer). One axis only (rating; time is the x-axis, not a second scale).
- **Pattern heatmap** and **activity calendar**: both reuse the app's **existing status-color language** — `--accent`/`--warn`/`--danger`/neutral, the same four buckets `MasteryView`/`PatternPicker` already use (`mastered`/`learning`/`weak`/`new`) — rather than a fresh sequential single-hue ramp. Rationale: accuracy is already treated as a discrete state elsewhere in this app, not a continuous magnitude; introducing a second color grammar for the same concept on one new page would read as inconsistent, and `dataviz`'s own rule reserves status colors for exactly this (state, not "series N"). Activity calendar reuses the same accent scale at two opacities (active/inactive) rather than inventing a separate sequential ramp for a boolean.
- Every chart gets a plain-values fallback implicitly — the totals row and callout already state the same facts in text, so no separate "table view" toggle is being added for a single-series line + two 2-state grids (the accessibility-pass bar `dataviz` sets for ≥2-series categorical work; doesn't apply the same way here).

## Page composition (Layout A), top to bottom

**Mobile (~390–430px, primary viewport):**

1. Hero: "Rating" label + large current-rating number (mirrors Home's own hero-stat treatment) + the active graph-window's delta (e.g. "▲ +34 this week").
2. Rating history graph (the window toggle — 7d/30d/all — sits directly above or below the graph, matching the totals-row's plain button-group style elsewhere in the app; no new control pattern).
3. Weakest-pattern callout (danger-toned card, single pattern named + its accuracy).
4. Per-pattern accuracy heatmap (grid, not list — 13 patterns, tap a cell to start practicing that pattern, replacing `MasteryView`'s `onSelectPattern`).
5. Activity calendar (12 weeks × 7 days) + current streak count alongside its heading.
6. Lifetime totals — 4-up stat row (solved / best streak / time practiced / modes played).

**Desktop (≥1024px):** single centered column at the same `--content-width-desktop` max-width Home already uses (this content is inherently vertical/timeline-shaped, not a natural 2-column dashboard) — with one exception: the pattern heatmap and activity calendar (§4/§5, both roughly square grids) sit **side by side** in a 2-column row once there's room, since nothing about either needs full width. Graph, callout, and totals stay full-width above/below that row.

## Home entry point

New secondary card on `Home.tsx`, same shape/size as the existing Daily/Rush/Trace/Boss/Missions cards (`CARD_SECONDARY`, not `CARD_PRIMARY`) — title "Stats," short description line, no badge chip (nothing analogous to "Best {n}" or "{n} completed" exists for this card; a badge would have to fabricate one). Added to the `sm:grid-cols-[repeat(auto-fit,...)]` row, making it a 6-track grid — the 75px-floor math in that grid's own comment (`Home.tsx`) will need re-deriving for 6 tracks instead of 5, flagged there already ("Re-derive this number if a 6th mode card is ever added").

## Route wiring

- `ROUTES.stats = { path: '/stats', label: 'Stats' }` in `routes.ts`, plus a `ROUTE_META['/stats']` entry (title/description), following the existing pattern exactly.
- `src/app/stats/StatsPage.tsx`, lazy-loaded in `App.tsx` (`const StatsPage = lazy(async () => ({ default: (await statsImporter()).StatsPage }))` + `<Route path="/stats">`), matching every other mode's registration.

## MasteryView disposal — the one part touching existing files

- `PracticePage.tsx`'s desktop (`≥1024px`) sidebar: swap the full `<MasteryView refreshKey={...} />` render for a compact teaser — weakest pattern (reusing the same `computeMastery` call, just rendered smaller) + a "View full stats →" link to `/stats`. Same data fetch already happening there today, just a smaller render.
- `PracticePage.tsx`'s mobile "Mastery" nav view: same teaser treatment, or the nav item could point straight at `/stats` instead of swapping an in-place view — **implementation-plan-level call**, not re-litigated here; either preserves the "no mastery visibility lost mid-session" bar this design commits to.
- `DailyPage.tsx`'s desktop sidebar (`<MasteryView refreshKey={session.attemptVersion} />`, gated the same way): identical teaser swap.
- `MasteryView.tsx` and `MasteryView.test.tsx` are deleted once no import remains (grep-confirm before deleting, per this repo's own convention on prior phases).
- `PatternPicker.tsx` is **untouched** — it already computes its own mastery badges independently for pattern selection (a different flow, `/browse`) and was never a `MasteryView` consumer.

## Empty states

Matches `MasteryView`'s existing tone ("Build your mastery map / Solve puzzles and each pattern fills in with your accuracy over time"), extended page-wide for a fresh profile:

- Rating graph: flat line at the starting rating, no fabricated history.
- Pattern heatmap: all-neutral cells (the existing `new` bucket's styling).
- Weakest-pattern callout: doesn't render until ≥1 pattern clears `MIN_ATTEMPTS_FOR_MASTERY` — no "pick a pattern at random" placeholder.
- Activity calendar: empty grid, today's cell (if active) the only filled one.
- Totals: real zeros, not hidden.

## Testing approach

- `statsData.ts` gets a pure-function unit-test file (`statsData.test.ts`) mirroring `homeActivity.test.ts`'s style — deterministic `nowIso` injection, no real clock.
- `StatsPage.tsx` gets a component test (render + mocked `listAttempts`/`loadProfile`, assert each section renders, assert a heatmap-cell tap navigates via the same pattern-filter path `PatternPicker`/old `MasteryView` used).
- `PracticePage.test.tsx`/`DailyPage.test.tsx`'s existing `MasteryView`-era assertions (if any reference `mastery-row`/`mastery-row__count` literal classnames in the sidebar) get updated for the teaser's new markup — grep for those classnames as part of the implementation plan's own verification step, same discipline `PageShell`'s 2b.1 plan used for `.home`/`.home__card-title`.
- `pnpm validate` green throughout, same as every prior phase's DoD.

## Explicitly out of scope this phase

- A theme picker / second palette (already deferred app-wide, per `docs/ui-redesign-plan.md`'s preamble).
- Any new `UserProfile` field or backend call — Phase 4's concern, not this one.
- Streak-_history_ (as opposed to activity-by-day) — would need a new persisted daily log; the activity calendar's day-level approximation is accepted instead (see "Why no new persisted data").
- NavRail/ModeSwitcher changes — explicitly ruled out by the nav-placement decision above.
