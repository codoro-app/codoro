# v5 accounts — detailed implementation plan (2026-08-27)

Companion to `docs/v5-build-plan.md` (the _what_ and the DoDs). This is the _how_: task-by-task, with exact files, contracts, schemas, and — the point of this document — the mistakes each task is positioned to make, named before they're made. Sized to sessions, one task = one commit (or a small commit series), `pnpm validate` green at every commit, same as every plan before it.

**Read first, every session:** the Invariants below and the Footgun Register at the bottom. A task that violates an invariant is wrong even if its tests pass.

**Renumbered 2026-08-27 (same day it was written).** This was `2026-08-27-v4-accounts-implementation-plan.md`; accounts moved from v4 to v5 when a UI/polish version was inserted ahead of it (`docs/v4-build-plan.md`). Nothing in the substance changed — the tasks, contracts, schemas, decisions and the F1–F17 register are byte-for-byte the ones written on 2026-08-26/27; only the version labels and phase numbers shifted (4.x → 5.x, v5 → v6, v6 → v7). Clerk/Cloudflare **package** versions on the platform-unknowns line are untouched and are not roadmap versions.

## Invariants (violating any of these is a defect, not a style choice)

| #   | Invariant                                                                                                                                                            | Concrete test                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | **Guest-first**: an account is never required to play. Every route, every mode, every puzzle works signed-out exactly as it does today                               | The whole existing test suite passes untouched with no Clerk key configured; app boots and plays with `VITE_CLERK_PUBLISHABLE_KEY` unset      |
| I2  | **Local-first lock**: the play loop never blocks on the network. Sync, leaderboard, email are fire-and-forget enhancements                                           | Airplane-mode pass: signed-in + offline behaves exactly like v3                                                                               |
| I3  | **Bundle discipline**: no v5 dependency lands on the play path's critical chunks. The metadata/body lazy-load work (#82) is the baseline; regressing it is a defect  | `pnpm build` chunk diff recorded per task that touches the client; modulepreload count in `dist/index.html` unchanged (2, zero puzzle chunks) |
| I4  | **PII rules**: emails live in Clerk only; D1 stores Clerk user IDs, usernames, scores, sync blobs; telemetry carries IDs, never emails; deletion verifiably cascades | grep-able: no `email` column in any D1 migration; no `posthog.identify` call with an email argument anywhere                                  |
| I5  | **Server-side authorization is ours**: Clerk answers "who is this", every endpoint answers "may they do this" itself                                                 | Authz test per endpoint: user A's token against user B's resource → 403/404, tested, not assumed                                              |
| I6  | **Never trust the client**: every write is bounds-checked server-side (score ranges, payload sizes, schema versions). Allowlists over blocklists — the OD-2 lesson   | Worker-side validation tests reject out-of-bounds/oversized/malformed input per endpoint                                                      |
| I7  | **No fake numbers** (carried from v2): nothing displayed that isn't computed from real data                                                                          | Unchanged                                                                                                                                     |
| I8  | **SW never caches `/api/*`** — a cached auth response or sync payload is silent data corruption                                                                      | `navigateFallbackDenylist` + runtime-caching config exclude `/api/`; a test asserts the generated SW config does (see F13)                    |

## Architecture (one picture, in words)

- **Client**: the existing Vite/React SPA on Cloudflare Pages. Gains: Clerk (lazy), a sync engine (`src/sync/`), leaderboard views, account settings. IndexedDB stays the source of truth for play; the server holds a _replica_ for sync and the _minimal_ state that must be shared (scores, usernames).
- **API**: `workers/` — one Cloudflare Worker, Hono router, served at **`/api/*` on the Pages zone** (locked in Task 0: same-origin means no CORS, ever; an `api.` subdomain buys CORS forever and nothing else). Stateless; D1 for storage; Clerk JWT verification per request (networkless).
- **Clerk**: hosted auth. Two instances, **Development** and **Production** — with different keys, different domains, different user tables. Mixing them is Footgun F1.
- **D1**: single database (per env: `codoro-dev`, `codoro-prod`). Tables: `users`, `profiles`, `scores`, `email_prefs`. No KV unless a load test proves a cache is needed (locked in the build plan).
- **Resend**: outbound email over HTTPS from the Worker; Workers Cron for scheduled sends.

Token flow: client `useAuth().getToken()` → `Authorization: Bearer <session JWT>` → Worker verify with `{ jwtKey: CLERK_JWT_KEY, authorizedParties: [...] }` (networkless, JWT public key pinned via env — see T3 for the current entry-point name) → `sub` claim = Clerk user ID = the only identity the API ever trusts.

**Environment naming, said once.** The Cloudflare `dev` env (`codoro-dev` D1 + Clerk Development instance) **is** the "staging" the build plan's DoDs refer to. There is no third environment. Wherever `docs/v5-build-plan.md` says _staging_, this plan says _dev env_; they are the same box.

## API contract (complete — extend it here first, code second)

All routes JSON; all errors `{ error: string }` with correct status; all authenticated routes take the Bearer token; every route rate-limited (per-IP pre-auth, per-user post-auth).

