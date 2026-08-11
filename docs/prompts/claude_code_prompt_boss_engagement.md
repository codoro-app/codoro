# Prompt for Claude Code — Boss engagement pass (BOSS_SETS rotation, ghost pace, health-bar UI)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first; confirm `main` includes Boss (`v3 Phase 1: Boss challenges`, #55, commit `e212a54`). If it doesn't, stop and land that first — this prompt builds directly on top of `src/app/boss/`, `src/content/bossRun.ts`, and `src/storage/schema.ts`'s `bossStats` field exactly as they ship there.

This is a retention/engagement pass on Boss, not a new mode. Three independent pieces, sequenced by dependency risk (schema/content first, presentation last). A fourth idea — a global best-depth leaderboard — is **explicitly out of scope here**: it depends on the Cloudflare Workers + D1/KV backend that's still Phase 4 in `docs/v3-build-plan.md` and doesn't exist yet. Don't build a local-only leaderboard as a substitute; note it as a fast-follow once Phase 4 lands and stop there.

---

## Scope

1. **`BOSS_SETS` rotation** — replace the single hard-coded `BOSS_RUN` with a small registry of curated runs, and rotate which one a player gets. `bossRun.ts`'s own doc comment already names this as the deferred next step ("Boss WILL need more than one curated set soon") — this is that step.
2. **Ghost pace comparison** — after a run ends, show how this run's pace compares to the player's own best-ever run at the same puzzle positions. Not a live animated race for v1 (see the locked decision below) — a static post-run comparison.
3. **Boss health-bar visual treatment** — reframe the existing strike-slot indicator as a depleting boss health bar with a hit reaction on a miss. Presentation only, no new state.

**Locked decisions, don't reopen:**

- No AI opponent, no simulated "computer player." Ghost pace is _your own_ best run, not a fabricated one — don't build anything that pretends to be another entity playing.
- No live leaderboard, local or otherwise, in this pass — see the scope note above.
- Boss stays unrated and untimed-per-puzzle. Nothing here adds a countdown clock to Boss; ghost pace is measured and shown, never enforced.

## What already exists vs. what you're building

Checked against current `main` — don't rebuild these:

- `BOSS_RUN: readonly string[]` (`src/content/bossRun.ts`), validated by `validateBossRun` (`src/content/tools/validatePuzzles.ts`) and wired into `pnpm validate:content`. `useBossSession` (`src/app/boss/useBossSession.ts`) imports `BOSS_RUN` directly and serves it in fixed order.
- `bossStats: BossStats | null` on `UserProfile` (`src/storage/schema.ts`, schema v7): `{ bestDepth, clears, runs, lastRunAt }`. `runs` already increments on every completed run regardless of outcome — you can use it as-is for rotation, no new counter needed.
- `useBossSession`'s `runSummary` (`depthReached`, `cleared`, `bestDepthEver`, `isNewBestDepth`) and telemetry's `BossRunEndPayload` (`ended_reason: 'strikes' | 'completed'`, independent of `cleared` — read the doc comment on `useBossSession.ts` before touching this, the distinction is deliberate and non-obvious).
- `BossPage.tsx`'s strike indicator (`.boss-strikes`, `.boss-strikes__slot`, `.boss-strikes__slot--missed` in `bossPage.css`) — item 3 restyles this, doesn't replace its underlying data (`session.strikes`, `BOSS_STRIKE_LIMIT`).

**What's new:**

### 1. `BOSS_SETS` rotation

