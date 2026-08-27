# Codoro — project roadmap

The whole arc, v1 through multiplayer. No dates — versions are gated by decisions and outcomes, not the calendar. Each version has an **entry gate**: the thing that must be true before its work starts. Detailed phase plans are written one version at a time; later versions are sketched here at phase granularity and get their own build plan when their gate opens.

The one-line strategy: **v2 makes the game worth playing, v3 polishes and hardens it, v4 gives players an identity and a comeback channel, v5 makes it a game people return to — and launches it, v6 lets them play each other.**

> **Resequenced 2026-08-26 (direct user decision).** The launch moves from v3's tail to v5's. Reason, recorded honestly: the app in its current state plays like a flashcard exam, not a game — launching it would spend the one-shot launch audience on a product that doesn't retain. Accounts (v4) and gamification/retention (v5) are built first; the launch fires when the game earns it. This consciously waives the old evidence gates for v4 (retention data cannot exist pre-launch) — an exception to sequencing principle 1, mitigated by v5's closed beta, which produces retention evidence before any loud post. v3 Phase 4's anonymous-only backend is superseded: the backend is built once, authenticated, in v4 (`docs/v4-build-plan.md`). The prior version numbering (v4=accounts, v5=multiplayer) shifts: multiplayer is now v6.

---

## v1 — Quiz app (shipped)

Live at getcodoro.com. Vite/React/TS PWA, local-first (IndexedDB), 108 puzzles across swipe/mcq/tap-line, Elo rating, Daily, Rush. Retro: `docs/v1-retro.md`. Central finding: the content is quiz questions, not puzzles — which is what v2 exists to fix.

## v2 — The puzzle rebuild (shipped)

Scrubber flagship, 214 calibrated puzzles, challenge links, drag-and-drop, Rush escalation, export/import, PWA hardening. Full record: `docs/v2-build-plan.md`.

## v3 — Build-out & hardening (build complete; verification tail open)

Originally "Launch: get users" — the launch machinery it carried (readiness gate, anonymous backend, distribution, growth loop) moved out on 2026-08-26: the backend to v4, the launch tail to v5. What v3 actually delivered, all merged: OD-1 swipe closed by on-device captured evidence (5 rounds), Boss challenges + engagement pass, Missions + click-meaningfulness, the full 2b UI redesign (Tailwind migration, tokens/shell, game-feel, sharing, Home, stats page), the August mobile-hardening wave (bottom nav, OD-6, code-wrap, share drawer), and the practice-page performance pass. Full record: `docs/v3-build-plan.md`.

**Still open under v3's name** (none of it blocks v4 code; all of it blocks v5's launch tail):

1. Merge `perf/content-metadata-lazy-load` (review-complete).
2. **2b.8 QA pass** — batched screenshot review of every route at mobile/desktop widths + Lighthouse re-check; absorbs the visual-verification boxes 2b.0/2b.1/2b.3/2b.4 left open (those sessions ran headless).
3. **Thomas's device-verification backlog**: two-phone interaction regression (now incl. boss/missions), PWA install/offline/SW-update, live telemetry check, week-long storage soak, cross-device Daily, boss/missions playthroughs.

## v4 — Accounts, identity, comeback channel (open — `docs/v4-build-plan.md`)

**Entry gate: open** (2026-08-26 decision; the old retention-evidence gate is consciously waived — see the resequencing note). One backend, built once, authenticated from day one; guest-first stays law — an account is never required to play.

| Phase | What |
| --- | --- |
| 4.0 | Backend foundation: `workers/` package, Clerk JWT verification, D1 schema, rate limiting, CI deploy |
| 4.1 | Client auth: Clerk React, guest-first UX (signup only at value moments), account settings + deletion |
| 4.2 | Progress sync: versioned export format as payload, anonymous→account migration keeps rating/history, merge rules, multi-device |
| 4.3 | Public identity: usernames, opt-in profiles, named Daily/Rush/Boss leaderboards, privacy controls |
| 4.4 | Edge OG meta injection (carried v3 item — covers `/challenge` unfurls) |
| 4.5 | Email re-engagement: streak-at-risk nudge, challenge-answered notify, weekly digest (Resend; preferences + one-click unsubscribe from day one) |
| 4.6 | Hardening: load test + 1×/10×/100× cost curve (incl. Clerk/Resend), authz suite, `/legal` PII delta, lawyer review engaged |

