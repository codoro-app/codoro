# Codoro v5 — build plan (accounts, identity, comeback channel)

v5 gives players an identity and — the part that actually serves retention — a **channel to call them back**. Login + sync alone retains no one; the game does that (v6's job). What accounts uniquely buy is cross-device continuity, named competition, and email re-engagement. All three are in scope; anything account-shaped that doesn't serve one of them is not.

**Strategic reframe, 2026-08-26 (direct user decision).** The launch moves behind v6. The honest reason, recorded: the current app plays like a flashcard exam, not a game — launching it now would spend the one-shot launch audience on a product that doesn't retain. So the sequence is now **v3 (build, done) → v4 (UI/polish) → v5 (accounts) → v6 (make it a game people return to, then launch)**. Two consequences owned in writing:

1. **The roadmap's evidence gate for v5 is consciously waived.** v5 was gated on retention data proving demand for identity; that data cannot exist pre-launch. v5 opens on conviction, not evidence — a deliberate exception to sequencing principle 1, recorded here rather than papered over. Mitigation: v6 includes a closed beta that produces the retention evidence *before* the loud launch spends anything.
2. **v3 Phase 4 (anonymous-only backend) is superseded, not built.** With accounts landing before any public traffic, building an anonymous leaderboard API only to rewrite its identity story weeks later is throwaway work. The backend is built **once, authenticated from day one**, in this plan. Every v3 Phase 4 work item lands here (traceability table at bottom); guests keep the full local-first play experience.

**Renumbered 2026-08-27 (direct user decision).** This plan was written as v4 and is unchanged in substance — every decision, phase, DoD and traceability row below stands exactly as locked on 2026-08-26. What moved is its *position*: a UI/polish version (`docs/v4-build-plan.md`) now runs first, so accounts became v5, gamification/launch v6, and multiplayer v7. Reason recorded: every item on that list is client-only with no backend dependency and ships incrementally, and two of its items — the Settings rebuild and the app-feel/optimistic-rendering work — are surfaces this plan's 5.1 and 5.3 would otherwise build on top of and then have rebuilt underneath them. The companion implementation plan is `docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md` (T1–T13, renumbered with this file).

**Entry gate: v4 shipped** (was: open, on the 2026-08-26 waiver — the waiver itself is unaffected; only the thing immediately in front of this version changed). Also still true from that gate: `perf/content-metadata-lazy-load` merged and v3 declared build-complete. v3's 2b.8 QA pass and Thomas's device-verification backlog fold into v4 (see that plan's Phase 4.5); they gate v6's launch tail, not this build.

## Locked decisions

> **Amended 2026-08-31.** Read the amendment at the bottom of this file before acting on the table below. It confirms the Workers + D1 backend against a Supabase/Postgres challenge and adds a written exit trigger (S1–S4), sets the v5 security posture (2FA, password rules, token storage, authorization — including two requested items rejected on security grounds), and adds CodeRabbit and Strix to the pipeline. No phase or estimate changed.

| Decision | Choice | Why |
| --- | --- | --- |
| Launch position | **After v6.** v3's launch machinery (readiness checks, scaling gate, distribution, growth loop) moves to v6's tail | Direct user decision, 2026-08-26. Launch when the game retains, not before. |
| Backend shape | **One backend: Cloudflare Workers + D1 on the existing account, authenticated from day one.** v3 Phase 4's anonymous-only layer is not built | Streamlined path, direct user decision 2026-08-26. No throwaway anonymous API. Rate limiting, plausibility validation, load testing carry over unchanged — an authenticated API still gets poked at. |
| Auth | **Clerk** (re-confirmed 2026-08-26 against Better Auth / Supabase Auth) | Buys the entire deferred v1 security block as managed product: 2FA/OTP, disposable-email handling, session/token storage, password hygiene. Free tier covers pre-launch and early growth. Accepted trade-offs: vendor dependency, JWT-verification wiring in Workers, real cost at scale — revisit only if pricing bites. **Server-side authorization stays ours**: Clerk authenticates; every Worker endpoint authorizes. |
| Guest-first is law | **An account is never required to play.** Local-first behavior is byte-identical signed out; account features are additive (sync, named leaderboard, email). Signup prompts appear only at value moments, frequency-capped | v2's local-first design is the app's scaling and resilience story; v5 must not quietly convert it into a login wall. A signup gate in front of a game nobody knows yet is a retention killer, not a feature. |
| Sync payload | **The versioned export format is the sync payload** — the seam v2 built deliberately | Roadmap v5.1 unchanged. One serialization, one schema-version story, one migration path; export/import tests double as sync-payload tests. |
| Email channel | **In scope** (direct user decision, 2026-08-26): streak-at-risk nudge, challenge-answered notify, weekly digest — via Resend from Workers, with preferences + one-click unsubscribe from day one | The comeback lever accounts uniquely enable, and the hook v6's retention mechanics plug into at launch. Without it v5 is infrastructure with no retention payoff. |
| Client bundle discipline | Clerk (and anything else v5 adds client-side) **stays off the play loop's critical chunks** — lazy-loaded at its own surfaces | The perf pass that just landed (PR #80 + lazy puzzle bodies) is not to be regressed by an auth SDK on boot. The posthog-js lesson generalizes. |
| Sizing | Phases sized in **Claude sessions**, same convention as v2/v3 | Unchanged. |
| Practices | Every binding practice from v3's "Coding practices carried from v2" applies, including practice 9 (server code holds the same bar) — plus a new one below for PII | Unchanged discipline, wider surface. |

**New binding practice — PII handling.** v5 is the first time real PII (email, at minimum) exists in this system. Rules: PII lives in Clerk, not D1, unless a feature forces otherwise (D1 stores Clerk user IDs, usernames, scores, sync blobs); no PII in telemetry events, ever (PostHog stays `identified_only` keyed on IDs, not emails); account deletion deletes server-side data verifiably; every new stored field is justified in the phase amendment that adds it.

## Phase map

| Phase | What | Est. sessions |
| --- | --- | --- |
| 5.0 | Backend foundation: `workers/` package, Clerk JWT verification, D1 schema + migrations, rate limiting, CI deploy, puzzle-report endpoint | 2 |
| 5.1 | Client auth: Clerk React wiring, guest-first UX, account settings (incl. delete account), report-a-puzzle control | 1–2 |
| 5.2 | Progress sync: export-format payload, anonymous→account migration, merge rules, multi-device | 2–3 |
| 5.3 | Public identity: usernames, profiles, named leaderboards (Daily/Rush/Boss), privacy controls | 2 |
| 5.4 | Edge OG meta injection (carried v3 Phase 4 item, unchanged) | 1 |
| 5.5 | Email re-engagement: Resend + domain auth, 3 templates, preferences/unsubscribe, cron scheduling | 1–2 |
| 5.6 | Hardening: load test + cost curve, authz test suite, `/legal` accounts delta, lawyer review engaged | 1–2 |

**Sequencing.** 5.0 first — everything else stands on it. 5.1 → 5.2 → 5.3 in order (no sync without sessions; no named leaderboard without usernames). 5.4 is independent after 5.0 and can interleave anywhere. 5.5 needs 5.1 (accounts to email) and its digest content improves after 5.3, but can start on the nudge/notify templates early. 5.6 closes the version and is only meaningful against the finished build. Thomas's v3 verification backlog (device regression, soak, PWA checks) runs in parallel throughout — none of it blocks v5 code, all of it blocks v6's launch tail.

## Phase 5.0 — Backend foundation (2 sessions)

**Build:**

1. **`workers/` workspace package**: TypeScript, `wrangler`, its own vitest suite, wired into root `pnpm validate` (typecheck + lint + tests) and CI deploy on merge — v3 Phase 4 item 1, verbatim. Shared API payload types in one package importable by client and worker; no drifting duplicates.
2. **D1 schema v1 + migrations discipline**: `users` (Clerk user ID PK, username nullable until 5.3, created_at), `profiles` (sync blob + client schema version + updated_at), `scores` (user_id, mode, day, score — one row per user/mode/day, upsert-keep-best). Server-side migrations get the same isolated-test convention as the client's `MIGRATIONS`.
3. **Clerk JWT verification middleware**: JWKS-based session-token verification on every authenticated route; explicit 401/403 split; forged/expired/aud-mismatch tokens covered by tests. Authorization checks (this user owns this row) live server-side only — the deferred v1 security item, closed structurally.
4. **Rate limiting**: per-IP (pre-auth) and per-user (post-auth), on Workers. Still load-bearing (v3's words) — burst-tested in 5.6, unit-tested now.
5. **Puzzle-report endpoint** (todo item 18, moved here from v4 on 2026-08-27): `POST /api/report` taking a puzzle id, a reason from a **fixed enum** (not free text on the first cut), and the app version; writes to a `reports` table. **Unauthenticated by design** — guest-first is law and most reporters will not have accounts, which makes this the one write endpoint in the system that accepts anonymous input, and therefore its sharpest abuse surface. Consequences, not optional: strict per-IP rate limiting, a bounded payload with no free-form string that reaches storage unvalidated, puzzle id validated against real content, and no PII stored (the PII practice above binds here too). This is roughly an hour's work on top of the foundation; it does not get its own phase, and it does not get to grow a moderation UI in this version.

**DoD:**

- [ ] Worker deployed to a staging route from CI; `pnpm validate` runs the workers suite from a fresh clone
- [ ] Auth middleware rejects forged/expired/mismatched tokens (tested); authz helper enforces row ownership (tested)
- [ ] D1 migrations have isolated tests; schema documented in `workers/README.md`
- [ ] Rate limiter unit-tested for both keys; limits recorded as config, not magic numbers
- [ ] `/api/report` accepts a signed-out report, rejects an unknown puzzle id and an out-of-enum reason (tested), and is per-IP rate limited; stores no PII

## Phase 5.1 — Client auth, guest-first (1–2 sessions)

**Build:**

1. Clerk React provider + sign-in/up surface, themed to the arena palette (dark surfaces, lime accent) — custom-styled Clerk components, not a stock white modal in a dark game.
2. **Guest-first UX**: play loop untouched signed out. Signup prompts only at value moments — end of a boss clear, a streak milestone, viewing the leaderboard — with a hard frequency cap and a permanent quiet path ("maybe later" is respected, not nagged). The exact moments + cap: settle in the build prompt.
3. Settings: account section — signed-in state, sign out, **delete account** (calls a Worker endpoint that deletes D1 rows and the Clerk user; verifiably gone).
4. Bundle discipline: Clerk SDK lazy-loaded at auth surfaces only; play-path chunks unchanged (verified against the perf baseline, not asserted).
5. **Report-a-puzzle control** (todo item 18): a low-prominence control on the puzzle surface, posting to 5.0's endpoint with the puzzle id, the chosen reason, and the app version. Available signed-out — it is a content-quality channel, not an account feature, and gating it behind signup would defeat the point. Fire-and-forget with an honest confirmation; a failed post says so rather than silently pretending.

**DoD:**

- [ ] Signed-out play loop behaviorally and performance-identical (bundle diff + Lighthouse re-check against the perf/content-metadata-lazy-load baseline)
- [ ] Create → sign out → sign in → delete account round-trip verified on staging; deletion confirmed server-side
- [ ] Signup prompts appear only at the settled value moments, frequency cap tested
- [ ] Report control works signed-out, round-trips to a real row on the dev env, and surfaces a failed post rather than swallowing it
- [ ] `pnpm validate` green

## Phase 5.2 — Progress sync (2–3 sessions)

**Build:**

1. **Payload**: the versioned export format, unchanged — schema version travels with every push; the server stores the blob + version, never interprets fields it doesn't need to.
2. **Sync model**: push after meaningful boundaries (attempt/run end, debounced), pull on boot and sign-in. Fire-and-forget with a retry queue; offline behavior unchanged; the play loop never blocks on sync — the local-first lock, held.
3. **Anonymous → account migration**: first sign-in uploads the local profile; rating and history survive (the roadmap's promise); the v2 `anonId` is linked to the account for telemetry continuity.
4. **Merge rules** (the hard part — settle the detail in the build prompt, against real export fixtures): monotonic data merges (best scores = max, attempt history = append-by-id union, streaks = recomputed from merged history); true preferences = last-write-wins; **no silent data loss** — a merge that would discard attempts is a bug by definition. Property-style merge tests with real v9+ fixtures.
5. Conflict UX: silent for clean merges; the rare true conflict (two devices played offline simultaneously) resolves by merge, never by prompt — a game should not ask users to pick a winning save file.

**DoD:**

- [ ] Two-device test: play on A, sign in on B, B shows A's rating/history; play both offline, reconnect, merged state provably loses nothing (fixture-based test + real staging pass)
- [ ] Anonymous → account migration keeps rating + history, verified against a real pre-v5 export
- [ ] Airplane-mode pass: signed-in offline behavior identical to v3's
- [ ] Schema-version skew handled: older client vs newer blob and vice versa both defined and tested, not accidental

## Phase 5.3 — Public identity + named leaderboards (2 sessions)

**Build:**

1. **Usernames**: unique, case-insensitive, reserved-word + profanity denylist (allowlist thinking per the OD-2 lesson: strict charset, length bounds), rate-limited changes.
2. **Profile** (`/u/:username`, opt-in public): rating, streak, per-mode bests, badge slots (empty until v6 fills them). Private by default — settle default-vs-prompt in the build prompt.
3. **Named leaderboards**: Daily / Rush / Boss bests, keyed to accounts; participation is opt-out-able; guests see leaderboards read-only (a designed value moment, not a wall). Server plausibility validation carried from v3 Phase 4: score bounds per mode, one write per user/mode/day, upsert-keep-best.
4. Windows: daily + all-time now; seasons deliberately deferred to v6's reward systems.

**DoD:**

- [ ] Leaderboard live behind a flag on staging; out-of-bounds scores rejected (tested); a second account cannot write the first's rows (authz test)
- [ ] Username validation covered by tests incl. the denylist; profile opt-in/out verified
- [ ] Nothing beyond the chosen username is ever publicly displayed (checked against the PII practice)

## Phase 5.4 — Edge OG meta injection (1 session)

v3 Phase 4 item 5, carried unchanged: per-route and per-puzzle `<title>`/description/OG tags injected at the edge — covers `/challenge` (dynamic payload, unreachable by build-time prerender; the "until a v3 edge function exists" note comes due here). Per-puzzle OG **images** stay deferred unless trivially cheap — decide in the build prompt, record the decision.

**DoD:**

- [ ] Unfurls verified with real debuggers (Slack/Discord/X) against staging `/puzzle/:id` and `/challenge` URLs

## Phase 5.5 — Email re-engagement (1–2 sessions)

**Build:**

1. **Resend** via HTTP API from Workers; sending domain authenticated (SPF/DKIM on the getcodoro.com domain); Workers Cron triggers for scheduled sends.
2. **Three templates, no more**: streak-at-risk nudge, challenge-answered notification, weekly digest (your week in numbers + what's new). Plain, honest, dark-theme-friendly HTML; every template renders acceptably in the big clients.
3. **Preferences + one-click unsubscribe** from the first email ever sent: per-category toggles in Settings, `List-Unsubscribe` header, suppression respected server-side. Defaults (which categories are on at signup): settle in the build prompt with deliverability and consent-law caution — when in doubt, opt-in.
4. Telemetry: send/open-proxy/unsubscribe events (no PII in events — IDs only).

**DoD:**

- [ ] All three templates sent from staging and verified in real inboxes; unsubscribe works from the email itself and suppresses future sends (tested)
- [ ] No email ever goes to an unverified address; category defaults recorded in an amendment with reasoning
- [ ] Cron schedules deployed and observable

## Phase 5.6 — Hardening, cost, legal (1–2 sessions)

**Build:**

1. **Load test + cost curve** (carried v3 Phase 4 item 6): write path at spike rates against D1's real limits; rate-limit burst test proves the limiter holds; **cost curve recorded at 1×/10×/100×** expected load — including Clerk MAU and Resend volume, not just Cloudflare.
2. **Security pass**: authz test suite across every endpoint (user A vs user B), dependency audit, secrets hygiene, the PII practice checked against what actually got stored. **`POST /api/report` gets its own line here** — it is the only unauthenticated write in the system, so it is the one endpoint an authz suite structurally cannot cover; burst it, fuzz its payload bounds, and confirm the enum is enforced server-side rather than only in the client.
3. **`/legal` accounts delta**: privacy policy + ToS now cover real PII (email), sync storage, leaderboard display, marketing email. **The lawyer review carried from v3 Phase 3 is engaged during this phase** — one review covering accounts + email + sync + the eventual launch surface; it must land before v6's distribution tail, and it's calendar time, so it starts here, not there.
4. Account-deletion verification: delete → confirm D1 rows, Clerk user, and email suppression list entry are gone.

**DoD:**

- [ ] Load/burst numbers + 3-point cost curve recorded here as an amendment
- [ ] Authz suite green; zero endpoints without an ownership check
- [ ] `/legal` updated; lawyer review engaged with the full delta list in writing
- [ ] Deletion round-trip verified and documented

## Open design questions (settle in build prompts, not here)

- Signup-prompt value moments + frequency cap (5.1)
- Merge-rule detail per field + schema-skew policy (5.2)
- Profile public-by-default vs opt-in prompt (5.3)
- Per-puzzle OG images: build or re-defer (5.4)
- Email category defaults at signup (5.5)

## Traceability — v3 Phase 4 (superseded) and other carryovers

| Item | Source | Disposition here |
| --- | --- | --- |
| `workers/` workspace in `pnpm validate` + CI | v3 Phase 4 item 1 | **5.0**, verbatim |
| Leaderboard API + plausibility validation | v3 Phase 4 item 2 | **5.3**, authenticated instead of anonymous |
| Rate limiting (load-bearing) | v3 Phase 4 item 3 | **5.0** build, **5.6** burst-proof |
| Fire-and-forget client integration | v3 Phase 4 item 4 | **5.2** (sync) + **5.3** (leaderboard display) |
| Edge OG meta (covers `/challenge`) | v3 Phase 4 item 5 | **5.4**, unchanged |
| Load test + cost curve | v3 Phase 4 item 6 | **5.6**, widened to Clerk/Resend costs |
| `/legal` delta + lawyer review | v3 Phase 3 item 4 / Phase 4 item 7 | **5.6** — one review, full delta |
| v1 security block (2FA/OTP, disposable email, token storage, password hygiene) | v1 → v2 → v3 deferral chain | **Clerk** (5.0/5.1); server-side authorization ours (5.0) |
| Optimistic rendering ("first network round-trip") | v2 todo item 11 deferral | **5.3** leaderboard display — decide in build prompt |
| Skeleton loaders / caching | v2 todo items 9, 10 — deferred through v4 | **5.2/5.3** — the first real network latency in the app's history appears here; until then there was nothing to mask or cache (v4's decision table) |
| Report a puzzle | v2 todo item 18 — moved out of v4, 2026-08-27 | **5.0** (endpoint) + **5.1** (control) — unauthenticated by design, which makes it 5.6's sharpest abuse-surface check |
| Anonymous leaderboard (as shipped surface) | v3 Phase 4 item 2 / roadmap 3.1 | **Not built** — superseded 2026-08-26, recorded at top |

---

# Amendment — 2026-08-31: backend confirmed, security posture, review tooling

Three things settled in one session, recorded here rather than in a side document because all three change what Phase 5.0 and Phase 5.6 must build. Nothing above this line is retracted; where this amendment tightens a decision, it says which one.

## A. Backend: Cloudflare Workers + D1 — **confirmed**, with a written exit

The locked-decisions row "Backend shape" stands. It was re-opened on 2026-08-31 ("is Workers the right call if we have many users from day one, versus Supabase or similar?") and closed the same session in Workers' favour. The argument, recorded so it is not re-litigated from memory:

**Workers was never the scale risk.** Workers scales horizontally across Cloudflare's edge with no instance to size, no connection pool, and no cold start. Supabase's compute layer is a single vertically-scaled Postgres instance per project that you hand-size through compute tiers and that lives in one region — for a globally distributed player base that is a step backwards on both latency and elasticity. Moving to Supabase would have replaced the strongest part of this architecture to fix a weakness it does not have.

**D1's ceiling is storage, not throughput, and it was previously unrecorded.** This is the part of the challenge that was correct, and it is now closed by items S1–S4 below.

- Throughput is not a concern at any plausible v5 scale. D1 is single-threaded and sequential (~1,000 queries/sec at 1 ms/query per database). This app is local-first: IndexedDB is the source of truth and the server sees roughly 3–5 writes per user per day. 100k DAU is ~6 writes/sec average and well under 100/sec at peak — an order of magnitude of headroom. Leaderboard reads collapse toward zero under an edge cache, and D1 read replication is available at no extra storage or compute cost (`rows_read`/`rows_written` billing is unchanged with replicas).
- Storage is a real ceiling: **10 GB per database** on Workers Paid (1 TB per account, but multi-database sharding is manual and ugly). Two tables in this schema grow unboundedly against it. `profiles.payload` at ~50 KB per active user reaches 10 GB at roughly 200k users. `scores`, at one row per user/mode/day retained forever, reaches it inside a year at six-figure DAU. Neither appeared in this plan or in the F1–F17 register before today.

**Why not swap to Postgres now anyway.** Workers + Neon behind Hyperdrive is the sane Postgres option and would preserve Hono, Clerk, the same-origin `/api/*` decision and every endpoint contract — only `workers/src/db.ts` and the migrations change dialect. It was rejected for v5 on one concrete cost: `@cloudflare/vitest-pool-workers` gives the worker suite real D1 bindings locally, which is what makes T1's DoD ("fresh clone, no Cloudflare credentials, green") achievable. Postgres means a Docker service or PGlite in CI, and that trades a load-bearing property of this repo's validate discipline for headroom nothing in v5 needs.

**When to revisit — the trigger, not a vibe.** Migrate to Postgres behind Hyperdrive when **any** of these is observed:

1. `profiles` or `scores` crosses **3 GB** (30% of the cap — the point at which a migration must be planned, not started in a panic).
2. Write p95 against D1 exceeds the number T14's load test records as the acceptable ceiling (set that number in T14; it does not exist yet).
3. A feature requires cross-user relational queries — friend graphs, matchmaking, cohort analytics. **v7 is multiplayer, so this trigger is expected to fire at v7's design session**, and that is the scheduled place to reconsider, not v5.

Estimated migration cost, recorded now so the trigger is honest: one session. Five tables, no ORM, all SQL confined to `db.ts`, and the schema is deliberately Postgres-portable.

### Storage amendments to Phase 5.0 (S1–S4)

**S1 — the sync payload is stored compressed.** `profiles.payload` becomes a gzip-compressed `BLOB`, compressed and decompressed **in the Worker**, not the client. The API contract is unchanged: `PUT /api/profile` still takes JSON and `GET /api/profile` still returns JSON, so Phase 5.2's merge work, its fixtures and F11's 256 KB cap (which continues to apply to the **decompressed** JSON) are all untouched. Compression is done server-side rather than client-side specifically to keep the sync engine and its tests free of an encoding concern; the CPU cost is a few milliseconds on a payload this size. A `payload_bytes` column records the compressed size so S4's observability has something to sum. Expected effect: roughly a 3× increase in the user ceiling before the cap binds.

**S2 — the blob lives behind a store interface.** All access to `profiles.payload` goes through one module, `workers/src/profileStore.ts`, exposing `get(userId)` / `put(userId, blob, meta)` / `delete(userId)` and nothing else. D1-backed today; the migration to R2 (unlimited, cheap, no egress fee, and a keyed blob store is exactly what a sync payload is) is then a swap behind that interface with no schema break and no caller changes. This is the single highest-leverage item in S1–S4: the payload is the only field in the schema with unbounded per-user growth and no natural retention policy.

**S3 — `scores` gets a retention policy in migration 0001, not later.** The table splits in two:

- `scores` — the rolling window: user/mode/day rows, retained **90 days**, pruned by a scheduled job on the same Workers Cron trigger Phase 5.5 introduces for email.
- `scores_best` — one row per user/mode, all-time best, never pruned.

This also fixes a latent correctness bug in the schema above, which is the reason it cannot wait: `idx_scores_alltime ON scores (mode, score DESC)` serves `window=all` by scanning per-user-per-**day** rows, so a single strong player with ten good days occupies ten of the top ten. An all-time leaderboard must rank one row per user. `scores_best` makes that structural instead of a `GROUP BY` bolted on later, and shrinks the all-time index to one row per user per mode.

**S4 — size is observed, not remembered.** T14's load test records current `profiles` and `scores_best` byte totals alongside its latency numbers, and `workers/README.md` carries the exit trigger above verbatim. A ceiling nobody measures is a ceiling nobody notices.

**F18 (new footgun): the 10 GB wall is silent until it isn't.** D1 does not degrade gracefully at the cap — writes fail. The only defences are the ones above, and the only warning is a number somebody looked at.

## B. Security posture for v5

v5 is this project's first server, first auth, and first PII. The requirements below were raised on 2026-08-31; four are adopted, two are **rejected on security grounds** and recorded as rejected so they are not reintroduced as "we said we'd do this."

### Adopted

**B1 — Two-factor authentication: TOTP + backup codes, optional per user.** Delivered by Clerk (multi-factor is configured in the Clerk dashboard; strategies are authenticator app / TOTP, SMS code, and backup codes, with passkeys counting as multi-factor in themselves).

> **Corrected 2026-08-31, same session: MFA is plan-gated and Clerk's free tier does not have it.** Checked on the pricing page: the free **Hobby** plan lists MFA, SMS codes, passkeys, allowlist/blocklist and custom session lifetime as *not included*, fixes the session lifetime at 7 days, and requires Clerk branding on the prebuilt UIs. **Pro (~$20/month billed annually, ~$25 monthly) is the entry point for any 2FA at all**, on top of which the 50,000-monthly-retained-user free allowance still applies. Two consequences. (1) The Pro seat is a **Phase 5.1 cost, not a Task 0 cost** — 5.0 is server-only and builds fine against a Hobby Development instance, so the spend defers by roughly two sessions with nothing lost. (2) Hobby's mandatory Clerk branding collides with 5.1's "custom-styled Clerk components, not a stock white modal in a dark game" — another reason the Pro decision lands at 5.1 rather than being deferred past it. If 2FA is dropped from v5 scope, Hobby covers everything else in this plan and the line item disappears; that is a live option, not a hidden assumption.

- **TOTP and backup codes only. SMS is deliberately excluded**: it requires a Clerk paid plan for production use, and SIM-swap makes it the weakest available second factor. Excluding it costs nothing and removes an attack path.
- **Optional, never required.** Clerk can require MFA instance-wide with a single toggle; we do not use it. This is a puzzle game with guest-first as law — a mandatory second factor in front of an account that stores nothing but puzzle history is conversion damage in exchange for no meaningful risk reduction. Revisit only if a role ever exists that can affect other users' data.
- Surfaced in the Settings account section built in 5.1, alongside sign-out and delete-account.

**B2 — Password rules: delegated to Clerk, configured explicitly, NIST-shaped.** Minimum length set in the Clerk dashboard, and **compromised-password rejection enabled** (a breach-corpus check is worth more than every complexity rule combined). Explicitly **not** adopted: forced rotation, and character-class complexity requirements — both are contrary to NIST SP 800-63B guidance and push users toward predictable mutations. Clerk's exact password-policy controls are a **T0 verification item**: confirm in the dashboard what is configurable on the current plan and record the settings chosen, rather than assuming this paragraph is accurate (F7 applies to auth vendors too).

**B3 — Rate limiting.** No change to T4, which already covers per-IP (pre-auth) and per-user (post-auth) burst damping on every route, with exact quotas enforced in D1 where the limiter's 10/60-second window cannot reach. One addition: sign-in and sign-up brute-force protection is **Clerk's** responsibility, not the Worker's — the Worker never sees a credential. Confirm at T0 what Clerk's lockout behaviour actually is and record it, so nobody later builds a limiter for a surface we do not own.

**B4 — Automated security review in CI (see section C).**

### Rejected, with reasons

**R1 — "Client-side admin check": rejected as stated, and there is no admin role in v5.** A client-side check is a UI affordance — it decides what to render, never what is permitted. Any check that runs in the browser is one devtools session away from being false. This is already law here as **I5** ("server-side authorization is ours"), and Phase 5.0's report endpoint is explicitly forbidden from growing a moderation UI in this version, so v5 ships **no admin surface at all**. If and when one exists (v6 moderation is the likely first), the enforcement point is a server-side role check on every privileged endpoint, tested by the authz suite the same way user A vs user B is; hiding a button is presentation, and is never counted as a control. Recorded as **I9** in the implementation plan.

**R2 — "Session token in localStorage": rejected.** `localStorage` is readable by any script that executes on the origin, so a single XSS — from a dependency, an inline snippet, a future user-generated field — hands an attacker a session token that works from anywhere until it expires. Clerk's default is the correct design and we keep it: the long-lived session lives in an **httpOnly, Secure, SameSite cookie** the page's JavaScript cannot read, and `getToken()` hands out a short-lived JWT held in memory for the lifetime of a request. That default is precisely why the **same-origin `/api/*` on the Pages zone** decision (locked in T0) is worth what it costs — an `api.` subdomain would have made the cookie path awkward as well as buying CORS forever. **No v5 code writes an authentication token to `localStorage`, `sessionStorage`, or IndexedDB.** Recorded as **I10**, with a grep-able test.

Note what this does *not* forbid: the app's existing local-first play state stays in IndexedDB exactly as it is. The rule is about credentials, not data.

## C. Automated security review tooling

Two tools were requested by name. Both are adopted, at different points in the pipeline, and neither replaces the 5.6 security pass — they feed it.

**C1 — CodeRabbit: AI review on every PR.** A GitHub app that reviews pull requests. Plan reality, checked 2026-08-31: the **Free** plan covers unlimited public *and private* repositories but is **PR summarisation only** (full reviews are available through the IDE extension and CLI), with agentic PR review starting at **Pro, ~$24/dev/month annually**. `codoro-app/codoro` is private, so free means summaries.

Decision: **enable Free immediately** (zero cost, zero risk, useful summaries on a repo where PRs are large), and **buy one Pro seat for the duration of v5 only** — roughly 2–3 months. The justification is specific rather than general: v5 is the first server code, the first auth code and the first PII in this project's history, written mostly solo, and a second reviewer on exactly those PRs is the cheapest defect insurance available. Cancel the seat when 5.6 closes; re-buy for v7's multiplayer surface if it still earns it. Record the actual monthly cost in the 5.6 cost curve alongside Clerk and Resend.

**C2 — Strix: agentic penetration testing against the dev env.** Apache-2.0, open source ([usestrix/strix](https://github.com/usestrix/strix)); runs autonomous agents that exercise a *running* target and validate findings with proof-of-concept exploits, covering the OWASP Top 10 (injection, XSS, broken access control, SSRF, CSRF, JWT attacks, race conditions, API flaws). It runs via CLI or a GitHub Actions workflow, needs Docker and an LLM provider API key, and can take a live URL or an OpenAPI spec as its target.

This is **DAST, not SAST** — it needs something deployed to attack — so it does **not** belong on per-PR CI. It has two scheduled homes:

1. **End of Phase 5.0**, pointed at the dev env, targeting `POST /api/report` specifically. That is the only unauthenticated write in the entire system and therefore the one endpoint the 5.6 authz suite structurally cannot cover; an agent that actually throws malformed enums, oversized bodies and forged puzzle ids at a live instance is the right instrument for it.
2. **Phase 5.6**, pointed at the whole API surface with a valid token for one test account, as an input to the security pass. Findings get triaged into the phase, not auto-trusted — a proof-of-concept is evidence, not a work order.

**Binding rule, not a preference: Strix is only ever pointed at `codoro-dev`.** Never production, never any host this project does not own. Running an autonomous exploitation agent against infrastructure you do not control is unlawful in most jurisdictions regardless of intent. The dev env is the target, always, and the workflow must not accept a target URL from an untrusted input.

**C3 — the unglamorous controls, which catch more than either of the above.** Enabled at T0, all free:

- **Dependabot alerts + version updates** on the repo (free for private repositories).
- **`pnpm audit`** as a CI step in the same job as `pnpm validate`; a new high-severity advisory fails the build.
- **Secret scanning with push protection** — verify at T0 what is actually available for a private repo on the current GitHub plan; if it is gated, add **gitleaks** as a CI step instead, which is free and plan-independent. A leaked `sk_live_` Clerk secret or a Resend key is the single highest-severity failure available to this project, and it is prevented by a pre-push check, not by a pentest.
- Worker secrets set via `wrangler secret put` only — never in `wrangler.jsonc`, never in a `.env` that is not gitignored. `.dev.vars` stays out of git; `.dev.vars.example` carries names and no values.

## C-bis. What v5 actually costs per month, so it is not a surprise

Recorded here because three separate decisions above each added a line item, and nobody had summed them.

| Item | Cost | When it starts |
| --- | --- | --- |
| Cloudflare Workers Paid | $5/mo | Task 0 — the free tier caps D1 at 500 MB and 10 databases, which the whole S1–S4 analysis assumes away |
| Clerk Pro | ~$20/mo annual (~$25 monthly) | **Phase 5.1**, and only if 2FA stays in scope (B1) |
| CodeRabbit Pro, one seat | ~$24/mo | Task 0, for the v5 window only; cancelled at 5.6 (C1) |
| Resend | $0 on the free tier, then ~$20/mo | Phase 5.5 — free tier is ample pre-launch |
| Strix | $0 (Apache-2.0) + LLM tokens per run | End of 5.0, and 5.6 |

So roughly **$30/month during 5.0**, rising to **~$50–75/month** through the rest of v5, falling back to ~$25–30 once the CodeRabbit seat is cancelled. Clerk's 50,000-MRU free allowance means the per-user cost stays zero far past launch. These are the numbers the 5.6 cost curve extends to 10× and 100×, not replaces.

## D. Consequences for the phase map

No phase is added and no estimate changes. What changes inside them:

| Phase | Added by this amendment |
| --- | --- |
| T0 (pre-code) | Clerk password policy configured and **recorded** (MFA config moves to 5.1 — it needs Pro, see B1); Clerk lockout behaviour confirmed; CodeRabbit Free enabled and one Pro seat bought; Dependabot on; secret-scanning availability checked (else gitleaks); LLM key for Strix stored as an Actions secret |
| 5.0 | S1 (compressed payload) · S2 (`profileStore` boundary) · S3 (`scores` / `scores_best` split in migration 0001) · I9 + I10 with tests · Strix run #1 against the dev env's report endpoint · `pnpm audit` in CI |
| 5.1 | **Clerk Pro seat bought here** (MFA is not on Hobby, and Hobby forces Clerk branding on the prebuilt UIs); MFA configured to TOTP + backup codes; enrolment surfaced in the Settings account section |
| 5.3 | All-time leaderboard reads `scores_best`; the day board reads `scores`. One row per user on the all-time board, asserted by a test |
| 5.5 | The 90-day `scores` prune runs on the cron trigger this phase introduces |
| 5.6 | Strix run #2 across the full API · S4 size numbers in the load-test record · CodeRabbit seat cost in the cost curve · the exit trigger reviewed against real numbers |