| Method/Path                         | Auth         | Body / Query                                                         | Returns                                                      | Notes                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                   | none         | —                                                                    | `{ ok, version }`                                            | deploy sanity + uptime checks                                                                                                                                                                                                                                    |
| `PUT /api/profile`                  | required     | `{ schemaVersion, payload, clientUpdatedAt, baseRevision, anonId? }` | `{ revision }` or `409 { revision, payload, schemaVersion }` | sync push; optimistic concurrency via `baseRevision` (see T7); payload = the versioned export blob; size cap 256 KB (F11); `anonId` written once, first non-null wins; `clientUpdatedAt` is advisory (skew diagnostics) — the server stamps its own `updated_at` |
| `GET /api/profile`                  | required     | —                                                                    | `{ revision, schemaVersion, payload, updatedAt }` or `404`   | sync pull                                                                                                                                                                                                                                                        |
| `DELETE /api/account`               | required     | —                                                                    | `204`                                                        | deletes D1 rows + Clerk user + Resend suppressions; idempotent                                                                                                                                                                                                   |
| `POST /api/username`                | required     | `{ username }`                                                       | `{ username }` / `409` / `422`                               | claim/change; charset allowlist `^[a-z0-9_]{3,20}$` after lowercasing; reserved+profanity list; ≤3 changes/30d                                                                                                                                                   |
| `GET /api/users/:username`          | none         | —                                                                    | public profile or `404`                                      | only if that user opted in; never more than username + stats                                                                                                                                                                                                     |
| `POST /api/privacy`                 | required     | `{ publicProfile }`                                                  | `{ publicProfile }`                                          | the single opt-in switch: governs `/u/:username` visibility **and** whether the leaderboard shows your username or `anon`. Default off (`public_profile = 0`)                                                                                                    |
| `POST /api/scores`                  | required     | `{ mode, day, score, runMeta }`                                      | `{ accepted, best }`                                         | upsert-keep-best, one row per user/mode/day; server bounds per mode; `runMeta` capped at 2 KB and never read by server logic; idempotency via deterministic key (F12)                                                                                            |
| `GET /api/leaderboard`              | optional     | `?mode=&day=&window=day\|all`                                        | `{ top: [...], me?: { rank, score } }`                       | `me` only when authenticated; usernames only for opted-in users, else `anon` (rank is still real — opting out hides the name, not the row); `window=all` ignores `day`; seasons deliberately deferred to v6                                                      |
| `POST /api/email/prefs`             | required     | `{ digest?, streak?, challenge? }`                                   | `{ prefs }`                                                  | per-category toggles                                                                                                                                                                                                                                             |
| `GET /api/email/unsubscribe?token=` | signed token | —                                                                    | HTML confirmation                                            | one-click, no login required (F16); token = HMAC of user+category, not guessable; category ∈ `digest` \| `streak` \| `challenge` \| `all` (`all` sets `unsubscribed_all`)                                                                                        |

**Shared types** live in `workers/shared/api-types.ts`, imported by both sides via the pnpm workspace — never duplicated. Adding a field = edit that file first, then both compile errors guide the rest.

## D1 schema (migration 0001 — written once, evolved only by numbered migrations with isolated tests)

```sql
CREATE TABLE users (
  clerk_user_id TEXT PRIMARY KEY,
  username      TEXT UNIQUE,               -- lowercase; NULL until claimed
  username_changed_at INTEGER,             -- unix ms; change throttling
  public_profile INTEGER NOT NULL DEFAULT 0,
  linked_anon_id TEXT,                     -- v2 anonId, for telemetry continuity
  created_at    INTEGER NOT NULL
);
CREATE TABLE profiles (
  clerk_user_id TEXT PRIMARY KEY REFERENCES users(clerk_user_id) ON DELETE CASCADE,
  revision      INTEGER NOT NULL,          -- server-incremented, optimistic concurrency
  schema_version INTEGER NOT NULL,         -- client CURRENT_SCHEMA_VERSION at write
  payload       TEXT NOT NULL,             -- the export-format JSON blob
  updated_at    INTEGER NOT NULL
);
CREATE TABLE scores (
  clerk_user_id TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('daily','rush','boss')),
  day           TEXT NOT NULL,             -- YYYY-MM-DD (UTC day key, same as DAILY_CALENDAR)
  score         INTEGER NOT NULL,
  run_meta      TEXT,                      -- JSON, bounded, display-only
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (clerk_user_id, mode, day)
);
CREATE INDEX idx_scores_board ON scores (mode, day, score DESC);
CREATE INDEX idx_scores_alltime ON scores (mode, score DESC);  -- window=all; the day-keyed index cannot serve it
CREATE TABLE email_prefs (
  clerk_user_id TEXT PRIMARY KEY REFERENCES users(clerk_user_id) ON DELETE CASCADE,
  digest INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  challenge INTEGER NOT NULL DEFAULT 1,
  unsubscribed_all INTEGER NOT NULL DEFAULT 0
);
```

