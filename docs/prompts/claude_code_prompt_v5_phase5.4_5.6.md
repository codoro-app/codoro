# Claude Code prompt: v5 Phase 5.4 (finish) + Phase 5.6 (right-sized for relaunch)

## Context — read first

`docs/v5-build-plan.md`'s Phase 5.4 and 5.6 sections, and the master task list's T11/T13/T14/T15 in `docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md`. This prompt scopes both phases to what a **modest relaunch actually needs**, not the original heavier spec written when 5.6 was assumed to close out the whole version at once. Two scoping changes from the original docs, both direct user decisions (2026-09-15), both to be recorded by the companion docs-update prompt, not silently applied here:

1. **5.3 (usernames/leaderboards) and 5.5 (email) are paused, not built.** T14's original load test plan includes leaderboard-read burst testing — skip that; there's no leaderboard route yet. T15's original legal delta includes leaderboard display and marketing email disclosures — skip those too; only disclose what's actually live.
2. **T14's load test is right-sized to a realistic relaunch bump** (a social post driving low hundreds to low thousands of visitors), not the original 1×/10×/100× DAU cost-curve exercise written for a much later, larger-scale close-out. Confirm the free-tier ceilings (D1 500 MB/10 databases, Workers 100k req/day, 10ms CPU/invocation — see `docs/v5-build-plan.md`'s C-bis table) have real headroom for that bump; don't build out a full cost-projection model nobody asked for yet.

## Part 1 — Phase 5.4: finish per-puzzle OG (T11's remaining scope)

`/challenge` unfurls already shipped (PR #110, pre-v5). **Only `/puzzle/:id` is left.**

- Cloudflare Pages Functions middleware (not the API worker — must run where the HTML is served) intercepting `/puzzle/:id`, rewriting `<title>`/`<meta og:*>`/`<meta name="description">` into the SPA shell via `HTMLRewriter`, sourced from the existing puzzle-metadata index built by PR #82's perf work — locate that module (don't duplicate it) rather than re-deriving puzzle metadata.
- Per-puzzle OG **images** stay re-deferred — one static branded card for every route, dynamic title/description only. This was already decided; don't relitigate it.
- DoD: unfurl checks with real debuggers (Slack/Discord/X) against the dev deployment, screenshots recorded in the amendment (see Part 3 below for where).

## Part 2 — Phase 5.6, right-sized

### T13 — authz + security sweep (do this in full — it's the one that matters most before you invite strangers in)

- Table-driven authz test: every authenticated route × {no token, bad token, valid token against another user's resource}. One test file, so a new route that forgets to register itself here is conspicuous.
- Dependency audit: `pnpm audit`, plus an actual read of what Clerk/Hono pull in transitively.
- Secrets grep (no literal secret anywhere in the repo) and the I4 PII grep (no `email` column in any migration, no `posthog.identify` call carrying an email).
- CSP header pass — locate wherever it's currently configured (check `vite.config.ts`'s headers, a Pages `_headers` file, or `index.html` meta) and extend narrowly for Clerk's script/frame origins. No wildcard host, checked line by line.
- **Deletion round-trip, verified with real evidence, not inferred**: create a throwaway account, give it a synced profile via a real `PUT /api/profile`, `DELETE /api/account`, then query D1 (`users`/`profiles` gone via cascade) and Clerk's Admin API (user gone) directly — paste the actual query output into the amendment. Assert idempotency: a second `DELETE` call returns 204, not a 500.

DoD: authz matrix green, zero unregistered routes; deletion evidenced with real output; CSP diff has no wildcard.

### T14 — load test, right-sized

- Scripted (k6 or autocannon) against the **dev env**: `PUT /api/profile` at burst rates, confirm the rate limiter 429s correctly with `Retry-After`, confirm D1 write behavior under burst doesn't silently drop anything.
- Record p95 latency and current `profiles` table byte total (S4's own observability point) — enough to sanity-check headroom for a relaunch-sized bump, not a full 1×/10×/100× DAU cost model. If you want the full multi-tier cost table later (once there's a leaderboard and real traffic), that's a future task, not this one.
- Skip anything that requires `GET /api/leaderboard` — it doesn't exist yet (5.3 paused).

DoD: burst numbers + current byte totals recorded as an amendment; rate limiter holds under 2× its own configured limit.

### T15 — legal delta, scoped to what's actually live

**This is the urgent part.** `src/app/legal/LegalPage.tsx` currently states, verbatim: _"Codoro has no accounts, and the app itself collects no personal information"_ and _"Nothing is uploaded to a server."_ Both have been false since Phase 5.1 shipped (2026-09-12) — accounts collect a real email via Clerk, and a signed-in player's rating/streak/history now syncs to D1. This has been live and inaccurate in production for several days; fixing it is not contingent on the relaunch timeline.

Rewrite the Privacy section (keep the same plain, developer-written voice and "good-faith, not lawyer-reviewed" framing already established in the file's own top comment — that framing is honest, just needs to cover more now) to accurately cover, only what's actually live:

- Accounts are optional (guest-first is unchanged and stays the headline) — playing signed-out is still fully local, still exportable/clearable exactly as documented today.
- Signing in creates an account via Clerk, which collects an email address; Clerk's own privacy practices govern that data, link to them.
- A signed-in player's rating, streak, and puzzle history sync to a server (Cloudflare D1) so they carry across devices — replacing the current "nothing is uploaded to a server" claim, which is now only true for guests.
- What account deletion does: D1 rows and the Clerk user are removed (per T13's verified round-trip above) — say this plainly since it's now demonstrably true.
- Do **not** add anything about leaderboard display or marketing email — neither is live (5.3/5.5 paused); adding it now would be describing a feature that doesn't exist yet, the same class of error as the current page's stale claims, just in the other direction.
- Bump the "Last updated" date.

**Not code, flag it and stop:** T15 also calls for "the lawyer review engaged with the complete delta list in writing." That's Thomas's own action item — a real lawyer, real calendar time — not something to attempt in this session. End the amendment by listing exactly what changed in this pass, so it's ready to hand to a lawyer when that review happens, but don't simulate legal review.

## DoD for this whole session

- [ ] `/puzzle/:id` unfurls verified with real debuggers, screenshots recorded
- [ ] Authz matrix green, zero unregistered routes
- [ ] Deletion round-trip re-verified with real query output in the amendment
- [ ] CSP diff reviewed, no wildcard
- [ ] Burst test numbers + current D1 byte totals recorded
- [ ] `LegalPage.tsx` no longer contains a false statement about what the app currently does — read it back after editing and check every sentence against what's actually shipped
- [ ] `pnpm validate` green
- [ ] Amendment written (same convention as every other closing amendment in this repo) summarizing what changed, explicitly noting the lawyer-review step is still outstanding and whose job it is
