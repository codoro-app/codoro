# Claude Code prompt: v5 T9 — usernames + privacy switch

**Read first, in order:**

1. `docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md` — Invariants I1–I12, T9's own section, Footgun F14, the D1 schema (superseded by the 2026-08-31 amendment further down the same file), the API contract table.
2. `docs/v5-build-plan.md` — Phase 5.3's DoD checklist.
3. `docs/superpowers/plans/2026-09-12-v5-phase-5.2-sync-implementation-plan.md`'s merge rule at the top ("a PR merges when CI is green, a fresh-context review has run, and either its manual click-through has run or the change is unreachable by users") — same rule applies here.

**Note on numbering, so this isn't rediscovered mid-session:** this task is T9 in the _master_ implementation plan's numbering (usernames). The 5.2 sync-implementation-plan doc also has a "T9" — that one was production deploy, already shipped and closed (Phase 5.2's closing amendment). They are different tasks that happen to share a number across two documents. Don't rename either retroactively; just don't confuse them.

## Scope

Server: `POST /api/username`, `POST /api/privacy`. Client: username claim UI + privacy switch in Settings, also reachable from a first-leaderboard-join moment. **The leaderboard itself is out of scope — that's T10, next session.** Don't build ahead of it.

## Server — `workers/src/username.ts` (new)

- `POST /api/username`, body `{ username: string }`.
  - Lowercase first, then validate `^[a-z0-9_]{3,20}$` — allowlist charset (I6), not a blocklist.
  - Reserved + profanity list in `workers/src/usernameDenylist.ts` — a hardcoded, directly testable array, no fetch-time dependency. Reserved set: `admin`, `codoro`, `api`, `support`, `mod`, plus every existing top-level route segment — pull the real list from `App.tsx`'s router rather than guessing it (`practice`, `daily`, `rush`, `boss`, `settings`, `challenge`, `u`, and whatever else is actually routed).
  - Uniqueness: **do not pre-check then insert** — that's F14, a TOCTOU race under concurrent claims of the same name. Attempt the write directly (`UPDATE users SET username = ... WHERE clerk_user_id = ?`, or the equivalent insert) and catch the UNIQUE constraint violation as the 409 path. The test that matters here actually races two concurrent claims of the same name and asserts exactly one 200 — not two sequential requests.
  - Change quota: ≤3 changes per 30 days via `username_changed_at` in D1, not the rate-limit binding (its window tops out at 60s — wrong tool, see T4's own design doc). 4th attempt inside the window → rejected, row unchanged, pick 422 or 429 and say why in a comment.
  - Response: `{ username }` on success, `409` on collision, `422` on validation/quota failure.
- `POST /api/privacy`, body `{ publicProfile: boolean }` → writes `users.public_profile`, returns `{ publicProfile }`. Default is already `0` in the DDL — just don't ship a client that pre-checks the box or nudges toward on.
- Extend `workers/src/db.ts` with typed helpers only, following the file's existing convention (WHERE-clause-enforced invariants over app-level read-then-branch, same style as `recordScore` and `linkAnonIdIfUnset`): `setUsername`, `setPublicProfile`, a change-count-in-30-days helper, and `getUserByUsername` (stub for T10/`​/u/:username` — not wired to a route this session).
- Wire both routes into `workers/src/index.ts` through the same auth + rate-limit middleware chain every other authenticated write route uses.

## Client — Settings + first-leaderboard-join surface

- New section in `AccountSection.tsx` alongside the existing sign-out/delete-account block: username claim/change input + the privacy switch. Copy states plainly what turning the switch on publishes (username + stats on `/u/:username` and the leaderboard). No prompt, no nudge, no pre-checked box.
- Client-side validation mirrors the server's charset/length bounds for instant feedback, but the server response is the source of truth — no optimistic "claimed" state before the 200 lands.
- Route every call through `src/auth/api.ts`'s `apiFetch` — same as every other authenticated call in this codebase. No new fetch wrapper.

## DoD — don't sign off without all of these

- [ ] Charset/length allowlist tested at both bounds (3 and 20 chars, plus one over/under each)
- [ ] Reserved + profanity denylist tested, including case variation and leading/trailing whitespace
- [ ] Concurrent claim of the same username → exactly one 200, one 409 (the real F14 test — against the DB constraint, not a pre-check-then-insert)
- [ ] 4th change inside 30 days → rejected, row unchanged
- [ ] Privacy switch verified both directions server-side (`public_profile` flips; `/u/:username`-equivalent lookup 404s when off) — full "removes the name from an already-published board row" behavior needs T10 to fully exercise, but the underlying flag behavior is testable now
- [ ] `pnpm validate` green

## Explicitly out of scope this session

Leaderboard routes, `/u/:username` page rendering, `GET /api/users/:username`. All T10. `db.ts` already has `getAllTimeLeaderboard()` stubbed for it — don't wire it to a route here.
