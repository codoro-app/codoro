# Codoro v4 — build plan (accounts, identity, comeback channel)

v4 gives players an identity and — the part that actually serves retention — a **channel to call them back**. Login + sync alone retains no one; the game does that (v5's job). What accounts uniquely buy is cross-device continuity, named competition, and email re-engagement. All three are in scope; anything account-shaped that doesn't serve one of them is not.

**Strategic reframe, 2026-08-26 (direct user decision).** The launch moves behind v5. The honest reason, recorded: the current app plays like a flashcard exam, not a game — launching it now would spend the one-shot launch audience on a product that doesn't retain. So the sequence is now **v3 (build, done) → v4 (accounts) → v5 (make it a game people return to, then launch)**. Two consequences owned in writing:

1. **The roadmap's evidence gate for v4 is consciously waived.** v4 was gated on retention data proving demand for identity; that data cannot exist pre-launch. v4 opens on conviction, not evidence — a deliberate exception to sequencing principle 1, recorded here rather than papered over. Mitigation: v5 includes a closed beta that produces the retention evidence *before* the loud launch spends anything.
2. **v3 Phase 4 (anonymous-only backend) is superseded, not built.** With accounts landing before any public traffic, building an anonymous leaderboard API only to rewrite its identity story weeks later is throwaway work. The backend is built **once, authenticated from day one**, in this plan. Every v3 Phase 4 work item lands here (traceability table at bottom); guests keep the full local-first play experience.

**Entry gate: open** — `perf/content-metadata-lazy-load` merged, v3 declared build-complete (its 2b.8 QA pass and Thomas's device-verification backlog run in parallel with early v4 phases; they gate v5's launch tail, not this build).

## Locked decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Launch position | **After v5.** v3's launch machinery (readiness checks, scaling gate, distribution, growth loop) moves to v5's tail | Direct user decision, 2026-08-26. Launch when the game retains, not before. |
| Backend shape | **One backend: Cloudflare Workers + D1 on the existing account, authenticated from day one.** v3 Phase 4's anonymous-only layer is not built | Streamlined path, direct user decision 2026-08-26. No throwaway anonymous API. Rate limiting, plausibility validation, load testing carry over unchanged — an authenticated API still gets poked at. |
| Auth | **Clerk** (re-confirmed 2026-08-26 against Better Auth / Supabase Auth) | Buys the entire deferred v1 security block as managed product: 2FA/OTP, disposable-email handling, session/token storage, password hygiene. Free tier covers pre-launch and early growth. Accepted trade-offs: vendor dependency, JWT-verification wiring in Workers, real cost at scale — revisit only if pricing bites. **Server-side authorization stays ours**: Clerk authenticates; every Worker endpoint authorizes. |
| Guest-first is law | **An account is never required to play.** Local-first behavior is byte-identical signed out; account features are additive (sync, named leaderboard, email). Signup prompts appear only at value moments, frequency-capped | v2's local-first design is the app's scaling and resilience story; v4 must not quietly convert it into a login wall. A signup gate in front of a game nobody knows yet is a retention killer, not a feature. |
| Sync payload | **The versioned export format is the sync payload** — the seam v2 built deliberately | Roadmap v4.1 unchanged. One serialization, one schema-version story, one migration path; export/import tests double as sync-payload tests. |
| Email channel | **In scope** (direct user decision, 2026-08-26): streak-at-risk nudge, challenge-answered notify, weekly digest — via Resend from Workers, with preferences + one-click unsubscribe from day one | The comeback lever accounts uniquely enable, and the hook v5's retention mechanics plug into at launch. Without it v4 is infrastructure with no retention payoff. |
| Client bundle discipline | Clerk (and anything else v4 adds client-side) **stays off the play loop's critical chunks** — lazy-loaded at its own surfaces | The perf pass that just landed (PR #80 + lazy puzzle bodies) is not to be regressed by an auth SDK on boot. The posthog-js lesson generalizes. |
| Sizing | Phases sized in **Claude sessions**, same convention as v2/v3 | Unchanged. |
| Practices | Every binding practice from v3's "Coding practices carried from v2" applies, including practice 9 (server code holds the same bar) — plus a new one below for PII | Unchanged discipline, wider surface. |

**New binding practice — PII handling.** v4 is the first time real PII (email, at minimum) exists in this system. Rules: PII lives in Clerk, not D1, unless a feature forces otherwise (D1 stores Clerk user IDs, usernames, scores, sync blobs); no PII in telemetry events, ever (PostHog stays `identified_only` keyed on IDs, not emails); account deletion deletes server-side data verifiably; every new stored field is justified in the phase amendment that adds it.

## Phase map

| Phase | What | Est. sessions |
| --- | --- | --- |
| 4.0 | Backend foundation: `workers/` package, Clerk JWT verification, D1 schema + migrations, rate limiting, CI deploy | 2 |
| 4.1 | Client auth: Clerk React wiring, guest-first UX, account settings (incl. delete account) | 1–2 |
| 4.2 | Progress sync: export-format payload, anonymous→account migration, merge rules, multi-device | 2–3 |
| 4.3 | Public identity: usernames, profiles, named leaderboards (Daily/Rush/Boss), privacy controls | 2 |
| 4.4 | Edge OG meta injection (carried v3 Phase 4 item, unchanged) | 1 |
| 4.5 | Email re-engagement: Resend + domain auth, 3 templates, preferences/unsubscribe, cron scheduling | 1–2 |
| 4.6 | Hardening: load test + cost curve, authz test suite, `/legal` accounts delta, lawyer review engaged | 1–2 |

**Sequencing.** 4.0 first — everything else stands on it. 4.1 → 4.2 → 4.3 in order (no sync without sessions; no named leaderboard without usernames). 4.4 is independent after 4.0 and can interleave anywhere. 4.5 needs 4.1 (accounts to email) and its digest content improves after 4.3, but can start on the nudge/notify templates early. 4.6 closes the version and is only meaningful against the finished build. Thomas's v3 verification backlog (device regression, soak, PWA checks) runs in parallel throughout — none of it blocks v4 code, all of it blocks v5's launch tail.

## Phase 4.0 — Backend foundation (2 sessions)

**Build:**

1. **`workers/` workspace package**: TypeScript, `wrangler`, its own vitest suite, wired into root `pnpm validate` (typecheck + lint + tests) and CI deploy on merge — v3 Phase 4 item 1, verbatim. Shared API payload types in one package importable by client and worker; no drifting duplicates.
2. **D1 schema v1 + migrations discipline**: `users` (Clerk user ID PK, username nullable until 4.3, created_at), `profiles` (sync blob + client schema version + updated_at), `scores` (user_id, mode, day, score — one row per user/mode/day, upsert-keep-best). Server-side migrations get the same isolated-test convention as the client's `MIGRATIONS`.
3. **Clerk JWT verification middleware**: JWKS-based session-token verification on every authenticated route; explicit 401/403 split; forged/expired/aud-mismatch tokens covered by tests. Authorization checks (this user owns this row) live server-side only — the deferred v1 security item, closed structurally.
4. **Rate limiting**: per-IP (pre-auth) and per-user (post-auth), on Workers. Still load-bearing (v3's words) — burst-tested in 4.6, unit-tested now.

**DoD:**

- [ ] Worker deployed to a staging route from CI; `pnpm validate` runs the workers suite from a fresh clone
- [ ] Auth middleware rejects forged/expired/mismatched tokens (tested); authz helper enforces row ownership (tested)
- [ ] D1 migrations have isolated tests; schema documented in `workers/README.md`
- [ ] Rate limiter unit-tested for both keys; limits recorded as config, not magic numbers

## Phase 4.1 — Client auth, guest-first (1–2 sessions)

**Build:**

1. Clerk React provider + sign-in/up surface, themed to the arena palette (dark surfaces, lime accent) — custom-styled Clerk components, not a stock white modal in a dark game.
2. **Guest-first UX**: play loop untouched signed out. Signup prompts only at value moments — end of a boss clear, a streak milestone, viewing the leaderboard — with a hard frequency cap and a permanent quiet path ("maybe later" is respected, not nagged). The exact moments + cap: settle in the build prompt.
3. Settings: account section — signed-in state, sign out, **delete account** (calls a Worker endpoint that deletes D1 rows and the Clerk user; verifiably gone).
4. Bundle discipline: Clerk SDK lazy-loaded at auth surfaces only; play-path chunks unchanged (verified against the perf baseline, not asserted).

**DoD:**

- [ ] Signed-out play loop behaviorally and performance-identical (bundle diff + Lighthouse re-check against the perf/content-metadata-lazy-load baseline)
- [ ] Create → sign out → sign in → delete account round-trip verified on staging; deletion confirmed server-side
- [ ] Signup prompts appear only at the settled value moments, frequency cap tested
- [ ] `pnpm validate` green

## Phase 4.2 — Progress sync (2–3 sessions)

**Build:**

1. **Payload**: the versioned export format, unchanged — schema version travels with every push; the server stores the blob + version, never interprets fields it doesn't need to.
2. **Sync model**: push after meaningful boundaries (attempt/run end, debounced), pull on boot and sign-in. Fire-and-forget with a retry queue; offline behavior unchanged; the play loop never blocks on sync — the local-first lock, held.
3. **Anonymous → account migration**: first sign-in uploads the local profile; rating and history survive (the roadmap's promise); the v2 `anonId` is linked to the account for telemetry continuity.
4. **Merge rules** (the hard part — settle the detail in the build prompt, against real export fixtures): monotonic data merges (best scores = max, attempt history = append-by-id union, streaks = recomputed from merged history); true preferences = last-write-wins; **no silent data loss** — a merge that would discard attempts is a bug by definition. Property-style merge tests with real v9+ fixtures.
5. Conflict UX: silent for clean merges; the rare true conflict (two devices played offline simultaneously) resolves by merge, never by prompt — a game should not ask users to pick a winning save file.

**DoD:**

- [ ] Two-device test: play on A, sign in on B, B shows A's rating/history; play both offline, reconnect, merged state provably loses nothing (fixture-based test + real staging pass)
- [ ] Anonymous → account migration keeps rating + history, verified against a real pre-v4 export
- [ ] Airplane-mode pass: signed-in offline behavior identical to v3's
- [ ] Schema-version skew handled: older client vs newer blob and vice versa both defined and tested, not accidental

## Phase 4.3 — Public identity + named leaderboards (2 sessions)

**Build:**

1. **Usernames**: unique, case-insensitive, reserved-word + profanity denylist (allowlist thinking per the OD-2 lesson: strict charset, length bounds), rate-limited changes.
2. **Profile** (`/u/:username`, opt-in public): rating, streak, per-mode bests, badge slots (empty until v5 fills them). Private by default — settle default-vs-prompt in the build prompt.
3. **Named leaderboards**: Daily / Rush / Boss bests, keyed to accounts; participation is opt-out-able; guests see leaderboards read-only (a designed value moment, not a wall). Server plausibility validation carried from v3 Phase 4: score bounds per mode, one write per user/mode/day, upsert-keep-best.
4. Windows: daily + all-time now; seasons deliberately deferred to v5's reward systems.

**DoD:**

- [ ] Leaderboard live behind a flag on staging; out-of-bounds scores rejected (tested); a second account cannot write the first's rows (authz test)
- [ ] Username validation covered by tests incl. the denylist; profile opt-in/out verified
- [ ] Nothing beyond the chosen username is ever publicly displayed (checked against the PII practice)

## Phase 4.4 — Edge OG meta injection (1 session)

v3 Phase 4 item 5, carried unchanged: per-route and per-puzzle `<title>`/description/OG tags injected at the edge — covers `/challenge` (dynamic payload, unreachable by build-time prerender; the "until a v3 edge function exists" note comes due here). Per-puzzle OG **images** stay deferred unless trivially cheap — decide in the build prompt, record the decision.

**DoD:**

- [ ] Unfurls verified with real debuggers (Slack/Discord/X) against staging `/puzzle/:id` and `/challenge` URLs

## Phase 4.5 — Email re-engagement (1–2 sessions)

**Build:**

1. **Resend** via HTTP API from Workers; sending domain authenticated (SPF/DKIM on the getcodoro.com domain); Workers Cron triggers for scheduled sends.
2. **Three templates, no more**: streak-at-risk nudge, challenge-answered notification, weekly digest (your week in numbers + what's new). Plain, honest, dark-theme-friendly HTML; every template renders acceptably in the big clients.
3. **Preferences + one-click unsubscribe** from the first email ever sent: per-category toggles in Settings, `List-Unsubscribe` header, suppression respected server-side. Defaults (which categories are on at signup): settle in the build prompt with deliverability and consent-law caution — when in doubt, opt-in.
4. Telemetry: send/open-proxy/unsubscribe events (no PII in events — IDs only).

**DoD:**

- [ ] All three templates sent from staging and verified in real inboxes; unsubscribe works from the email itself and suppresses future sends (tested)
- [ ] No email ever goes to an unverified address; category defaults recorded in an amendment with reasoning
- [ ] Cron schedules deployed and observable

## Phase 4.6 — Hardening, cost, legal (1–2 sessions)

**Build:**

1. **Load test + cost curve** (carried v3 Phase 4 item 6): write path at spike rates against D1's real limits; rate-limit burst test proves the limiter holds; **cost curve recorded at 1×/10×/100×** expected load — including Clerk MAU and Resend volume, not just Cloudflare.
2. **Security pass**: authz test suite across every endpoint (user A vs user B), dependency audit, secrets hygiene, the PII practice checked against what actually got stored.
3. **`/legal` accounts delta**: privacy policy + ToS now cover real PII (email), sync storage, leaderboard display, marketing email. **The lawyer review carried from v3 Phase 3 is engaged during this phase** — one review covering accounts + email + sync + the eventual launch surface; it must land before v5's distribution tail, and it's calendar time, so it starts here, not there.
4. Account-deletion verification: delete → confirm D1 rows, Clerk user, and email suppression list entry are gone.

**DoD:**

- [ ] Load/burst numbers + 3-point cost curve recorded here as an amendment
- [ ] Authz suite green; zero endpoints without an ownership check
- [ ] `/legal` updated; lawyer review engaged with the full delta list in writing
- [ ] Deletion round-trip verified and documented

## Open design questions (settle in build prompts, not here)

- Signup-prompt value moments + frequency cap (4.1)
- Merge-rule detail per field + schema-skew policy (4.2)
- Profile public-by-default vs opt-in prompt (4.3)
- Per-puzzle OG images: build or re-defer (4.4)
- Email category defaults at signup (4.5)

## Traceability — v3 Phase 4 (superseded) and other carryovers

| Item | Source | Disposition here |
| --- | --- | --- |
| `workers/` workspace in `pnpm validate` + CI | v3 Phase 4 item 1 | **4.0**, verbatim |
| Leaderboard API + plausibility validation | v3 Phase 4 item 2 | **4.3**, authenticated instead of anonymous |
| Rate limiting (load-bearing) | v3 Phase 4 item 3 | **4.0** build, **4.6** burst-proof |
| Fire-and-forget client integration | v3 Phase 4 item 4 | **4.2** (sync) + **4.3** (leaderboard display) |
| Edge OG meta (covers `/challenge`) | v3 Phase 4 item 5 | **4.4**, unchanged |
| Load test + cost curve | v3 Phase 4 item 6 | **4.6**, widened to Clerk/Resend costs |
| `/legal` delta + lawyer review | v3 Phase 3 item 4 / Phase 4 item 7 | **4.6** — one review, full delta |
| v1 security block (2FA/OTP, disposable email, token storage, password hygiene) | v1 → v2 → v3 deferral chain | **Clerk** (4.0/4.1); server-side authorization ours (4.0) |
| Optimistic rendering ("first network round-trip") | v2 todo item 11 deferral | **4.3** leaderboard display — decide in build prompt |
| Anonymous leaderboard (as shipped surface) | v3 Phase 4 item 2 / roadmap 3.1 | **Not built** — superseded 2026-08-26, recorded at top |
