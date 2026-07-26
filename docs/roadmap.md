# Codoro — project roadmap

The whole arc, v1 through multiplayer. No dates — versions are gated by decisions and outcomes, not the calendar. Each version has an **entry gate**: the thing that must be true before its work starts. Detailed phase plans are written one version at a time (v2's is `docs/v2-build-plan.md`); later versions are sketched here at phase granularity and get their own build plan when their gate opens.

The one-line strategy: **v2 makes the game worth playing, v3 finds out if anyone wants to play it, v4 gives players an identity, v5 lets them play each other.** Backend complexity is added strictly in that order — none before users, no accounts before demand, no realtime before accounts.

---

## v1 — Quiz app (shipped)

Live at getcodoro.com. Vite/React/TS PWA, local-first (IndexedDB), 108 puzzles across swipe/mcq/tap-line, Elo rating, Daily, Rush. Retro: `docs/v1-retro.md`. Central finding: the content is quiz questions, not puzzles — which is what v2 exists to fix.

## v2 — The puzzle rebuild (planned — `docs/v2-build-plan.md`)

**Entry gate:** open (v1 complete).
**Exit state:** a game good enough to put in front of strangers. Build-only, no marketing, still local-first.

| Phase | What                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------- |
| 0     | Carryover bug fixes (swipe resolution + mobile swipe gesture, Browse Puzzles) + live-deploy verification |
| 1     | URL routing + shareable `/puzzle/:id` links                                                              |
| 2     | Scrubber spike: trace format, engine, execution-derived ground truth — **go/no-go checkpoint**           |
| 3     | Scrubber UI                                                                                              |
| 4     | Scrubber content pipeline + volume                                                                       |
| 5     | Quiz upgrades: drag-and-drop interaction, Daily rating reveal, Rush escalation                           |
| 6     | Content calibration + quiz volume (~200 total puzzles)                                                   |
| 7     | Export/import UI + Lighthouse 90+                                                                        |
| 8     | Hardening + regression                                                                                   |

## v3 — Launch: get users

**Entry gate:** v2 Phase 8 done, and the decision to market Codoro (made — this roadmap assumes yes after v2).
**Exit state:** real users, real retention data, and a working feedback loop. First backend code — minimal and anonymous, no accounts.

| Phase | What                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3.0   | Launch-readiness: the v1 checks that only matter with real users — week-long storage-survival soak, fresh-user walkthrough (stranger solves a puzzle in ~10s with zero instructions), cross-device Daily verification, growth dashboards prebuilt in PostHog (day-2 return, session length, puzzles/session) |
| 3.1   | Minimal backend: Cloudflare Workers + D1/KV on the existing account. Anonymous leaderboard (Daily + Rush best scores, keyed on the stable anon ID from v2's backend-ready seams), server-rendered OG share cards for puzzle links. No auth, no PII, aggressive rate limiting since it's anonymous            |
| 3.2   | Distribution: launch posts (r/webdev, r/learnprogramming, HN Show, X), AI-generated reel/short videos (the backlog item — a scrubber solve is inherently watchable), SEO pass on puzzle pages                                                                                                                |
| 3.3   | Growth loop: in-app feedback channel, watch the dashboards, weekly content drops (the pipeline makes this cheap), fix what real users actually hit. **This phase produces the v4 gate evidence**                                                                                                             |

## v4 — Accounts & identity

**Entry gate:** v3 retention data says people come back on their own (day-2 return is the honest signal), and anonymous users are visibly hitting the ceiling — asking for cross-device sync, or the anonymous leaderboard is active enough that named identity matters.

| Phase | What                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.0   | Auth (Clerk) + the deferred v1 security block: disposable-email handling, session token storage, server-side authorization (no client-side admin checks), 2FA/OTP, rate limits, password hygiene |
| 4.1   | Progress sync: the versioned export format becomes the sync payload (the v2 seam); migration path from anonymous → account keeps rating and history                                              |
| 4.2   | Public identity: usernames, profiles, named leaderboards, streaks/badges. This is the social substrate multiplayer builds on                                                                     |

## v5 — Multiplayer

**Entry gate:** v4 shipped and there's an active player base — multiplayer with no one online is worse than no multiplayer.

| Phase | What                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.0   | Async duels first: challenge a friend by link — same puzzle set, compare time/accuracy when both have played. Cheapest possible multiplayer, no realtime infra, works even with a small player base, and every challenge link is an acquisition channel |
| 5.1   | Live head-to-head: realtime Rush-style races (Durable Objects + WebSockets on the existing Cloudflare stack), Elo-based matchmaking reusing the rating engine                                                                                           |
| 5.2   | Competitive structure: seasons, ladders, private rooms/clubs (classrooms and interview-prep groups are the obvious wedge)                                                                                                                               |

---

## Continuous tracks (not version-bound)

- **Content ops** — the pipeline runs every version; volume and calibration never stop mattering. More languages for the scrubber (Java/C traces) when demand justifies the tooling.
- **AI features (the unspecified backlog item)** — stays parked until defined as a concrete feature. The scrubber content pipeline is the current AI investment; candidates like AI-generated hints or "explain my mistake" belong in v3+ once real users show where they get stuck.

## Sequencing principles

1. **Users before infrastructure.** v1 built nine phases before an external user existed; that mistake isn't repeated. Every backend layer (v3 anonymous → v4 accounts → v5 realtime) is gated on evidence from the layer before.
2. **Each version is independently shippable.** If v3 shows nobody wants this, v4/v5 never get built and nothing was wasted on them.
3. **The engine boundary carries the whole roadmap.** Pure `engine/` + versioned storage is what lets multiplayer reuse the same rating, selection, and rush logic untouched.
