# Codoro — project roadmap

The whole arc, v1 through multiplayer. No dates — versions are gated by decisions and outcomes, not the calendar. Each version has an **entry gate**: the thing that must be true before its work starts. Detailed phase plans are written one version at a time; later versions are sketched here at phase granularity and get their own build plan when their gate opens.

The one-line strategy: **v2 makes the game worth playing, v3 polishes and hardens it, v4 makes it feel finished and controllable, v5 gives players an identity and a comeback channel, v6 makes it a game people return to — and launches it, v7 lets them play each other.**

> **Resequenced 2026-08-26 (direct user decision).** The launch moves from v3's tail to v6's. Reason, recorded honestly: the app in its current state plays like a flashcard exam, not a game — launching it would spend the one-shot launch audience on a product that doesn't retain. Accounts (v5) and gamification/retention (v6) are built first; the launch fires when the game earns it. This consciously waives the old evidence gates for v5 (retention data cannot exist pre-launch) — an exception to sequencing principle 1, mitigated by v6's closed beta, which produces retention evidence before any loud post. v3 Phase 4's anonymous-only backend is superseded: the backend is built once, authenticated, in v5 (`docs/v5-build-plan.md`). The prior version numbering (v5=accounts, v6=multiplayer) shifts: multiplayer is now v7.

> **Resequenced again 2026-08-27 (direct user decision).** A UI/polish version is inserted as **v4** (`docs/v4-build-plan.md`), pushing accounts to v5, gamification/launch to v6, multiplayer to v7. Reason: every item on `docs/todo.md` is client-only with no backend dependency, so it ships incrementally instead of waiting out 10–14 sessions of invisible infrastructure — and two of those items (the Settings rebuild, the app-feel/optimistic-rendering work) are surfaces v5's 5.1 and 5.3 would otherwise build on and then have rebuilt underneath them. The accounts plan is unchanged in substance; only its number and phase labels moved. This does not delay the launch, which is behind v6 either way.

---

## v1 — Quiz app (shipped)

Live at getcodoro.com. Vite/React/TS PWA, local-first (IndexedDB), 108 puzzles across swipe/mcq/tap-line, Elo rating, Daily, Rush. Retro: `docs/v1-retro.md`. Central finding: the content is quiz questions, not puzzles — which is what v2 exists to fix.

## v2 — The puzzle rebuild (shipped)

Scrubber flagship, 214 calibrated puzzles, challenge links, drag-and-drop, Rush escalation, export/import, PWA hardening. Full record: `docs/v2-build-plan.md`.

## v3 — Build-out & hardening (build complete; verification tail open)

Originally "Launch: get users" — the launch machinery it carried (readiness gate, anonymous backend, distribution, growth loop) moved out on 2026-08-26: the backend to v5, the launch tail to v6. What v3 actually delivered, all merged: OD-1 swipe closed by on-device captured evidence (5 rounds), Boss challenges + engagement pass, Missions + click-meaningfulness, the full 2b UI redesign (Tailwind migration, tokens/shell, game-feel, sharing, Home, stats page), the August mobile-hardening wave (bottom nav, OD-6, code-wrap, share drawer), and the practice-page performance pass. Full record: `docs/v3-build-plan.md`.

**Still open under v3's name** (none of it blocks v4 or v5 code; all of it blocks v6's launch tail). Items 2 and 3 are **executed in v4's Phase 4.5**, which is the closest natural home for them:

1. Merge `perf/content-metadata-lazy-load` (review-complete).
2. **2b.8 QA pass** — batched screenshot review of every route at mobile/desktop widths + Lighthouse re-check; absorbs the visual-verification boxes 2b.0/2b.1/2b.3/2b.4 left open (those sessions ran headless). → v4 Phase 4.5.
3. **Thomas's device-verification backlog**: two-phone interaction regression (now incl. boss/missions), PWA install/offline/SW-update, live telemetry check, week-long storage soak, cross-device Daily, boss/missions playthroughs. → v4 Phase 4.5 (real hardware; his, not a session's).

## v4 — Feel & control: the polish version (open — `docs/v4-build-plan.md`)

**Entry gate: open** (2026-08-27 decision). Scope is exactly `docs/todo.md`'s open items and nothing else. Nothing here needs a backend; every phase ships to production the day it merges.

| Phase | What |
| --- | --- |
| 4.0 | Desktop & keyboard control: Enter to submit/advance, arrow-key interaction per type, the desktop rails (right sidebar sticky), the Practice scroll defect |
| 4.1 | Settings, for real: a first-class route with actual preferences, export/import folded in, preferences stored in the versioned export format so v5's sync gets them free |
| 4.2 | Difficulty filter on Browse (deliberately *not* the rated flow) |
| 4.3 | Daily, made hard: mcq and swipe-binary dropped (firm), calendar rebuilt around scrubber/drag-order/tap-line, rule enforced in CI. **Gated on a content batch** — commissioned on day one, so this phase lands last |
| 4.4 | Affordances: drag-handle target + first-use hint, tooltips where a control isn't self-evident, accessible names on icon-only controls |
| 4.5 | The verification tail: v3's 2b.8 QA pass, todo item 19's mobile defects (verify before fixing), Thomas's device backlog, regression sweep over 4.0–4.4 |

Deliberately **not** in v4: skeleton loaders, caching and optimistic rendering (todo 9/10/11) — local-first means there is no latency to mask and no response to cache; they become real work in v5. Report-a-puzzle (todo 18) moved to v5, where a real endpoint costs an hour instead of a `mailto:` hack. Privacy policy and ToS (todo 15/16) stay in v5's single lawyer review. "Make Daily better" beyond its interaction mix belongs to v6's game-feel definition session. The full independent-scroll desktop shell was considered for 4.0 and rejected — it destabilizes the shell right before v5 builds on it; if still wanted, it belongs in v6.