Notes: no email column anywhere (I4). **Foreign keys, resolved (checked 2026-08-26):** D1 enforces FK constraints on every query and migration by default — equivalent to `PRAGMA foreign_keys = ON` — and because D1 wraps each query in an implicit transaction you _cannot_ turn it off mid-query; the only lever is `PRAGMA defer_foreign_keys = on|off`, which defers the _check_ but does **not** stop `ON DELETE CASCADE` from firing. Consequence for us: the cascade in these tables is the deletion mechanism, not a nicety (T13's deletion check leans on it), and no migration may reach for `defer_foreign_keys` as a shortcut. Still assert it in a migration test — verify, don't assume (F7). `run_meta` is never read by server logic (display-only), so it is size-capped (2 KB) and schema-free by design, stated here so nobody "just quickly" starts trusting it (I6).

## Task 0 — accounts, keys, environments (Thomas, ~1 hour, before any code)

Nothing in this task is code, and every later task silently fails without it.

1. **Clerk**: create the application; note that Clerk gives you a **Development instance** (keys `pk_test_…`/`sk_test_…`) and a **Production instance** (`pk_live_…`/`sk_live_…`) with _separate user tables and separate JWKS keys_. Copy, per instance: Publishable key, Secret key, **JWKS public key** (API keys page → "JWT public key" / PEM) — the JWKS key is what makes Worker verification networkless. Production instance requires the real domain (getcodoro.com) and its DNS records — do this early, DNS is calendar time.
2. **Cloudflare**: create `codoro-dev` and `codoro-prod` D1 databases; note their IDs. Worker addressing is **locked: `/api/*` route on the Pages zone** (same-origin: no CORS at all, cookies never involved, one domain) — not an `api.` subdomain, which would buy CORS forever. Pick two rate-limiter `namespace_id`s (per-IP, per-user) while you're in the dashboard — they are account-unique integers you choose, not generated (T4).
3. **Resend**: create account, add getcodoro.com as sending domain, publish SPF + DKIM (+ DMARC `p=none` to start) DNS records. Verification is calendar time — start it now even though email is T12.
4. **Secrets hygiene**: client gets ONLY `VITE_CLERK_PUBLISHABLE_KEY` (the `VITE_` prefix makes it public by definition — never prefix a secret with it, F2). Worker secrets (`CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, `RESEND_API_KEY`, `UNSUB_HMAC_SECRET`) go in `.dev.vars` locally (gitignored — add it in T1) and `wrangler secret put` per env for real. Nothing secret in `wrangler.jsonc`, nothing secret in the repo, ever.

## Phase 5.0 — foundation

### T1 — `workers/` scaffold + validate + CI (1 session)

Files: `workers/package.json`, `workers/wrangler.jsonc` (two envs: `dev`, `production` — bindings: `DB` (D1), `ratelimits` (T4), vars: `ENVIRONMENT`, `APP_ORIGIN`; secrets listed in a comment, set out-of-band), `workers/src/index.ts` (Hono app: `/api/health` only), `workers/src/env.d.ts`, `workers/shared/api-types.ts`, `workers/vitest.config.ts` using **`@cloudflare/vitest-pool-workers`** (tests run inside workerd with real D1/miniflare bindings — not jsdom, not node), `.dev.vars.example`, root `package.json`/`pnpm-workspace.yaml` wiring so `pnpm validate` runs the workers typecheck+lint+tests, CI job deploying `dev` env on merge to main.

Versions, checked 2026-08-26 (confirm the numbers at install, not the names — F7): `@cloudflare/vitest-pool-workers` **is** the current, official package for this (latest `0.22.x`; it also ships `readD1Migrations()`, which T2 uses). Wrangler must be **≥ 4.36.0** for the stable `ratelimits` binding config T4 needs. Hono is on v5 (`4.13.x`).

Dependency decision, made here once: **Hono** (router + middleware chain, tiny, TS-first, built for Workers). One dependency, justified by three middlewares (auth, rate limit, validation) that raw `fetch` handlers would reimplement badly. Zod already exists in the repo for content validation — reuse it for request validation; do not add a second validator.

DoD: `pnpm validate` green from fresh clone with no Cloudflare credentials (worker tests use local bindings only, F5); `curl /api/health` on the deployed dev env returns `{ok:true}`; CI deploy proven by a dashboard-visible deployment.

Footguns for this task: F5 (validate must not require cloud creds), F6 (wrangler env drift), F13 (add `/api/` to the SW denylist _now_, in the same PR that creates the route space, not when the first bug reports arrive).

### T2 — D1 schema + migrations discipline (same session as T1 if it fits, else its own)

Files: `workers/migrations/0001_init.sql` (the DDL above), `workers/src/db.ts` (typed query helpers only — no ORM; D1's prepared statements + the shared types are enough at 4 tables), `workers/test/migrations.test.ts`, **`workers/README.md`** (the schema, table by table, plus the migration procedure — the build plan's 5.0 DoD names this file specifically; a schema documented only in a SQL file is not documented).

Process: migrations applied via `wrangler d1 migrations apply` (CI applies to dev; production apply is a deliberate manual step until launch); tests load them with `readD1Migrations()` from the vitest pool so test state and deployed state come from the same files. The **isolated migration test** convention carries over from the client verbatim: each numbered migration gets a test that seeds the pre-state, applies, asserts the post-state — chain-only coverage is not acceptance.

DoD: migration test green under vitest-pool-workers; FK enforcement asserted by a test (insert a `scores` row for a non-existent user → constraint error; delete a user → cascade observed); `workers/README.md` documents every table and column; a second migration (any no-op change) dry-runs the process end-to-end once so migration #2 isn't the first time the machinery runs in anger.

### T3 — auth middleware (1 session)

Files: `workers/src/auth.ts`, `workers/test/auth.test.ts`.

Implementation: networkless token verification from **`@clerk/backend`** with `{ jwtKey: env.CLERK_JWT_KEY, authorizedParties: [env.APP_ORIGIN] }`. Entry-point name, checked 2026-08-26: on the **Core 3** line (`@clerk/backend` v3, current `3.16.x`) the old `verifyToken()` / `verifyAccessToken()` / `verifySecret()` trio is consolidated into a single **`verify()`**; `verifyToken()` is the Core 2 (v2) name. Install v3, use `verify()`, and re-read the installed major's reference before writing the call (F7) — the options object (`jwtKey`, `authorizedParties`, `clockSkewInMs`) is the stable part, the function name is not. Token from `Authorization: Bearer` only — **never from cookies** (same-origin route makes Clerk's `__session` cookie reachable; ignoring it is deliberate: cookie-auth on an API invites CSRF, bearer-only doesn't, F3). On success attach `{ userId: claims.sub }` to context; unknown-but-valid users are lazily inserted into `users` on first authenticated write (not on read — reads shouldn't create rows).

Tests (the ones that catch real mistakes): expired token → 401; token signed by a different key (generate a throwaway keypair in-test) → 401; wrong `azp` → 401; malformed/missing header → 401; valid token, someone else's resource → 403/404 (the I5 fixture other tasks will reuse); clock-skew tolerance documented (Clerk tokens are short-lived — do not "fix" intermittent 401s by widening skew, fix the client's `getToken()`-per-request pattern, F4).

DoD: all above green; middleware is the _only_ place a token is ever read; `authorizedParties` comes from env, not a literal.

### T4 — rate limiting (small; pairs with T3)

Files: `workers/src/rateLimit.ts`, config table in `workers/src/limits.ts` (route → {perIp, perUser} numbers — config, not magic constants), tests.

Implementation — **resolved 2026-08-26, the binding is the primary path**: Cloudflare's rate limiting binding went **GA on 2025-09-19**. It is part of the Workers runtime with **no additional charge** (you pay Workers requests + CPU only), so it is not gated behind a plan upgrade — free and paid both. Config lives in `wrangler.jsonc` as a `ratelimits` array (`{ name, namespace_id, simple: { limit, period } }`, `namespace_id` a self-chosen account-unique integer, Wrangler ≥ 4.36.0); the API is `const { success } = await env.LIMITER.limit({ key })`. The `unsafe` binding form is legacy — do not use it.

Three constraints that shape the design, not footnotes:

| Constraint                                                                            | Consequence here                                                                                                       |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `simple.period` must be **10 or 60 seconds**                                          | The binding expresses burst limits only. Anything with a longer window is not a rate limit, it is a quota.             |
| Counters are **per Cloudflare location**, not global                                  | A user hitting two colos gets two buckets. Acceptable for abuse damping; unacceptable for anything that must be exact. |
| Explicitly "permissive, eventually consistent, **not an accurate accounting system**" | Never make a correctness rule depend on it.                                                                            |

So: the binding handles per-IP and per-user _burst_ damping on every route. Every **exact** limit is enforced in D1 instead, where the constraint already lives — `≤3 username changes/30d` via `username_changed_at` (T9), one score row per user/mode/day via the primary key (T10), email send caps via `email_prefs` read-at-send (T12). A Durable Object counter is **not** the fallback it was written as; it is only warranted if a globally-exact _short-window_ limit ever appears, and none does in v5. If that changes, record the decision and the reason.

DoD: burst test locally (loop 2× the limit) → 429 with `Retry-After`; per-user and per-IP keys independently tested; a test proving the D1-enforced quotas hold _without_ the limiter (they must not be co-dependent); limits config-reviewed against the load numbers T14 will produce (revisit then).

## Phase 5.1 — client auth

### T5 — Clerk in the client, measured (1–2 sessions)

Files: `src/auth/AuthProvider.tsx` (lazy boundary), `src/auth/useAuthToken.ts`, `src/auth/api.ts` (the single fetch wrapper every API call goes through — token attach, timeouts, error taxonomy; nobody else calls `fetch` to `/api/*`), Settings account section, sign-in surface.

The package is **`@clerk/react`** — resolved 2026-08-26: Clerk renamed the React SDK from `@clerk/clerk-react` at **Core 3**; `@clerk/react` is the current line (latest `6.14.x`) and `@clerk/clerk-react` is the Core 2 name, still published at `5.61.x` but not where new work goes. Install `@clerk/react` v6, pin the major, and pair it with `@clerk/backend` v3 in the Worker (T3) — mixing a Core 2 client with a Core 3 backend is a support conversation nobody wants. Key: `VITE_CLERK_PUBLISHABLE_KEY`; **when unset, the entire auth module renders the signed-out experience and mounts nothing Clerk** — that's I1's test hook and what keeps CI/fresh-clones green with no key.

Bundle rule made concrete: ClerkProvider mounts _inside a lazily-loaded shell_ (own chunk) rather than at the root. Play routes must not import it. After wiring, record in the amendment: main-chunk size delta (target ~0), `dist/index.html` modulepreload list unchanged, and the network waterfall on `/practice` signed-out (clerk-js must not appear). If holding Clerk out of the root breaks its session restoration UX, the fallback design is: root-level _dynamic_ import gated on a `codoro:has-account` localStorage hint, so only known-account devices pay the boot cost — decide by measurement, record the numbers (F8).

Sign-up value moments (settle exact copy in-session, the mechanism here): trigger points = boss clear, 7-day streak, leaderboard view, stats page second visit; one prompt per trigger type _ever_, global cooldown 7 days, permanent "don't ask again" respected via local flag. All prompts are dismissible in one tap and never interrupt an in-progress puzzle.

Delete account: Settings → confirm (type username) → `DELETE /api/account` → local state _kept_ (their device, their data — deleting the account doesn't nuke local play history; say so in the UI).

DoD: I1 suite pass with key unset; bundle numbers recorded **and a Lighthouse re-run on `/practice` signed-out against the #82 baseline** (the build plan's 5.1 DoD asks for both — a chunk diff alone doesn't prove the boot didn't get slower); create→signout→signin→delete verified against the dev env, with **deletion confirmed server-side** (D1 rows gone, Clerk user gone — queried, not inferred from a 204); prompts' frequency-cap unit-tested.

## Phase 5.2 — sync

### T6 — merge engine, pure and alone (1 session — no I/O, no network, the hardest logic in v5)

Files: `src/sync/merge.ts` + `merge.test.ts` (client-side module; the server never merges — it stores and versions, the client owns merge, keeping the server dumb and the logic testable in one place).

Merge contract, per top-level field of the export format (write the table into the module's doc comment; every field of `CURRENT_SCHEMA_VERSION`'s shape must appear — a new field without a merge rule is a compile-time error via an exhaustive `Record<keyof Profile, MergeRule>`):

- attempts / run histories: **union by stable id**, then re-sort; never drop.
- ratings + streaks + mastery: **recompute from merged history** where derivable; where not (rushStats/bossStats/missionStats bests), **max/latest per sub-field** (bests = max, `lastRunAt` = max, counts = max — counts are monotonic on any one device but not summable across devices without double-count risk; max is the no-lie floor; state this trade-off in the doc comment).
- settings/preferences: latest `clientUpdatedAt` wins.
- anonId: keep local.
- unknown fields (older client, newer payload): **preserved verbatim, never stripped** — round-trip unknown keys (F9).

**Schema-skew policy — decided here, not deferred** (the build plan's 5.2 open question). The server never interprets `schemaVersion`; the client compares the pulled blob's version to its own `CURRENT_SCHEMA_VERSION` and takes exactly one of three branches:

| Pulled blob vs client                            | Action                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blob < CURRENT`                                 | Run the existing client `MIGRATIONS` chain over the blob **before** merging. Same code path as an old IndexedDB or an old import file — no sync-specific migrator.                                                                                                                                     |
| `blob === CURRENT`                               | Merge normally.                                                                                                                                                                                                                                                                                        |
| `blob > CURRENT` (stale app, newer device wrote) | **Read-only sync**: do not merge, do not push, never overwrite the server. Keep playing locally; surface a one-line "another device is on a newer version — reload to update" notice; resume sync after the app updates. Losing an offline session's data to a stale tab is the failure this prevents. |

The `blob > CURRENT` branch is the one that will be tempting to skip because it "can't happen"; it happens the first time someone leaves a tab open across a deploy.

Property tests: merge(a, a) = a; merge(a, b) = merge(b, a) for the union/max fields; merge never decreases an attempts count or a best; fixtures from _real_ exports (one fresh install, one long-lived profile, one post-mission profile).

DoD: exhaustive `Record<keyof Profile, MergeRule>` compiles (a new profile field without a rule fails typecheck); all three skew branches tested in both directions; unknown-key round-trip test (F9); zero imports from `src/storage`, `fetch`, or Clerk in `merge.ts` — the module stays pure.

### T7 — sync endpoints (server half, 1 session)

`PUT/GET /api/profile` per the contract. Optimistic concurrency: client sends `baseRevision` (the revision it last pulled); server accepts iff `baseRevision === current revision` (atomic via a conditional `UPDATE … WHERE revision = ?` — check `meta.changes`, F10), else `409` with the current server state; the client merges (T6) and retries with the new base. Payload cap 256 KB (F11); schema-version recorded, never interpreted server-side.

Row creation, stated so it isn't rediscovered per endpoint: the `users` row is lazily inserted on first authenticated **write** (T3); `profiles` is created by the first `PUT`; `email_prefs` is read with the schema defaults applied when the row is absent (`COALESCE`, or insert-on-first-read of Settings — pick one in T12 and use it everywhere). `anonId` is written from the first `PUT` that carries one and never overwritten. `clientUpdatedAt` is stored nowhere and trusted for nothing — it rides along for skew telemetry only; `profiles.updated_at` is the server's own clock (F4's sibling: never let a client clock decide a server ordering).

DoD: conflict path tested (two writers from the same base — exactly one wins, loser gets 409 + current state); cap enforced with a real 257 KB payload test; authz fixture from T3 reused; `anonId` first-write-wins tested.

### T8 — sync orchestration (client half, 1–2 sessions)

Files: `src/sync/engine.ts`, `src/sync/queue.ts`, tests.

Behavior: pull on boot when signed in (non-blocking — the app renders from IndexedDB immediately; if the pull's merge changes state, it flows through the normal storage listeners); push debounced (~5s) after profile-mutating boundaries (attempt recorded, run ended, settings changed — the same boundaries storage already writes at); retry queue with exponential backoff, capped, persisted (survives reload), drained on `online` event. Every failure path degrades to exactly-v3 behavior silently (I2). Telemetry: `sync_push`/`sync_pull`/`sync_conflict` counts, no payload contents.

**First-sign-in migration is just the ordinary flow**: local profile exists + server 404 → push local as revision 1; server profile exists + fresh device → pull then merge (empty local merges cleanly by T6's laws). No special-cased "migration wizard" code path to rot (the design win of making merge total). Link `anonId` in the same first push.

DoD: airplane pass (I2); reload-with-pending-queue test; two-real-devices pass against dev env recorded in the amendment; a `sync_conflict` actually provoked and observed resolving; **anonymous → account migration replayed against a real pre-v5 export file** (rating and attempt history present and equal afterwards — the build plan's 5.2 promise, checked against an actual old export, not a synthetic fixture); both schema-skew branches (T6) exercised end-to-end against the dev env, not only in unit tests.

## Phase 5.3 — identity

### T9 — usernames (1 session)

Server: `POST /api/username` — lowercase, `^[a-z0-9_]{3,20}$` (allowlist, I6), reserved list (`admin`, `codoro`, `api`, `support`, `mod`, route names…) + a small profanity list in `workers/src/usernameDenylist.ts` (curated, testable, no fetch-time dependency); uniqueness via the DB constraint (catch the constraint violation → 409 — do not pre-check-then-insert, that's a TOCTOU race, F14); ≤3 changes per 30 days via `username_changed_at`.

Client: claim UI in Settings/at first leaderboard join; optimistic nowhere — the server answer is the answer. Same Settings section carries the privacy switch (`POST /api/privacy`): **profile private by default**, opt-in only, and the copy says plainly what turning it on publishes (username + stats on `/u/:username` and on the leaderboard). No prompt, no nudge, no pre-checked box — the build plan's "private by default" resolved as default-off with a switch, not as a public-by-default-with-a-prompt.

The 30-day change quota lives in D1 (`username_changed_at`), **not** in the rate limiter — the limiter's window tops out at 60 seconds and its counters are per-location (T4).

DoD: charset/length allowlist tested at both bounds; reserved + profanity denylist tested (including case and leading/trailing whitespace); **concurrent claim of the same username → exactly one 200, one 409** (the TOCTOU test, F14 — asserted against the DB constraint, not a pre-check); 4th change inside 30 days → 429/422 and the row unchanged; privacy switch verified both directions, including that flipping it off removes the name from an already-published board row.

### T10 — leaderboards + profiles (1–2 sessions)

Server: `POST /api/scores` (bounds per mode from a shared config — daily: score domain of the daily result; rush/boss: max streak/depth physically possible from the run rules; anything outside → 422 logged with a counter), day key = the **same UTC day function the Daily calendar already uses, imported from shared code, not re-derived** (F15); `GET /api/leaderboard` top-50 + caller rank (two indexed queries).

Windows: `day` and `all` only (the build plan's two), each with its own index — `idx_scores_board` serves the daily board, `idx_scores_alltime` the all-time one; seasons are v6's, deliberately.

Client: leaderboard on Daily/Rush/Boss results + a board page, **behind a flag until the DoD below is met** (the build plan's 5.3 DoD: live behind a flag on staging); fire-and-forget submit piggybacking the sync boundaries; opted-out users render as `anon` but keep their real rank.

**Optimistic rendering, decided here** (the carried v2 todo-11 deferral): the board is _not_ optimistic — cold load shows a skeleton, then real rows; a stale board is a fake number (I7). Your own just-submitted score _is_ shown immediately in the `me` slot from local state, marked pending until the server confirms, because that one number is real locally. That's the whole rule.

Public profile `/u/:username` behind the `public_profile` opt-in (T9).

DoD: leaderboard flag-gated and live on the dev env; bounds tests per mode (including a `runMeta` over 2 KB → 422); rank correctness test against a seeded board, both windows; **user B's token cannot write or overwrite user A's score row** (authz test, I5); airplane pass unchanged; nothing but username+stats in any public payload (I4 grep).

## Phase 5.4 — T11: edge OG meta (1 session)

Cloudflare **Pages Functions middleware** on the existing Pages project (not the API worker — it must run where the HTML is served): intercept `/puzzle/:id` and `/challenge`, `HTMLRewriter` the `<title>`/`<meta og:*>`/`<meta name="description">` into the SPA shell from the puzzle metadata index (built into the function bundle at deploy — it's the same `puzzleMeta` module #82 created; import it, don't duplicate it). `/challenge` decodes its URL payload server-side with the _same_ decoder the client uses (shared module), and treats it as untrusted input (I6): decode failures render the generic card, never an error.

**Per-puzzle OG images — decided: re-deferred.** v5 ships one static branded card (`og-default.png`) for every route; only `<title>`/`<meta description>`/`og:title`/`og:description` are dynamic. Reason: a per-puzzle image means a rendering path (Workers + an image lib, or a build-time generator for 214 puzzles growing weekly) whose whole payoff is a prettier thumbnail on a link nobody is clicking yet — the launch is behind v6. Revisit in v6.1, where named tracks give a card something real to say. The build plan's "unless trivially cheap" bar: it isn't; this is the recorded decision, not a re-deferral to another prompt.

DoD: unfurl checks (Slack/Discord/X debuggers) against the dev deployment recorded with screenshots in the amendment; `/challenge` with a deliberately corrupted payload renders the generic card and a 200, never an error page (I6).

## Phase 5.5 — T12: email (1–2 sessions)

Worker: `workers/src/email/` — Resend HTTP API; templates as TS functions returning HTML+text (no template engine dependency); Workers Cron (`triggers.crons`) for streak-nudge and weekly digest scans.

**Challenge-answered, decided:** v5 ships the template, the preference, the unsubscribe path, and a **dev-only manual trigger** (an authenticated `?dry=0` send-to-self used to satisfy the build plan's "all three verified in real inboxes" DoD). It has no production trigger in v5, because challenges are client-side links until v7.0 stores them server-side — inventing a trigger to make the box tick would mean inventing server-stored challenges, which is v7 work. Recorded, not fudged: the _channel_ ships complete in v5; the _event_ arrives in v7.0.

**Category defaults, decided** (the build plan's 5.5 open question; these are the schema's DEFAULTs, and the reasoning belongs next to them):

| Category                      | Default | Why                                                                                                                                                             |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `digest` (weekly)             | **off** | Unambiguously marketing. Explicit opt-in, no argument.                                                                                                          |
| `streak` (at-risk nudge)      | **off** | Also marketing under GDPR/PECR/CASL however friendly it feels. "When in doubt, off" applies literally.                                                          |
| `challenge` (answered notify) | **on**  | Transactional: a direct response to a thing this user initiated (they sent the challenge). Still per-category unsubscribable, still carries `List-Unsubscribe`. |

If the lawyer review (T15) disagrees with the `challenge` classification, the fix is one `DEFAULT` in a migration — flag it there rather than pre-emptively crippling it.

Rules with teeth: every send checks `email_prefs` + `unsubscribed_all` server-side immediately before sending (not at enqueue time); **and checks the address is verified** — send only to the Clerk primary email whose `verification.status` is `verified`, re-read at send time, never to an unverified or stale address (build plan 5.5 DoD, and the thing that keeps the sending domain's reputation alive); unsubscribe link = `GET /api/email/unsubscribe?token=<HMAC(user,category,secret)>` — works logged-out, one click, no confirmation dance (F16); `List-Unsubscribe` + `List-Unsubscribe-Post` headers on every send; email addresses fetched from Clerk at send time, never stored in D1 (I4).

DoD: real sends to a test inbox from dev env for all three templates; unsubscribe round-trip verified from the email itself (and from the `all` token); an unverified-address account provably receives **nothing** (tested); cron dry-run mode (`?dry=1` guarded to dev) showing who _would_ receive, for safe iteration; cron triggers deployed and observable (a per-run counter/log line, so a silently-not-firing schedule is visible); suppression respected in a test.

## Phase 5.6 — hardening

### T13 — authz + security sweep (1 session)

Table-driven authz test: every route × {no token, bad token, valid token/foreign resource} — the matrix lives in one test file so a new route failing to register there is conspicuous. Dependency audit (`pnpm audit` + a read of what Clerk/Hono actually pull in). Secrets grep. I4 grep. Header pass (CSP already exists from v3 — extend for Clerk's script/frame origins _narrowly_, not with a wildcard, F17).

**Deletion round-trip, verified here** (build plan 5.6 item 4 — T5 proves the UX works, this proves the data is gone): create an account, give it a username, a synced profile, score rows in all three modes, an email pref row and a suppression entry; `DELETE /api/account`; then query each surface directly — D1 `users`/`profiles`/`scores`/`email_prefs` rows gone via the FK cascade, Clerk user gone via the Admin API, Resend suppression entry gone. Assert the endpoint is idempotent (second call → 204, no 500).

DoD: authz matrix green with zero routes unregistered; deletion round-trip evidenced with the actual query output pasted into the amendment; CSP diff reviewed line by line, no wildcard host anywhere.

### T14 — load test + cost curve (1 session)

Scripted (k6 or autocannon from CI runner) against the dev env: profile PUT at spike rates, leaderboard reads, burst past the limiter. Record: p95s, D1 write ceiling observed, 429 behavior, and the **1×/10×/100× monthly cost table across Workers/D1/Clerk MAU/Resend** — the launch-spike math from the old scaling gate, now with real numbers. Revisit T4's limits with the data.

### T15 — legal + close-out (1 session + external calendar time)

`/legal` delta (accounts, sync storage, leaderboard display, email); engage the lawyer review with the complete delta list (it blocks v6's distribution, so it starts now); the version-closing amendment: every DoD box in `docs/v5-build-plan.md` checked or written-waived, numbers included. Put the `challenge`-category default (T12) on the lawyer's list explicitly — it is the one consent call this plan made on its own reasoning.

## Coverage — every build-plan DoD has a task

Checked against `docs/v5-build-plan.md` on 2026-08-26. If a DoD bullet ever lands here with no task, that's the gap this table exists to make loud.

| Phase | Build-plan DoD bullet                                                                  | Task                                                |
| ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 5.0   | Worker deployed to staging from CI; `pnpm validate` from fresh clone                   | T1                                                  |
| 5.0   | Auth middleware rejects forged/expired/mismatched; authz helper enforces ownership     | T3                                                  |
| 5.0   | D1 migrations isolated-tested; schema documented in `workers/README.md`                | T2                                                  |
| 5.0   | Rate limiter unit-tested both keys; limits as config                                   | T4                                                  |
| 5.1   | Signed-out play loop behaviorally + perf identical (bundle diff **+ Lighthouse**)      | T5                                                  |
| 5.1   | create → sign out → sign in → delete round-trip; deletion confirmed server-side        | T5 (UX + confirmation), T13 (full cascade evidence) |
| 5.1   | Prompts only at settled value moments; frequency cap tested                            | T5                                                  |
| 5.1   | `pnpm validate` green                                                                  | every task, by convention                           |
| 5.2   | Two-device test; offline-both, reconnect, provably lossless                            | T8                                                  |
| 5.2   | Anonymous → account migration keeps rating + history vs a real pre-v5 export           | T8                                                  |
| 5.2   | Airplane-mode pass identical to v3                                                     | T8 (I2)                                             |
| 5.2   | Schema-version skew defined and tested both directions                                 | T6 (policy), T8 (end-to-end)                        |
| 5.3   | Leaderboard behind a flag on staging; out-of-bounds rejected; cross-user write blocked | T10                                                 |
| 5.3   | Username validation incl. denylist; profile opt-in/out verified                        | T9                                                  |
| 5.3   | Nothing beyond username publicly displayed                                             | T10 (I4 grep)                                       |
| 5.4   | Unfurls verified with real debuggers on `/puzzle/:id` and `/challenge`                 | T11                                                 |
| 5.5   | Three templates sent and verified in real inboxes; unsubscribe suppresses              | T12                                                 |
| 5.5   | No email to an unverified address; category defaults recorded with reasoning           | T12                                                 |
| 5.5   | Cron schedules deployed and observable                                                 | T12                                                 |
| 5.6   | Load/burst numbers + 1×/10×/100× cost curve as an amendment                            | T14                                                 |
| 5.6   | Authz suite green; zero endpoints without an ownership check                           | T13                                                 |
| 5.6   | `/legal` updated; lawyer review engaged with the delta in writing                      | T15                                                 |
| 5.6   | Deletion round-trip verified and documented                                            | T13                                                 |

## Open design questions — closed here, not deferred again

The five in `docs/v5-build-plan.md` were explicitly "settle in build prompts". This is the build prompt; they are settled.

| Question (build plan)                                  | Decision                                                                                                                                                                                  | Where                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Signup-prompt value moments + frequency cap (5.1)      | Boss clear, 7-day streak, leaderboard view, stats-page second visit; one prompt per trigger type ever, 7-day global cooldown, permanent "don't ask again"                                 | T5                         |
| Merge-rule detail per field + schema-skew policy (5.2) | Per-field rule table (union-by-id / recompute / max / LWW / keep-local / preserve-unknown), exhaustive by type; skew = migrate-up, merge-equal, **read-only sync when the blob is newer** | T6                         |
| Profile public-by-default vs opt-in prompt (5.3)       | Private by default, plain opt-in switch, no prompt and no pre-checked box; the same switch governs leaderboard name display                                                               | T9 (+ `POST /api/privacy`) |
| Per-puzzle OG images: build or re-defer (5.4)          | **Re-deferred** to v6.1; one static branded card, dynamic title/description only                                                                                                          | T11                        |
| Email category defaults at signup (5.5)                | digest off, streak off, challenge on (transactional); flagged to the lawyer review                                                                                                        | T12                        |

## Footgun Register

The mistakes this plan is positioned to make. Each one is cited at the task that can make it; if you are in that task, you are in the blast radius. "Prevented by" is the thing that has to actually exist — a rule with no test is a wish.

| #   | Footgun                                         | The mistake                                                                                                                                                                                                                                                                                                                          | Prevented by                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Clerk instance mixing**                       | Development and Production are separate applications: separate keys, separate JWT public keys, separate user tables. A `pk_test_` client against a Worker holding the production `CLERK_JWT_KEY` gives clean-looking 401s that read as a code bug for an hour. "My account doesn't exist in prod" is the same footgun wearing a hat. | Instance keys, `CLERK_JWT_KEY` and the D1 database are chosen together per env (`wrangler.jsonc` env blocks + per-env Pages vars, T0/T1); `/api/health` reports which instance it verifies against, so the mismatch is one curl away                                                               |
| F2  | **`VITE_`-prefixing a secret**                  | The prefix is not a naming convention, it is the instruction that puts the value in the client bundle. `VITE_CLERK_SECRET_KEY` "so the client can call the API" ships your secret to every visitor.                                                                                                                                  | Exactly one client var, `VITE_CLERK_PUBLISHABLE_KEY` (T0.4); all Worker secrets via `.dev.vars` + `wrangler secret put`; T13's secrets grep is the backstop, not the plan                                                                                                                          |
| F3  | **Cookie auth on the API**                      | `/api/*` is same-origin, so Clerk's `__session` cookie arrives on every request. Reading it "since it's there" makes every endpoint CSRF-able — the browser attaches it whether or not our code asked.                                                                                                                               | T3 reads tokens from `Authorization: Bearer` only, in the one middleware that is allowed to read a token at all; a test asserts a cookie-only request is 401                                                                                                                                       |
| F4  | **Widening clock skew to stop 401s**            | Intermittent 401s in the field, so `clockSkewInMs` gets bumped until they stop. That extends the usable life of every leaked token and buries the actual cause: a token fetched once and reused past its short lifetime.                                                                                                             | `getToken()` per request inside `src/auth/api.ts` (T5) — nobody else calls the API; skew stays at the default and the reasoning is written in `auth.ts`                                                                                                                                            |
| F5  | **Tests that need the cloud**                   | Worker tests written against a real D1 or a real account, so `pnpm validate` fails on a fresh clone and CI needs credentials to typecheck. The repo's whole validate story dies quietly.                                                                                                                                             | T1 uses `@cloudflare/vitest-pool-workers` with local bindings; its DoD is literally "fresh clone, no Cloudflare credentials, green"                                                                                                                                                                |
| F6  | **Wrangler env drift**                          | A binding, var, cron trigger or secret added to `dev` and not to `production`. Dev is perfect; production 500s on its first real request, usually at the least convenient moment.                                                                                                                                                    | Both env blocks live in one `wrangler.jsonc` (T1) with identical binding _names_; a test asserts the two blocks declare the same set; secrets enumerated in a comment and in `.dev.vars.example`                                                                                                   |
| F7  | **Trusting this plan's memory of the platform** | SDKs rename, features go GA, config shapes change. Coding against what a plan written in August said — `verifyToken` vs `verify`, `@clerk/clerk-react` vs `@clerk/react`, the `unsafe` vs `ratelimits` binding — produces confident, wrong code.                                                                                     | Every platform fact in this doc is stamped with the date it was checked (T1 tooling versions, T2 D1 foreign keys, T3 Clerk backend entry point, T4 rate-limit GA + config, T5 Clerk React package). Re-verify the version numbers at install; assume the _names_ are the volatile part             |
| F8  | **Clerk on the boot path**                      | `<ClerkProvider>` at the app root, because that is where every quickstart puts it. clerk-js then loads on every cold start for every guest and #82's perf work is undone without a single failing test.                                                                                                                              | T5 mounts Clerk inside a lazily-loaded shell, records main-chunk delta + modulepreload list + a signed-out `/practice` waterfall, and only falls back to a root dynamic import gated on a `codoro:has-account` hint _if measurement demands it_. I3 requires a chunk diff per client-touching task |
| F9  | **Stripping unknown fields on merge**           | Deserializing into a known-keys type, merging, re-serializing — and silently deleting whatever a newer client wrote. The user loses data that was never displayed to anyone as missing.                                                                                                                                              | T6 round-trips unknown keys verbatim with a dedicated test, and refuses to merge at all when the pulled blob's schema version is ahead of the client's                                                                                                                                             |
| F10 | **Not checking `meta.changes`**                 | `UPDATE profiles SET … WHERE revision = ?` succeeds as a _statement_ even when it matches zero rows. Returning 200 on that turns a lost update into a silent one: the client believes its push landed and drops the local delta.                                                                                                     | T7 asserts `meta.changes === 1` or returns 409 with current server state; the two-writers-same-base test proves exactly one wins                                                                                                                                                                   |
| F11 | **Unbounded sync payload**                      | No cap on the export blob, so a long-lived profile eventually exceeds what the endpoint will accept — and the first person to hit it is a heavy user losing sync with no signal.                                                                                                                                                     | 256 KB cap declared in the contract, enforced server-side in T7 with a real 257 KB test; client surfaces the failure rather than retrying forever (T8's queue); T14's load test uses realistic sizes                                                                                               |
| F12 | **Non-idempotent score writes**                 | The retry queue re-sends a score after a timeout that actually succeeded. Without a deterministic key you get duplicate rows, or a "best" that ratchets on a replay.                                                                                                                                                                 | `(clerk_user_id, mode, day)` _is_ the primary key and the write is upsert-keep-best (T10) — replay-safe by construction, not by client discipline                                                                                                                                                  |
| F13 | **Service worker caching `/api/*`**             | Workbox's navigate fallback and runtime caching happily swallow API routes. A cached 401 locks a signed-in user out; a cached sync payload serves yesterday's profile as today's truth — silent data corruption with no error anywhere (I8).                                                                                         | T1 adds `/api/` to `navigateFallbackDenylist` and excludes it from runtime caching **in the same PR that creates the route space**, with a test asserting the _generated_ SW config still does                                                                                                     |
| F14 | **TOCTOU on username claim**                    | `SELECT` for availability, then `INSERT`. Two requests interleave, both see "free", one gets a constraint error rendered as a 500 — or worse, the check gets "fixed" by removing the constraint.                                                                                                                                     | T9 lets the UNIQUE constraint be the check: attempt the write, catch the violation, return 409. Concurrent-claim test asserts exactly one 200 and one 409                                                                                                                                          |
| F15 | **Re-deriving the day key**                     | The Worker computes "today" its own way while the client uses the Daily calendar's UTC day function. Near midnight they disagree, scores land on the wrong day, and the leaderboard contradicts the game — intermittently, by timezone.                                                                                              | T10 imports the _same_ day function from shared code; a test walks the UTC boundary from both sides                                                                                                                                                                                                |
| F16 | **Unsubscribe behind a login**                  | An unsubscribe link that lands on a sign-in page, or asks for a confirmation click. Users mark it spam instead — which costs the sending domain's reputation, i.e. the whole channel.                                                                                                                                                | T12's `GET /api/email/unsubscribe?token=<HMAC>` works logged-out in one click, plus `List-Unsubscribe` / `List-Unsubscribe-Post` headers on every send; verified from a real inbox, not from a unit test                                                                                           |
| F17 | **Wildcarding CSP for Clerk**                   | Clerk's scripts/frames don't load, so the CSP gets a `*` (or the directive gets dropped) to make it work. v3's CSP hardening is gone in one line and nobody notices until it matters.                                                                                                                                                | T13 adds the exact Clerk hosts, narrowly, and reviews the CSP diff line by line as a named DoD item                                                                                                                                                                                                |