- Replace `BOSS_RUN`'s single array with `BOSS_SETS: readonly (readonly string[])[]` in `bossRun.ts`. Keep the current 10 ids as `BOSS_SETS[0]`; author at least 2 more sets from the real pool (same rules the current set follows: exactly 10 unique ids, non-scrubber, non-decreasing `difficulty_rating`).
- `validateBossRun` (`validatePuzzles.ts`) currently takes one `bossRun: readonly string[]`. Loop it over every entry in `BOSS_SETS` from `validateContent.ts`, prefixing errors with the set's index so a broken set is traceable (`bossRun.ts[1]: ...`) — don't change `validateBossRun`'s own signature, callers can loop it.
- Selection: **deterministic, no RNG** — `BOSS_SETS[(profile.bossStats?.runs ?? 0) % BOSS_SETS.length]`. This needs zero new schema state: `bossStats.runs` already exists and already increments once per completed run, so "which set is next" falls out of a value you already persist. Put the selection function in `bossRun.ts` next to the registry (`resolveActiveBossSet(runsCompleted: number): readonly string[]`), pure and unit-tested against a fixture registry — mirror `dailyCalendar.ts`/`getDailyCalendarIndex`'s convention of keeping the resolver pure and separately testable from the data.
- `useBossSession` currently imports `BOSS_RUN` directly and uses it as the served sequence for the entire hook lifetime. Change it to resolve the active set once per run start (not mid-run — a run must stay on the same set from puzzle 1 to its end even if `runs` changes mid-flight, which it won't, but don't wire it to live-recompute per puzzle either).
- No schema migration needed — `bossStats.runs` already exists at the shape rotation reads.
- Telemetry: add `set_index: number` to `BossAttemptContext` and `BossRunEndPayload` (additive field, same pattern as Rush's `difficulty_served`) so set-level performance is queryable later.

### 2. Ghost pace comparison

- **v1 scope, deliberately not a live race:** capture a timestamp at run start and at each puzzle-answered event, store the elapsed-ms-per-position array (`bestRunSplits: number[] | null`, length = depth reached) alongside `bossStats` **only for the run that set the current `bestDepth`** — overwrite it whenever a new best depth is set, drop it otherwise. This is a schema change: bump `CURRENT_SCHEMA_VERSION` (v7 → v8), add `bestRunSplits: number[] | null` to `BossStatsSchema`/`BossStats`, write the migration in `migrations.ts` following the exact `migrateV6ToV7` pattern (isolated test, not chain-only coverage — see that file's existing convention), and add the field to both `exportImport.test.ts` fixture profiles.
- On run end, if a `bestRunSplits` exists from a prior run, compute a simple per-position delta and surface it in the end-of-run summary: e.g. "You reached puzzle 7 in 1:58 — your best run got there in 2:14" (or the reverse). Exact copy is Thomas's call, same as Rush's share text — put it in one obvious template function, don't hardcode it inline in `BossPage.tsx`.
- Explicitly do not build: a live progress-bar ghost marker, a second puzzle rendered in parallel, or anything suggesting real-time competition. That's a real fast-follow once v1's static comparison is validated as actually motivating — don't build it speculatively now.
- `handleRunItBack` needs to reset the in-progress timestamp tracking the same way it resets `strikes`/`position` today.

### 3. Boss health-bar visual treatment

- Restyle `.boss-strikes` (`bossPage.css`) from three discrete dot/slot indicators into a depleting horizontal bar (100% → ~66% → ~33% → 0% as strikes land), with a brief hit-reaction animation (shake, flash, or similar — pick one, keep it CSS-only, no new dependency) on the transition. Same design constraint every prior phase followed: **compose entirely from the existing v2 token system** (`docs/design/codoro-v2-arena.html`, danger tokens, existing transition/easing conventions already in use elsewhere in the app). If a genuinely new visual pattern is needed that nothing in the existing system covers, stop and flag it rather than inventing new tokens.
- `session.strikes` and `BOSS_STRIKE_LIMIT` are the only data this needs — this is a pure `BossPage.tsx`/`bossPage.css` change, no hook or schema touch.

## Telemetry

`set_index` added to `BossAttemptContext`/`BossRunEndPayload` per item 1. No new events needed for items 2–3 (ghost comparison is derived client-side from already-stored data; the health bar is presentation-only) — don't add telemetry events that aren't asked for here.

## Definition of done

- [ ] `BOSS_SETS` has 3+ real, validated sets; rotation is deterministic (unit-tested against a fixture registry, not just the real content); a fresh profile (`bossStats: null`) resolves to `BOSS_SETS[0]`
- [ ] `validate:content` still passes and reports every set validated, not just index 0
- [ ] Schema v8 migration for `bestRunSplits` with an isolated migration test; export/import round-trips the new field; existing `bossStats` fixtures updated everywhere Zod will otherwise reject them
- [ ] Ghost comparison only ever compares against the run that actually set `bestDepth`, never a stale or partial one; ordinary (non-record) runs don't overwrite `bestRunSplits`
- [ ] Health bar reads `session.strikes`/`BOSS_STRIKE_LIMIT` only — no new state, no timer introduced anywhere in Boss
- [ ] `pnpm validate` green; zero new dependencies; no hex outside `index.css`

## What you can verify yourself vs. what's on me

Own: everything above, including authoring the 2+ new `BOSS_SETS` entries from the real pool (pick ids, verify escalation, let `validate:content` be the final check — don't hand-pick without running it).

Mine: playing multiple runs across a session boundary to confirm rotation actually cycles instead of repeating; judging whether the ghost-comparison copy and the health-bar hit animation feel right on my phone; deciding the exact hit-reaction treatment if you flag more than one reasonable option.

## Orchestration

- Branch `boss-engagement-pass`, PR into `main` when green.
- Commit order: `BOSS_SETS` registry + rotation + validator loop → schema v8 migration for `bestRunSplits` → `useBossSession` ghost-capture + rotation wiring → end-of-run ghost comparison UI → health-bar restyle. No batching.
- Delegate to a subagent: authoring/verifying the new `BOSS_SETS` id lists against the real pool, the CSS restyle, the ghost-comparison copy template. Keep your strongest reasoning on the schema migration and on `useBossSession`'s run-start set resolution (getting "resolve once per run, not per puzzle" wrong silently breaks mid-run consistency in a way tests can miss if they don't specifically assert on it).
- No AI attribution in commits.

When done: which 2+ puzzle ids you chose for the new sets and why (rating spread, interaction mix), the `bestRunSplits` migration shape, and anything you couldn't compose from the existing v2 design system.
