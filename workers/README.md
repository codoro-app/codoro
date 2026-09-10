# `workers/` — Codoro's Cloudflare Worker

The v5 backend: one Cloudflare Worker (Hono router), served at `/api/*` on
the same zone as the Pages-hosted SPA (`getcodoro.com` — same-origin, no
CORS, ever). D1 for storage. Clerk for auth (wired in T3, not yet in this
package as of T2).

See `docs/v5-build-plan.md` (the _what_) and
`docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md` (the
_how_, contracts, footguns) for the full picture. This file documents what
actually exists in this package: the schema, and how migrations get
applied.

## Schema

Defined in `migrations/0001_init.sql` (and evolved only by later numbered
migrations — see "Migration procedure" below). Every table, column by
column.

### `users`

The root identity row. Everything else FK-references it with
`ON DELETE CASCADE` — deleting a `users` row is the deletion mechanism for
the whole account (T13's account-deletion round-trip leans on this being
real, not just documented).

| Column                | Type      | Notes                                                                                     |
| --------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `clerk_user_id`       | `TEXT` PK | The Clerk `sub` claim — the only identity the API ever trusts.                            |
| `username`            | `TEXT`    | Unique, lowercase. `NULL` until claimed (T9).                                             |
| `username_changed_at` | `INTEGER` | Unix ms. Enforces the ≤3-changes-per-30-days quota (T9), not the rate limiter.            |
| `public_profile`      | `INTEGER` | `0`/`1`, default `0`. Governs `/u/:username` visibility and leaderboard display (T9/T10). |
| `linked_anon_id`      | `TEXT`    | The v2 `anonId`, linked on first sync push, for telemetry continuity.                     |
| `created_at`          | `INTEGER` | Unix ms.                                                                                  |

### `profiles`

