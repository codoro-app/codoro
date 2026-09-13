# v5 Phase 5.2 — T7b: resolve F29 and prove `codoro-dev`'s authenticated path end-to-end

**Run before T8. One session. Sonnet.**

Read first, in this order:

- `docs/superpowers/plans/2026-09-12-v5-phase-5.2-sync-implementation-plan.md` — especially **F29** and the **"Verification discipline"** section.
- `workers/src/auth.ts`, `workers/wrangler.jsonc`, `workers/src/env.d.ts`, `src/auth/api.ts`, `vite.config.ts`.

## Why this task exists

T7's DoD click-through 401'd against the deployed `codoro-api-dev`. F29 records the cause as `clerkAuth()`'s `authorizedParties: [APP_ORIGIN]` check rejecting a backend-minted token that carries no `azp` claim. That diagnosis is **consistent with the installed library** — `@clerk/backend@3.17.2`'s `assertAuthorizedPartiesClaim` is literally `if (!azp || !authorizedParties.includes(azp)) throw`, and it runs _after_ signature verification (`dist/chunk-QOX5XVDR.mjs`, `verifyJwt`) — but it was never **observed**, because `clerkAuth()` collapses every failure mode into one generic 401 by design. A wrong, malformed, or unset `CLERK_JWT_KEY` secret on the deployed dev Worker produces a byte-identical response. **Piece 0 exists to close that gap before anything is built on top of it.**

The consequence is bigger than T7: T8's DoD requires a two-real-devices manual pass against the dev env, and today no browser flow anywhere can authenticate against `codoro-api-dev` at all (nothing served from `https://getcodoro.com` talks to the _development_ Clerk instance; dev has no route of its own since the 2026-09-11 wrangler amendment; `src/auth/api.ts` only ever fetches same-origin relative `/api/*`).

**Decision taken 2026-09-12 (Thomas), do not re-litigate:** fix this with a dev-server proxy and a multi-origin allow-list — _not_ by standing up `dev.getcodoro.com`, and _not_ by moving T8's verification onto production.

## Invariants this task must not break

