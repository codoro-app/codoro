# Prompt for Claude Code — Curated Daily calendar (runs parallel to Phase 7)

Paste this into Claude Code in the **`codoro-daily` worktree** (not the main working dir — Phase 7 Rush is running there). Branch `daily-curated-pool` off current `main`. Small scoped change.

**Parallel-work no-touch zones (Phase 7 owns these):** `src/storage/schema.ts`, `src/storage/migrations.ts`, `src/engine/rush.ts`, `src/engine/selection.ts`, `src/engine/rating.ts`, anything under `src/app/rush/`, NavRail/Home enablement. Your change needs none of them — if you find yourself editing one, stop and flag it. Expected merge conflict with Phase 7: export lines in `src/engine/index.ts` at most.

---

## Why this change

Two goals, one mechanism:

1. **Daily should be harder than the average practice puzzle** — it's the shareable flex; a soft daily is a weak flex.
2. **Fix a known consistency bug before it starts firing weekly:** `getDailyPuzzleIndex` currently hashes the date **mod the whole pool size** (`src/engine/daily.ts`). Content authoring is about to ramp from 29 puzzles toward 150+, so pool size changes nearly every deploy — and every change reshuffles which puzzle every date maps to, breaking "same date → same puzzle across devices" (the known risk flagged in Phase 6). Deploys during the ramp would churn the daily constantly.

The fix: a **curated, append-only, ordered calendar of puzzle IDs**. Day N serves entry N. Appending entries never changes entries 0..N−1, so the mapping is stable across deploys by construction — and curation is where "harder" happens.

## Mechanism

- New `src/content/dailyCalendar.ts`: an exported ordered array of puzzle IDs with a header comment stating the contract — **append-only, never reorder, never remove, never edit past entries**. Seed it with ~40 entries drawn from the harder end of the current pool (use `content:stats` / puzzle ratings; skew above the pool median — mix interactions, don't make it all one type).
- `src/engine/daily.ts`: selection becomes day-number indexing, reusing what's already there:
  - `dayIndex = getDailyNumber(dateString) − 1` (the function already exists for share numbering — selection and numbering now unify on it, which is a feature: "Daily #202" and entry 202 are the same thing).
  - `dayIndex < calendar.length` → serve `calendar[dayIndex]`. Past the end → **wrap fallback** `calendar[dayIndex % calendar.length]`, clearly documented as degraded mode.
  - Keep the function pure (calendar passed in or imported at the call boundary — match how `puzzlePool` is handled today). `hashDateString` becomes dead for selection; remove or leave for the tests' sake, your call, but don't leave a misleading export.
- **`DAILY_EPOCH` semantics change — handle the comment:** the existing comment says changing the epoch only shifts the displayed number, never the served puzzle. After this change the epoch _drives_ selection. Rewrite the comment: epoch must be set to the real launch date at launch and **frozen forever after** — changing it post-launch reshuffles every user's daily. Pre-launch, today's dayIndex (~200 against the placeholder 2026-01-01 epoch) exceeds the seed calendar, so the wrap fallback is active until launch — that's fine and expected; the stability guarantee begins when the epoch is set and the calendar covers day 0 onward.
- `src/app/daily/useDailySession.ts`: swap the pool-index lookup for the calendar lookup. `dailyCompletion` is keyed by date string, not index — no profile/schema change, confirm and state that in the summary.
- `validate:content` (`src/content/tools/validateContent.ts`) additions: every calendar ID resolves to a real puzzle; no duplicate IDs in the calendar; **runway warning** when `calendar.length − currentDayIndex < 30` (post-launch this is the "author more dailies" alarm; pre-launch it may always warn — gate it on dayIndex being within calendar range, or emit as warning not error).
- Append-only enforcement: a unit test pinning a checksum (or literal copy) of the current calendar prefix, with a comment telling future editors to _extend the pin_ when appending — turning "never edit history" from a convention into a failing test.
- Authoring-workflow doc (`GENERATING_PUZZLES.md` or wherever fits): one line added — each content batch should nominate its hardest puzzles as daily-calendar candidates.

## Behavior change to flag, not hide

The day this merges, "today's puzzle" changes once (hash-based → calendar-based). Pre-launch with no real users, that's free — say it in the PR description anyway.

## Definition of done

- [ ] Same date + same calendar → same puzzle, proven by tests; **appending entries provably never changes past mappings** (test: compute mappings for days 0..N, append, recompute, assert identical)
- [ ] Wrap fallback covered by a test; runway warning fires in `validate:content` when applicable
- [ ] Daily share number and served calendar entry derive from the same day index
- [ ] Calendar seed skews above pool-median difficulty (state the median and the seed's spread in the PR description)
- [ ] No changes to `dailyCompletion`, streak logic, share text format, or any Phase 7 no-touch file
- [ ] `pnpm validate` and `validate:content` green; zero new dependencies

## What you can verify yourself vs. what's on me

Own: all tests above, the seed selection with its difficulty numbers, doc updates.

Mine: sanity-checking the seed picks (I may swap some before launch — swaps are allowed _only pre-launch_ while the epoch is placeholder; note that in the calendar header too), and setting the real `DAILY_EPOCH` at launch.

## Orchestration

Commit order: engine change + tests → calendar seed → validate rules + append-only pin → hook swap + doc. Smallest honest diff; this whole thing should be a few hundred lines including tests. No AI attribution in commits.

When done: confirmation of no schema/profile impact, the seed's difficulty distribution, and the exact epoch-freeze rule as you wrote it in the comment.