## v5 — Accounts, identity, comeback channel (`docs/v5-build-plan.md`)

**Entry gate: v4 shipped** (2026-08-27; the old retention-evidence gate stays consciously waived per the 2026-08-26 note — only the version immediately in front of it changed). One backend, built once, authenticated from day one; guest-first stays law — an account is never required to play.

| Phase | What |
| --- | --- |
| 5.0 | Backend foundation: `workers/` package, Clerk JWT verification, D1 schema, rate limiting, CI deploy, puzzle-report endpoint (unauthenticated by design) |
| 5.1 | Client auth: Clerk React, guest-first UX (signup only at value moments), account settings + deletion, report-a-puzzle control |
| 5.2 | Progress sync: versioned export format as payload, anonymous→account migration keeps rating/history, merge rules, multi-device |
| 5.3 | Public identity: usernames, opt-in profiles, named Daily/Rush/Boss leaderboards, privacy controls |
| 5.4 | Edge OG meta injection (carried v3 item — covers `/challenge` unfurls) |
| 5.5 | Email re-engagement: streak-at-risk nudge, challenge-answered notify, weekly digest (Resend; preferences + one-click unsubscribe from day one) |
| 5.6 | Hardening: load test + 1×/10×/100× cost curve (incl. Clerk/Resend), authz suite, `/legal` PII delta, lawyer review engaged |

## v6 — Make it a game people return to — then launch

**Entry gate:** v5 shipped (sync + identity + email live on staging). **Exit state: launched**, with retention evidence from a closed beta preceding any loud post. This is the version that answers the "flashcard exam" problem head-on; it gets its own build plan when the gate opens, preceded by a **game-feel definition session** (the repo's convention: no build without the definition on paper).

| Phase | What (sketch — the definition session binds, this doesn't) |
| --- | --- |
| 6.0 | **Game-feel definition session** (blocking): what "feels like a game, not an exam" means operationally — session shape, difficulty curve, reward cadence, failure UX; audits every current surface against it |
| 6.1 | **Progression spine — curated tracks & levels**: named tracks (Interview Prep, JS Fundamentals, React, …) composed of short sessionized levels with a visible map, clear/CLEARED payoff moments, and mastery stars; Missions/Boss become structures inside tracks rather than parallel modes |
| 6.2 | **New puzzle interactions**: fill-in-the-blank (cloze code), debug-it mode (a wrong answer drops you into a console to find *why* — the "X" becomes a puzzle), fix-the-bug; content pipeline + `validate:content` extended to the new formats |
| 6.3 | **Reward systems**: streaks with freezes, badges/achievements (filling v5's profile slots), daily quests, leaderboard seasons — every reward wired to a real accomplishment (the no-fake-numbers rule holds) |
| 6.4 | **Comeback loops**: daily quest + streak + new-content hooks plugged into v5's email channel; re-engagement measured, not assumed |
| 6.5 | **Closed beta**: 10–20 real users, retention dashboards (day-2/day-7 return, session length, puzzles/session) — the evidence loop the waived v5 gate deferred; iterate until the numbers say "game," not "exam" |
| 6.6 | **Launch tail** (carried from old v3): launch-readiness verification, scaling validation gate with measured numbers, SEO/prerender pass, staggered launch posts (r/webdev, r/learnprogramming, HN Show, X), reel videos, then the growth loop (feedback channel, weekly content drops, dashboard watch) |

## v7 — Multiplayer

**Entry gate:** launched (v6) and an active player base — multiplayer with no one online is worse than no multiplayer.

| Phase | What |
| --- | --- |
| 7.0 | Async duels: challenge links upgraded with accounts + server-stored challenges — persistent history, tamper-proof results, answered-challenge notifications (the v5 email/notify channel already carries these) |
| 7.1 | Live head-to-head: realtime Rush-style races (Durable Objects + WebSockets on the existing Cloudflare stack), Elo-based matchmaking reusing the rating engine |
| 7.2 | Competitive structure: seasons, ladders, private rooms/clubs (classrooms and interview-prep groups are the obvious wedge) |

---

## Continuous tracks (not version-bound)

- **Content ops** — the pipeline runs every version; volume and calibration never stop mattering. v6.2's new interaction formats widen it. More languages for the scrubber (Java/C traces) when demand justifies the tooling.
- **AI features** — parked until defined as a concrete feature. Candidates (AI hints, "explain my mistake") get real once beta/launch data shows where players actually get stuck; the debug-it mode (6.2) is the nearest structured cousin.

## Sequencing principles

1. **Users before infrastructure** — held from v1 through v4, **consciously excepted on 2026-08-26** for the versions after it: v5/v6 build identity and retention mechanics pre-launch, on the recorded conviction that launching the current experience would waste the one-shot audience. The exception is bounded: v6.5's closed beta restores the evidence loop before the loud launch, and if the beta says the retention isn't there, v6.6 waits until it is.
2. **Each version is independently shippable.** If the beta shows nobody wants this, v7 never gets built and nothing was wasted on it.
3. **The engine boundary carries the whole roadmap.** Pure `engine/` + versioned storage is what lets multiplayer reuse the same rating, selection, and rush logic untouched — and what made the export format the sync payload for free.
4. **Guest-first is law from v5 on.** An account is never required to play; every account feature is additive.
5. **Cheap and shippable goes in front of expensive and invisible.** Added 2026-08-27 with v4: when a version's work is client-only and ships incrementally, and the next version would rebuild the surfaces it touches, it runs first. This is the rule that put polish in front of accounts; it is not a licence to reorder around whichever version feels more fun.
