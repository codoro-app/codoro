# Claude Code prompt — v5 Phase 5.1: client auth, guest-first

Run this on Sonnet (Fable budget is reserved for 5.2's merge-rule review and 5.6's authz suite — see `codoro-v5-go-decision` memory). Sized 1–2 sessions per the build plan. Piece 0 is docs housekeeping, do it first in its own small PR; Piece 1 is the real build.

## Context you must read first

1. `docs/v5-build-plan.md` — Phase 5.1 section ("Client auth, guest-first"), and the amendment banner under "Locked decisions" at the top. Read the whole 2026-08-31/09-08/09-10 amendment before touching anything, same as every prior 5.0 session did.
2. `docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md` — **T5** ("Clerk in the client, measured") is this phase's task. Read I1–I10 (especially I9/I10, which T3/T4 already enforce server-side and T5 must not undermine client-side) and the Footgun Register (F1–F23), particularly F8 (bundle-cost measurement discipline).
3. `docs/superpowers/plans/2026-08-31-v5-phase-5.0-coding-plan.md` — not your task list, but read the T1–T4a amendments at the bottom. They're the precedent for how you write _this_ session's amendment: real measurements, real platform surprises, DoD checked off with evidence, not claims.
4. `workers/README.md` and `workers/src/env.d.ts` — the API surface you're calling. `workers/shared/api-types.ts` is the wire contract; add to it, don't duplicate it.
5. `src/app/` for the existing route/shell structure, and whatever perf-baseline doc `#82`'s lazy-load split produced (referenced throughout T5) — find it and read the numbers before claiming "unchanged" against it.

## Phase 5.0 status (context, not your job)