## v5 — Make it a game people return to — then launch

**Entry gate:** v4 shipped (sync + identity + email live on staging). **Exit state: launched**, with retention evidence from a closed beta preceding any loud post. This is the version that answers the "flashcard exam" problem head-on; it gets its own build plan when the gate opens, preceded by a **game-feel definition session** (the repo's convention: no build without the definition on paper).

| Phase | What (sketch — the definition session binds, this doesn't) |
| --- | --- |
| 5.0 | **Game-feel definition session** (blocking): what "feels like a game, not an exam" means operationally — session shape, difficulty curve, reward cadence, failure UX; audits every current surface against it |
| 5.1 | **Progression spine — curated tracks & levels**: named tracks (Interview Prep, JS Fundamentals, React, …) composed of short sessionized levels with a visible map, clear/CLEARED payoff moments, and mastery stars; Missions/Boss become structures inside tracks rather than parallel modes |
| 5.2 | **New puzzle interactions**: fill-in-the-blank (cloze code), debug-it mode (a wrong answer drops you into a console to find *why* — the "X" becomes a puzzle), fix-the-bug; content pipeline + `validate:content` extended to the new formats |
| 5.3 | **Reward systems**: streaks with freezes, badges/achievements (filling v4's profile slots), daily quests, leaderboard seasons — every reward wired to a real accomplishment (the no-fake-numbers rule holds) |
| 5.4 | **Comeback loops**: daily quest + streak + new-content hooks plugged into v4's email channel; re-engagement measured, not assumed |
| 5.5 | **Closed beta**: 10–20 real users, retention dashboards (day-2/day-7 return, session length, puzzles/session) — the evidence loop the waived v4 gate deferred; iterate until the numbers say "game," not "exam" |
| 5.6 | **Launch tail** (carried from old v3): launch-readiness verification, scaling validation gate with measured numbers, SEO/prerender pass, staggered launch posts (r/webdev, r/learnprogramming, HN Show, X), reel videos, then the growth loop (feedback channel, weekly content drops, dashboard watch) |

## v6 — Multiplayer

**Entry gate:** launched (v5) and an active player base — multiplayer with no one online is worse than no multiplayer.

| Phase | What |
| --- | --- |
| 6.0 | Async duels: challenge links upgraded with accounts + server-stored challenges — persistent history, tamper-proof results, answered-challenge notifications (the v4 email/notify channel already carries these) |
| 6.1 | Live head-to-head: realtime Rush-style races (Durable Objects + WebSockets on the existing Cloudflare stack), Elo-based matchmaking reusing the rating engine |
| 6.2 | Competitive structure: seasons, ladders, private rooms/clubs (classrooms and interview-prep groups are the obvious wedge) |

---

## Continuous tracks (not version-bound)

- **Content ops** — the pipeline runs every version; volume and calibration never stop mattering. v5.2's new interaction formats widen it. More languages for the scrubber (Java/C traces) when demand justifies the tooling.
- **AI features** — parked until defined as a concrete feature. Candidates (AI hints, "explain my mistake") get real once beta/launch data shows where players actually get stuck; the debug-it mode (5.2) is the nearest structured cousin.

## Sequencing principles

1. **Users before infrastructure** — held from v1 through v3, **consciously excepted on 2026-08-26**: v4/v5 build identity and retention mechanics pre-launch, on the recorded conviction that launching the current experience would waste the one-shot audience. The exception is bounded: v5.5's closed beta restores the evidence loop before the loud launch, and if the beta says the retention isn't there, v5.6 waits until it is.
2. **Each version is independently shippable.** If the beta shows nobody wants this, v6 never gets built and nothing was wasted on it.
3. **The engine boundary carries the whole roadmap.** Pure `engine/` + versioned storage is what lets multiplayer reuse the same rating, selection, and rush logic untouched — and what made the export format the sync payload for free.
4. **Guest-first is law from v4 on.** An account is never required to play; every account feature is additive.
