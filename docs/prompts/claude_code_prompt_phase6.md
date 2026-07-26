# Prompt for Claude Code — Phase 6 (Daily Puzzle)

Paste this into Claude Code in the codoro repo. Confirm `main` is at `81bc69f` (PR #14) or later before starting — `git fetch && git status` first, same as always.

---

## Known issue — do not work on this, just watch for it

The "Update available" prompt (`src/app/pwa/useUpdatePrompt.ts` / `UpdatePrompt.tsx`) has had five fix attempts already — PR #10 (iOS safe-area handling), #11 (version marker for testing it), #12 (immediate + iOS-bfcache-resume update checks), #13 (stopped the CDN from caching `sw.js`), #14 (fixed hashed-asset cache headers after that change) — and it's still unreliable for Thomas. **Don't touch it and don't try to fix it — out of scope for Phase 6.** But if anything in this phase happens to touch `src/app/pwa/`, service worker registration, or `public/_headers`, call that out specifically in your summary even if unintentional. Thomas wants visibility into whether it changes at all, not for you to go looking for it.

## Scope (from codoro_build_plan.md)

1. Daily flow: today's puzzle via the deterministic date hash; first attempt rated, retries allowed after but unrated; completion state persists for the day (no re-taking for a better share).
2. Streak wiring: Daily-only anchors the streak (the build plan's explicit recommendation — chess.com and Wordle both do this).
3. Share card: clipboard text, Wordle-style — `Codoro Daily #37 — ✅ first try — 🔥 12-day streak — getcodoro.com`. No spoilers.
4. OG meta tags so the shared link unfurls properly in Discord/Slack/iMessage.

## What's already built vs. what you actually need to add

The engine and storage layers were built ahead of schedule for this exact phase — most of the hard logic already exists, so don't rebuild it:

- `shouldRateAttempt('daily', isFirstAttemptOfDay)` in `src/engine/rating.ts` already implements "first attempt rated, retries not." Just call it correctly from wherever you determine `isFirstAttemptOfDay`.
- `getDailyPuzzleIndex(dateString, poolSize)` in `src/engine/daily.ts` already does the deterministic hash. `Attempt.mode` in `src/storage/schema.ts` already accepts `'daily'`.
- **`recordActivity` (streak) currently fires on every Practice attempt** — `src/app/practice/usePracticeSession.ts`, inside `handleAnswered` (`const newStreak = recordActivity(profile.streak, today)`). The build plan wants Daily-only. This is a real behavior change, not additive: remove that call from Practice's commit flow and move it to Daily's completion instead. Leaving both wired in means the "Daily-only" decision is nominal, not actually implemented.
- **`UserProfile` has no field for "which daily puzzle date is already completed."** You'll need to add one (shape's your call — something like a nullable `dailyCompletion: { date, attemptId, correct } | null`), which means bumping `CURRENT_SCHEMA_VERSION` from `1` to `2` and adding the first real entry to `MIGRATIONS` in `src/storage/migrations.ts`. That file is currently empty by design — its own comment says it's waiting for exactly this. Match the existing "real migration test" pattern already used elsewhere in the storage layer (write a v1 fixture, load it under the v2 schema, assert the migrated shape).
- **No routing/mode-switching exists.** `App.tsx` renders `<PracticePage />` unconditionally, nothing else. You need some way to reach Daily. Keep it minimal — a simple mode switcher is enough for two screens, don't reach for a routing library.
- **No OG meta tags exist in `index.html` at all** — adding from scratch. The existing PWA icons (`public/pwa-512.png` etc.) are square app-icon crops, not the ~1200×630 landscape shape Discord/iMessage/Slack expect for an unfurl. You likely need a dedicated OG image — flag it rather than shipping a stretched app icon.

## A correctness risk worth knowing before you wire the hash

`puzzlePool` (`src/content/index.ts`) is sorted by file path and aggregated at build time via `import.meta.glob`. `getDailyPuzzleIndex` hashes a date string mod pool size. Phase 8's content authoring runs continuously in parallel with every later phase, so pool size (and possibly sort order, if a new file sorts earlier than existing ones) can change between deploys — meaning two users on different deployed bundle versions on the same calendar day could disagree on "today's puzzle," which breaks the DoD's "same date → same puzzle across devices" requirement. This is worse than it'd otherwise be because the update-prompt mechanism meant to keep everyone on a consistent deployed version is the thing that's currently unreliable (see above) — don't try to fix that to solve this. Just make sure the daily-index computation is stable _within_ a single deployed bundle (it already is), and note this as a known launch-readiness risk in your summary instead of silently marking the DoD item fully closed if you can't close the gap.

## Definition of done

- [ ] Same calendar date → same puzzle across devices/browsers (with the caveat above); completion state survives restart; can't re-take today's for rating
- [ ] First attempt moves rating; retries don't — unit-tested at the engine boundary and at the orchestration layer that calls `shouldRateAttempt`
- [ ] Streak increments across a real (or clock-shifted) day boundary and resets after a skipped day, driven by Daily activity only
- [ ] Share text pastes correctly on iOS and Android; link unfurls with an image in Discord and iMessage

## What you can verify yourself vs. what's on me

Own: unit/component tests for daily selection, the rated-first-attempt/unrated-retry boundary, the schema migration, share-text formatting; CI green end to end.

Mine: pasting a real share into Discord/iMessage/Slack to confirm the unfurl actually renders (you can validate the OG tags are well-formed, but the live unfurl needs a real test); shifting my device clock forward a day to confirm new puzzle + streak increment, forward two days to confirm streak reset; completing the Daily on two real devices to confirm they match.

## Orchestration

Same conventions as every prior phase:

- Branch `phase-6-daily`, PR into `main` when green.
- Loop per build-plan item: build, verify, commit, move on. No batching.
- No Claude/Anthropic/AI attribution in commit messages — write them as if authored normally. (Unrelated aside: the last several merged PRs carry a `Co-authored-by: Thomas <codoroapp@gmail.com>` trailer — not an AI-attribution issue since it's his own identity, but confirm whether that's deliberate or a side effect of how commits are being made, and flag which.)
- Delegate mechanical work to a cheaper/faster model via subagent: the OG image asset, the share-text template, the mode-switcher UI scaffolding. Keep your strongest reasoning on the schema migration and the streak-semantics change (moving `recordActivity` off Practice onto Daily without corrupting existing users' `rating`/`ratedAttemptCount`) — those are the two spots where a mistake damages real stored data, not just a visual bug.

When done: what got built, the exact shape of the schema migration, confirmation the Daily-only streak change is fully wired (not left running in parallel with Practice), the OG image you used, and the full "needs me" list above.