Phase 5.0 (T1–T4a + the ZAP workflow) is merged to `main` (#115–#121) and reviewed — server scaffold, D1 schema, auth middleware, rate limiting, and `POST /api/report` are all in place and match their DoD. Two things are still open and matter to you:

- **CI's `deploy-dev` job is blocked on two missing repo secrets** (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` — see the T1 amendment). The dev Worker is live from a manual deploy, so `/api/*` works today; CI just doesn't auto-deploy it yet. Not your job to fix — flag it if it blocks you.
- **The ZAP baseline workflow (`zap-baseline.yml`) exists but is `workflow_dispatch`-only** — confirm with Thomas it's actually been run at least once against `codoro-dev` with findings triaged, before you consider Phase 5.0's DoD fully closed. Not a 5.1 build task; a one-line check-in.

## Piece 0 — docs housekeeping (small PR, do first)

1. `docs/v5-build-plan.md` section **C1** still says "enable Free immediately" and treats CodeRabbit Free as active review coverage. That's stale: per `codoro-v5-task0-cost-facts` (2026-09-10), CodeRabbit has **no free tier for private repos at all** (Free is open-source-only) — Essentials is $24/dev/mo minimum — so the whole tool was cut, not just the Pro seat. Add a dated **2026-09-10** correction under C1 (same strike + bold-update convention as the rest of the file) saying CodeRabbit is cut entirely; PR review is Claude Code + `pnpm audit` + Dependabot + gitleaks. Propagate the same correction to the C-bis cost table row and to the Task-0 line in section D's phase table (both currently still read "CodeRabbit Free enabled").
2. In `docs/superpowers/plans/2026-08-31-v5-phase-5.0-coding-plan.md`, the top-level **"Phase 5.0 is done when"** checklist (near the top of the file) is still all unchecked `- [ ]`, even though every task's own amendment below it shows the line satisfied with evidence. Check off every line that the T1–T4a amendments actually support, and strike the "CodeRabbit reviewing PRs" line per the correction above (replace with "Claude Code + `pnpm audit` + gitleaks reviewing PRs", matching what C1 now says). Leave the CI-deploy-secrets and ZAP-triage lines unchecked — those two are still genuinely open.
3. Don't touch anything else in either file. This is a 10-minute PR, not a rewrite.

## Decisions already made — do not re-open, do not ask again

- **2FA is not in scope.** Clerk stays on Hobby for all of v5. Build sign-in/sign-up against `useSignIn`/`useSignUp` hooks, never the prebuilt `<SignIn />`/`<SignUp />` components.
- **Package is `@clerk/react` v6** (not `@clerk/clerk-react`, the Core 2 name — still published, not where new work goes). Pin the major. Pairs with `@clerk/backend` v3 already in the Worker.
- **No email list, no Resend, no `/privacy` page.** Those were cut from the pre-5.0 OG-card work and stay cut here too — 5.1's account creation is the email-capture mechanism now.
- **Guest-first is law.** The signed-out play loop does not change in behavior, route structure, or performance. Nothing here gates play behind an account.
- **Client-side owns merge/sync logic in 5.2, not 5.1.** T5 is auth plumbing + Settings + the report control only. Do not start pulling in `src/sync/` work — that's T6/T7/T8.

## Stop and ask before writing code

- **Clerk branding-requirement verification (build plan's explicit 5.1 precondition, added 2026-09-08).** Confirm on Clerk's _current_ pricing page that a hook-based custom auth flow (not the prebuilt components) carries no mandatory branding on the Hobby plan, before locking in the hook-based approach. If it turns out hooks _do_ carry branding on Hobby, stop — that reopens the Clerk-Pro-vs-drop-2FA tradeoff, which is Thomas's call, not yours to route around.
- **Clerk Production instance keys.** Task 0 for 5.0 deliberately scoped to Development-instance keys only; Production keys + the real-domain DNS requirement were pushed to 5.1 (see the coding plan's Task 0 corrections). Confirm these exist before any production-env wiring. Development-only is fine for building against `codoro-dev`.
- **Signup-prompt exact copy and the 7-day cooldown mechanics.** The build plan and implementation plan agree on trigger _points_ (boss clear, 7-day streak, leaderboard view, stats-page second visit) and a "one prompt per trigger type ever + global 7-day cooldown + permanent don't-ask-again" shape, but not the literal copy. Settle copy with Thomas in-session; don't invent final strings and ship them.
- **Root-chunk vs lazy-loaded-shell Clerk mounting, if session restoration breaks.** The default is ClerkProvider inside a lazily-loaded shell, never the root, so `/practice` signed-out never pays for Clerk's JS. If that breaks Clerk's own session-restoration UX in practice, the documented fallback (root-level _dynamic_ import gated on a `codoro:has-account` localStorage hint) is pre-approved — but only after you've actually measured the bundle/network numbers, not as a first move.

## Build

Files (per the implementation plan's T5 file list): `src/auth/AuthProvider.tsx` (the lazy boundary), `src/auth/useAuthToken.ts`, `src/auth/api.ts` (the single fetch wrapper — every `/api/*` call goes through this, token attach + timeouts + error taxonomy; nothing else calls `fetch` against `/api/*` directly), the Settings account section, and the sign-in/sign-up surface.

1. **Env var gate (I1's test hook).** `VITE_CLERK_PUBLISHABLE_KEY` unset ⇒ the entire auth module renders the signed-out experience and mounts nothing Clerk-related. This is what keeps CI and a fresh clone green with no key configured — write the test for it, don't just eyeball it.
2. **ClerkProvider + custom sign-in/sign-up**, themed to the arena palette (dark surfaces, lime accent) using `useSignIn`/`useSignUp` directly — no stock white modal in a dark game.
3. **`src/auth/api.ts`** — token attach via `getToken()` per request (per T3's own doc comment: short-lived JWT held in memory, never written to any storage — I10 is a client-side rule too, not just the Worker's). Timeouts and one error taxonomy every caller shares.
4. **Settings account section**: signed-in state, sign out, **delete account**. Delete calls a Worker endpoint (new — add it to `shared/api-types.ts` first, then the Worker route, then wire the client; this is the one place T5 legitimately touches `workers/`) that removes the D1 rows and the Clerk user. Deletion must be _confirmed server-side_ (query D1 and the Clerk Admin API after, don't infer success from a 204) both in your own test and in the DoD walkthrough. Local play history is explicitly **kept** on the device — say so in the confirm-delete UI copy, this is a stated product decision, not an oversight.
5. **Report-a-puzzle control**: a low-prominence control on the puzzle surface, posting to the already-shipped `POST /api/report` (puzzle id, chosen reason from `REPORT_REASONS` in `shared/api-types.ts`, app version). Available **signed-out** — it's a content-quality channel, not an account feature. Fire-and-forget with an honest confirmation; a failed post says so, it does not silently swallow the error.
6. **Signup-prompt value moments + frequency cap**: trigger points per the plan (boss clear, 7-day streak, leaderboard view, stats-page second visit), one prompt per trigger type ever, global 7-day cooldown, permanent "don't ask again" via a local flag. Every prompt dismissible in one tap, never interrupts an in-progress puzzle. Unit-test the cap logic directly — this is exactly the kind of state-machine bug that's invisible in manual testing and obvious in a test.
7. **Bundle discipline (F8), measured not asserted**: after wiring, record in this session's amendment — main-chunk size delta (target ~0), whether `dist/index.html`'s modulepreload list changed, and the network waterfall on `/practice` signed-out (clerk-js must not appear in it at all).

## Done-when

- [ ] `VITE_CLERK_PUBLISHABLE_KEY` unset ⇒ signed-out experience, zero Clerk code mounted, tested
- [ ] Create → sign out → sign in → delete account round-trip verified against the dev env; deletion confirmed server-side (D1 rows + Clerk user both queried and gone, not inferred)
- [ ] Signed-out play loop behaviorally and performance-identical: bundle diff recorded + a Lighthouse re-run on `/practice` signed-out against the #82 baseline (both numbers, not just the chunk diff)
- [ ] Signup prompts fire only at the four settled trigger moments, frequency-cap unit-tested (one-per-trigger-ever, 7-day global cooldown, permanent opt-out)
- [ ] Report control works signed-out, round-trips to a real row on `codoro-dev`, and a failed post surfaces to the user rather than disappearing
- [ ] `pnpm validate` green at the root **and** `pnpm --filter workers run validate` green (if the delete-account endpoint touched `workers/`)
- [ ] Session amendment written at the bottom of the implementation plan doc, T1–T4a style: real measurements, real platform surprises if any, DoD checked off with evidence

## Rules of engagement

- One task = one commit or small series; `pnpm validate` green at every commit, same discipline as 5.0.
- No scope creep into 5.2: no `src/sync/`, no merge engine, no anonymous→account migration logic. 5.1 ends when a human can create an account, sign in, sign out, delete an account, and report a puzzle — nothing about progress syncing.
- Write the amendment as you go, not at the end.
- If the environment is a mounted device folder rather than native, the mount has known git/pnpm limitations (stale `.git/*.lock`, silently-failing `git checkout`/`restore`, unresolvable symlinked `node_modules` that stop lint/test from running) — `pnpm validate` green is a DoD line regardless; if this environment can't run it, run it somewhere that can rather than declaring the line met on faith.
- Stop and ask on anything in the stop-and-ask list above, and on any Task 0-style precondition (a Clerk setting, a key, a DNS record) that turns out to be missing or ambiguous — same rule 5.0 followed.