The sync payload. **`payload` and `payload_bytes` are owned entirely by
`src/profileStore.ts`** — no other module in this Worker reads or writes
that column (S2 in the amendment; enforced by
`test/static/profileStorePayloadGuard.test.ts`, which greps `src/` for the
column's literal name outside that one file and fails on a hit).

| Column           | Type          | Notes                                                                                                                                                                                                                                                     |
| ---------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clerk_user_id`  | `TEXT` PK, FK | `REFERENCES users(clerk_user_id) ON DELETE CASCADE`.                                                                                                                                                                                                      |
| `revision`       | `INTEGER`     | Server-incremented. Optimistic-concurrency token for `PUT /api/profile` (T7) — not built by T2.                                                                                                                                                           |
| `schema_version` | `INTEGER`     | The client's `CURRENT_SCHEMA_VERSION` at write time. Never interpreted server-side.                                                                                                                                                                       |
| `payload`        | `BLOB`        | **Gzip-compressed**, compressed/decompressed inside `profileStore.ts` using `CompressionStream`/`DecompressionStream`. The wire contract (`PUT`/`GET /api/profile`) stays plain JSON on both ends — this column is the only place the compression exists. |
| `payload_bytes`  | `INTEGER`     | Compressed size in bytes, for the exit-trigger check below (S4).                                                                                                                                                                                          |
| `updated_at`     | `INTEGER`     | Server's own clock — never a client-supplied timestamp (a client clock never decides server ordering).                                                                                                                                                    |

### `scores` — the 90-day rolling window

One row per user/mode/day. Read by `GET /api/leaderboard?window=day`
(T10, not yet built). Pruned by a scheduled job on the cron trigger Phase
5.5 introduces — until then it simply grows, which is expected between
phases and must not become the permanent state.

| Column          | Type       | Notes                                                                                                                                       |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `clerk_user_id` | `TEXT`, FK | `REFERENCES users(clerk_user_id) ON DELETE CASCADE`.                                                                                        |
| `mode`          | `TEXT`     | `CHECK (mode IN ('daily','rush','boss'))`.                                                                                                  |
| `day`           | `TEXT`     | `YYYY-MM-DD`, UTC day key — the same function `DAILY_CALENDAR` uses (imported, never re-derived, per F15).                                  |
| `score`         | `INTEGER`  |                                                                                                                                             |
| `run_meta`      | `TEXT`     | JSON, bounded to 2 KB, display-only. **Never read by server logic** — no validation or trust is placed on its contents beyond the size cap. |
| `updated_at`    | `INTEGER`  | Server clock.                                                                                                                               |

Primary key: `(clerk_user_id, mode, day)` — this is what makes score writes
replay-safe (F12): a retried write for the same user/mode/day upserts, it
never duplicates. `idx_scores_board (mode, day, score DESC)` serves the
daily leaderboard query.

### `scores_best` — the all-time board

**S3, the correctness fix, not an optimization.** One row per user per
mode, never pruned. Read exclusively by `GET /api/leaderboard?window=all`.

Why this table exists at all: ranking the day-keyed `scores` table for
`window=all` (the pre-amendment design) let one strong player with many
good days occupy multiple top-ten slots — an all-time leaderboard must rank
one row per user, and a `GROUP BY` bolted onto `scores` is a query-time
patch over a schema that's structurally wrong. `scores_best` makes "one row
per user per mode" true by construction. Proved by
`test/scoresBest.test.ts`: seeds one user with ten winning days on the same
mode and asserts the all-time board contains that user exactly once, at
their max score.

| Column          | Type       | Notes                                                    |
| --------------- | ---------- | -------------------------------------------------------- |
| `clerk_user_id` | `TEXT`, FK | `REFERENCES users(clerk_user_id) ON DELETE CASCADE`.     |
| `mode`          | `TEXT`     | `CHECK (mode IN ('daily','rush','boss'))`.               |
| `score`         | `INTEGER`  | The best score ever recorded for this user/mode.         |
| `achieved_day`  | `TEXT`     | Which day the best score happened on (display purposes). |
| `updated_at`    | `INTEGER`  | Server clock, updated only when a new best is recorded.  |

Primary key: `(clerk_user_id, mode)`. `idx_scores_best_board (mode, score
DESC)` serves the all-time leaderboard query.

`src/db.ts`'s `recordScore()` writes both `scores` and `scores_best` in one
`db.batch()`, each with its own keep-best `ON CONFLICT ... DO UPDATE ...
WHERE excluded.score > <table>.score` — a conflicting row is only updated
when the new score is strictly greater, so a replayed write from the
client's retry queue (F12) can never regress a stored best.

### `email_prefs`

Per-category opt-in/out. Read (with defaults applied) and written by T12,
not yet built.

| Column             | Type          | Default | Why                                                                                                                                             |
| ------------------ | ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `clerk_user_id`    | `TEXT` PK, FK | —       | `REFERENCES users(clerk_user_id) ON DELETE CASCADE`.                                                                                            |
| `digest`           | `INTEGER`     | `0`     | Weekly digest. Off by default — unambiguously marketing, explicit opt-in.                                                                       |
| `streak`           | `INTEGER`     | `0`     | Streak-at-risk nudge. Off by default — also marketing under GDPR/PECR/CASL however friendly it feels.                                           |
| `challenge`        | `INTEGER`     | `1`     | Challenge-answered notify. On by default — transactional, a direct response to something the user initiated. Still per-category unsubscribable. |
| `unsubscribed_all` | `INTEGER`     | `0`     | The `all`-category unsubscribe token sets this.                                                                                                 |

### `reports`

Backs `POST /api/report` (T4a, not yet built) — **the only unauthenticated
write in the system**, by design (guest-first is law; most reporters won't
have accounts). This is deliberate, not an oversight:

- No `clerk_user_id` column. An authenticated variant is a v6 decision with
  its own design, not something to bolt on here "for later."
- No IP column, hashed or otherwise. Abuse control is the edge rate
  limiter; an IP is PII the project's PII practice does not permit keeping.
- `reason` is a fixed enum, enforced **both** by the `CHECK` constraint here
  **and** by request validation (Zod, at the route) — belt and braces on
  the one endpoint that accepts anonymous input.
- No free-text column exists anywhere in this table, in v5.

| Column        | Type      | Notes                                                                             |
| ------------- | --------- | --------------------------------------------------------------------------------- |
| `id`          | `TEXT` PK | UUID v4, server-generated.                                                        |
| `puzzle_id`   | `TEXT`    | Validated against the real content index before insert (T4a) — not trusted as-is. |
| `reason`      | `TEXT`    | `CHECK (reason IN ('wrong-answer','unclear','renders-broken','typo','other'))`.   |
| `app_version` | `TEXT`    |                                                                                   |
| `created_at`  | `INTEGER` |                                                                                   |

Index: `idx_reports_puzzle (puzzle_id, created_at DESC)`.

## Migration procedure

Migrations live in `migrations/*.sql`, numbered (`0001_init.sql`,
`0002_...sql`, ...) and applied in order via `wrangler d1 migrations
apply`:

```sh
pnpm run migrations:apply:dev          # wrangler d1 migrations apply DB --env dev
pnpm run migrations:apply:production   # wrangler d1 migrations apply DB --env production --remote
```

- **CI does not yet apply migrations to `dev` automatically.** T1's
  `deploy-dev` job deploys the Worker but does **not** currently run
  `migrations:apply:dev` — that wiring is explicitly out of scope for T2
  (a separate future task); until it lands, `dev` migrations are a manual
  step, same as production.
- **`production` apply is a deliberate manual step until launch**, on
  purpose — no CI job touches the production database in v5.
- Tests never touch a real database. `test/support/migrations.ts` loads
  the exact same `.sql` files via `readD1Migrations()` (wired into
  `vitest.config.ts`) and applies them to a local, in-memory D1 binding
  under `@cloudflare/vitest-pool-workers` — test state and deployed state
  come from the same files, never a copy.
- **Isolated migration tests, the client's `MIGRATIONS` convention
  verbatim**: each numbered migration gets a test that seeds a pre-state,
  applies that migration specifically, and asserts the post-state.
  Chain-only coverage (applying everything once and checking the final
  schema) is not acceptance — see `test/migrations.test.ts`'s migration
  0002 test, which seeds data under 0001, applies 0002, and asserts both
  the seeded data survived _and_ the new index exists.
- D1 enforces foreign-key constraints by default (verified directly in
  `test/migrations.test.ts`, not assumed from documentation) — cascading
  deletes and constraint-violation rejections are asserted with real
  inserts/deletes against a real (local, test) D1 binding, not just
  schema introspection.

## Storage ceiling — the exit trigger

Cloudflare Workers + D1 was confirmed against a Supabase/Postgres
challenge on 2026-08-31 (`docs/v5-build-plan.md`, amendment section A).
D1's ceiling is storage, not throughput. The exit trigger, carried here
**verbatim** from that amendment:

> **When to revisit — the trigger, not a vibe.** Migrate to Postgres
> behind Hyperdrive when **any** of these is observed:
>
> 1. `profiles` or `scores` crosses **3 GB** (30% of the cap — the point
>    at which a migration must be planned, not started in a panic).
> 2. Write p95 against D1 exceeds the number T14's load test records as
>    the acceptable ceiling (set that number in T14; it does not exist
>    yet).
> 3. A feature requires cross-user relational queries — friend graphs,
>    matchmaking, cohort analytics. **v7 is multiplayer, so this trigger
>    is expected to fire at v7's design session**, and that is the
>    scheduled place to reconsider, not v5.
>
> Estimated migration cost, recorded now so the trigger is honest: one
> session. Five tables, no ORM, all SQL confined to `db.ts`, and the
> schema is deliberately Postgres-portable.

(The amendment's trigger text names `profiles` and `scores`; S3's later
split makes `scores_best` — the unpruned, unbounded table — the more
relevant one to watch day to day, since `scores` is bounded by the 90-day
prune once Phase 5.5's cron lands. Both are still covered by "`profiles`
or `scores`" in spirit — T14 measures both `profiles` and `scores_best`
byte totals per S4, not just the two literally named above.)

**Current plan: Cloudflare's account is on the FREE plan**, not Workers
Paid, as of this task (deferred 2026-08-31→2026-09-10 amendment — see
`docs/v5-build-plan.md` section C-bis and
`docs/superpowers/plans/2026-08-31-v5-phase-5.0-coding-plan.md`'s Task 0
list for whichever cap is current when read). Verified free-plan limits:
D1 caps at **500 MB per database**, 10 databases per account, 5 GB account
total, 5M rows read/day, 100k rows written/day; Workers: 100k requests/day,
10 ms CPU/invocation. None of these bind during Phase 5.0 (server-only,
~40 lifetime visitors as of T1). Upgrading to Workers Paid ($5/mo) later is
an account-plan toggle, not a database migration — deferring it costs
nothing. Buy it when the first of: 5.2's in-Worker gzip (S1) measured
against the 10 ms CPU ceiling (the real trigger — not storage), prod D1
nearing 500 MB, or sustained traffic near 100k req/day.

## Rate limiting

Two `ratelimits` bindings (Cloudflare's GA rate-limiting binding, not the
legacy `unsafe` form), declared in `wrangler.jsonc`'s `dev`/`production`
envs: `RATE_LIMITER_PER_IP` and `RATE_LIMITER_PER_USER`. Both are real,
Durable-Object-backed fixed-window counters locally too (miniflare's
`RateLimiterObject`, confirmed by reading the installed package's source,
not assumed) — no cloud credentials needed to test this, same F5 property
D1 has.

**F7 finding:** the binding's real, typed contract
(`@cloudflare/workers-types`' `RateLimitOptions`) is `{ key: string }`
only — no per-call `limit`/`period` override, despite the local emulator
also accepting those fields as a testing convenience. So the numeric
policy (how many, over what window) is fixed **per binding**, in
`wrangler.jsonc`'s `simple: {limit, period}` block, not something a route
can set for itself. What varies per route is the bucket `key` — every
route gets its own prefix so two routes never share a counter — and
whether the per-user bucket applies at all, in `src/limits.ts`'s
`ROUTE_LIMITS` table (`{ perUser: boolean }`). A route that genuinely
needs a different number than the shared default gets a new, distinctly
named `ratelimits` binding, not a per-call override of an existing one.

`src/rateLimit.ts`'s `rateLimit(routeKey, limit)` middleware checks the
per-IP bucket (`CF-Connecting-IP`) on every request it mounts on, and the
per-user bucket too when `limit.perUser` is true and `clerkAuth()` (T3)
ran first and set a `userId`. Either bucket failing returns `429` with
`Retry-After: 60`. Both checks are independent by design: a single IP
juggling many accounts is still capped by the IP bucket; a single
compromised account fanned out over many IPs is still capped by the user
bucket.

This binding does **burst damping only** — 10s/60s fixed windows, counted
per Cloudflare location, not globally. It is deliberately not the source
of truth for any exact quota. "One `scores` row per user per mode per
day" is that table's own `PRIMARY KEY` (migration 0001), and holds
regardless of the rate limiter's existence —
`test/quotaIndependence.test.ts` proves this by calling `recordScore()`
directly, with no rate-limit middleware anywhere on the call path.

`ROUTE_LIMITS` was empty through T4 — proven instead against a throwaway
test app, `test/rateLimit.test.ts`, the same pattern T2's `db.ts` and T3's
`auth.ts` used before their first real caller existed. T4a's
`POST /api/report` is the first real consumer, and needed a number
stricter than the shared 100/60 default ("strict per-IP rate limiting" —
plan), which the binding-level design above says can't be a per-call
override — so T4a added a third binding, `RATE_LIMITER_REPORT_IP`
(5 requests/60s, `namespace_id` self-chosen as `77`, same "arbitrary,
account-unique integer" convention as `14`/`1983`), rather than retuning
the shared one underneath every future route.

## POST /api/report

Unauthenticated by design (T4a) — guest-first is law and most reporters
will not have accounts, so this is the only anonymous write in the system
and therefore its sharpest abuse surface. Body: `{ puzzleId, reason,
appVersion }`. No free-text field reaches storage, in any form:

- `reason` is checked twice, independently: `src/report.ts`'s Zod schema
  (`z.enum(REPORT_REASONS)`) and `reports`' own `CHECK` constraint
  (migration 0001). Both read from `REPORT_REASONS`
  (`shared/api-types.ts`), the one place the enum is written.
- `puzzleId` is checked against `VALID_PUZZLE_IDS`
  (`src/puzzleIds.generated.ts`), generated from the real
  `src/content/puzzles/**/*.json` files at typecheck/lint/test/deploy time
  (`workers/scripts/generatePuzzleIds.mjs`, wired into every relevant
  `package.json` script). **F7 finding:** the plan says "import the
  puzzleMeta module #82 created, do not duplicate it" — but that module
  (`src/content/index.ts`) is populated via a Vite virtual module
  (`virtual:codoro-puzzle-meta`, resolved by `vite.config.ts`'s
  `puzzleMetaPlugin`), which only exists inside the root Vite build.
  `workers/` is bundled by wrangler's esbuild, which has no knowledge of
  Vite plugins — a literal import of that module would fail to resolve
  the moment wrangler tried to bundle it. `generatePuzzleIds.mjs` reads
  the exact same source files `puzzleMetaPlugin` does, the same way, so
  there is still exactly one source of truth (the puzzle JSON files); this
  and that plugin are two independent readers of it, not two copies of
  derived data. The generated file is gitignored — regenerated fresh every
  run, never stale, same reasoning `.dev.vars` gets.
- `appVersion` is stored but never interpreted — a length bound only.

Rate limited per-IP only (`RATE_LIMITER_REPORT_IP`, see above) — no
`clerk_user_id`/IP column "for later" (migration 0001's `reports` table has
exactly five columns: `id`, `puzzle_id`, `reason`, `app_version`,
`created_at`); `test/report.test.ts` asserts the stored row's column set
directly, not just that the response looked right. No moderation UI, no
admin read endpoint — both are v6 decisions with a surface attached.