- **Production's authorized-party list stays exactly `https://getcodoro.com`.** A dev origin leaking into the production env's value is the failure mode this whole change creates; a test must make it impossible.
- The client keeps calling **same-origin relative `/api/*`** (`src/auth/api.ts`'s "no CORS, ever" note holds). The proxy lives in the Vite dev server, not in app code. **No API base-URL variable is introduced.**
- `clerkAuth()` stays bearer-only, fail-closed, one generic 401 (F3). Widening the origin list is not permission to widen anything else.
- No new dependency, no Cloudflare plan change, no DNS.

## Piece 0 — prove what the 401 actually was (do this first, report before changing code)

1. Mint a token against the **development** Clerk instance exactly as T7 did (Backend API `sessions.createSession` / `getToken`). Delete the test user afterwards, same as T7 did.
2. In a throwaway node script (not committed), call `verifyToken(token, { jwtKey: <dev CLERK_JWT_KEY>, authorizedParties: [] })` — i.e. the same call `auth.ts` makes, with the azp assertion disabled.
   - **Verifies →** signature and the dev JWKS key are good; F29's diagnosis is confirmed and the only blocker is `azp`. Proceed.
   - **Fails →** stop. The real finding is that dev's `CLERK_JWT_KEY` is wrong/unset, F29 is mis-diagnosed, and this task's scope changes. Report it and wait.
3. Independently confirm the _deployed_ dev Worker actually has the secret: `wrangler secret list --env dev` (expect `CLERK_JWT_KEY`, `CLERK_SECRET_KEY`) and `curl https://<codoro-api-dev>.workers.dev/api/health` (expect `CLERK_INSTANCE: "development"`).

Write what you found into this task's amendment **before** writing code. If Piece 0 contradicts F29, amending F29's text is part of this task.

## Piece 1 — `APP_ORIGIN` → `APP_ORIGINS` (comma-separated allow-list)

- `workers/src/env.d.ts`: rename `APP_ORIGIN: string` → `APP_ORIGINS: string`, documenting the comma-separated shape and _why_ dev has more than one entry (pointer to F29).
- `workers/src/auth.ts`: parse once per request — `c.env.APP_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)` — and pass that array as `authorizedParties`. **Fail closed:** if the parsed list is empty, 401; never fall through to an unrestricted `authorizedParties: []`, which would disable the check entirely (that is precisely the library behaviour Piece 0 exploits deliberately and production must never get accidentally).
- `workers/wrangler.jsonc`:
  - `production.vars.APP_ORIGINS = "https://getcodoro.com"` — unchanged in substance.
  - `dev.vars.APP_ORIGINS = "http://localhost:5173"`, with a comment saying an additional LAN origin is passed at deploy time for a two-device pass (`wrangler deploy --env dev --var APP_ORIGINS:"http://localhost:5173,http://<lan-ip>:5173"`), deliberately **not** committed, because it is machine-specific and would rot.
- Tests (`workers/test/auth.test.ts` + friends currently set `APP_ORIGIN: TEST_ORIGIN`): update, and **add**:
  - a token whose `azp` matches the _second_ entry of a two-entry list verifies;
  - a token with **no** `azp` is rejected (this is F29, pinned as a regression test);
  - a token whose `azp` matches no entry is rejected;
  - an empty/whitespace `APP_ORIGINS` rejects rather than allows.
- Add a static config test (same shape as the existing `workers/test/static/` grep guards): **the `production` env's `APP_ORIGINS` in `wrangler.jsonc` parses to exactly `["https://getcodoro.com"]`.** This is the guard that makes the dev widening safe.

## Piece 2 — Vite dev proxy to the deployed dev Worker

In `vite.config.ts`, add a dev-server proxy so the browser origin stays `http://localhost:5173` (which is what `azp` is minted from) while `/api/*` reaches the **deployed** `codoro-api-dev`:

```ts
server: {
  proxy: {
    '/api': {
      target: process.env.DEV_API_TARGET ?? 'http://127.0.0.1:8787', // local `wrangler dev --env dev` by default
      changeOrigin: true, // required so Cloudflare sees the workers.dev Host
    },
  },
},
```

- `changeOrigin: true` rewrites only the `Host` header; it does **not** affect `azp`, which Clerk mints from the browser's own origin. Say so in a comment so the next reader doesn't "fix" it.
- Document `DEV_API_TARGET=https://<codoro-api-dev>.workers.dev` in `.env.example` (the var is read by the Vite _config_, so it must not carry a `VITE_` prefix — it must never reach the bundle).
- Build output is unaffected: `server.proxy` applies to `vite dev` only. Confirm `pnpm build` is byte-identical in behaviour and that no production code path gained a conditional.

## Piece 3 — the manual click-through (this is the point of the task)

Not a box to check from green tests. With `VITE_CLERK_PUBLISHABLE_KEY` set to the **development** `pk_test_…` and `DEV_API_TARGET` pointing at the deployed dev Worker:

1. `pnpm dev`, sign in at `http://localhost:5173` through the real Clerk dev instance.
2. In devtools, decode the token `getToken()` returns and confirm `azp === "http://localhost:5173"`.
3. Observe a real **`GET /api/profile` → 404** (no row yet), then a real **`PUT /api/profile` → 200/201**, then a **`GET` → 200** returning what was written. Confirm these hit the deployed Worker (`/api/health` reports `CLERK_INSTANCE: "development"` and the expected `VERSION`), not a local one.
4. Record the actual status codes and response bodies in the amendment. A screenshot of the network panel is the convention this plan already uses.

If any of this cannot be reached, **stop and report** rather than forcing a green — that is the rule F29 itself came from.

## DoD

- [ ] Piece 0's finding written down, with the verdict stated plainly (F29 confirmed / F29 mis-diagnosed).
- [ ] `pnpm validate` green (note: pnpm's symlinked `node_modules` does not resolve inside the device VM — if that's where this runs, say so rather than claiming a run that didn't happen).
- [ ] The five `authorizedParties` tests above, including the no-`azp` regression test that pins F29.
- [ ] The static guard on production's `APP_ORIGINS`.
- [ ] A real browser 200 from `PUT /api/profile` against the deployed `codoro-api-dev`, recorded.
- [ ] Plan amendment: F29 marked resolved (or corrected), and the "Verification discipline" T8 bullet **reverted** to run against `codoro-dev` — the production-getcodoro.com routing was a workaround for exactly this, and it should not outlive it.
- [ ] Two-device note: state whether the LAN-origin `--var` path was actually exercised, or only the localhost one. `http://<lan-ip>:5173` is **unverified** against Clerk dev instances (http, non-localhost) and no service worker will register there — if it fails, that's a finding for T8's own DoD, not something to paper over.

## Locked for T8, so it doesn't get re-opened mid-task

T8's open design question — where the sync engine hooks profile mutations — is settled as **option 1: wrap `saveProfile()` in `src/storage/profile.ts` with a module-level subscriber list.** The count decides it: there are **20+ direct `saveProfile()` call sites** across `practice`, `rush`, `daily`, `boss`, `trace`, `missions`, `firstRun`, `challenge`, `settings` and `SignInSheet`, several inside fire-and-forget `.catch()` chains. Option 2 (per-call-site `notifyMutation()`) is a convention that has to hold across 20 places today and every new one forever, with no test that catches an omission. Wrap it, and keep the grep-based static test anyway as the F25 guard.
