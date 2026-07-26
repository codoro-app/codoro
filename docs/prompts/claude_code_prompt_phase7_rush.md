# Prompt for Claude Code — Phase 7 (Puzzle Rush)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first; confirm `main` includes the v2 skin and the follow-ups PR (Home, Icons.tsx, NavRail with the disabled Rush entry). Same standing rule as every phase: `src/app/pwa/` is hands-off; list any touched file there in your summary.

---

## Scope (from codoro_build_plan.md, Phase 7)

1. Rush loop: continuous serving with escalating difficulty — start ~user rating − 400, step up per correct (chess.com-style ramp); 3 strikes ends the run. Serving weighted ~70% toward `swipe-binary` (rapid flick-sorting is the mode's feel); `mcq` and `tap-line` mix in as pace-breakers.
2. Strike indicator, running solved count, in-run streak; end-of-run card: solved count, best streak within run, longest-ever, per-run share text.
3. Rush history persisted (best score is a retention hook); attempts logged to storage + PostHog with `mode: 'rush'`.
4. Guard: Rush provably excluded from rating updates — a unit test, not a promise.

**Locked decision, don't reopen:** Rush is unrated, and it's 3-strikes-ends-it — **no countdown timer.** Don't add one.

## What already exists vs. what you're building

Checked against current `main` — don't rebuild these:

- `shouldRateAttempt` (`src/engine/rating.ts`) already returns `false` for `'rush'`, and `Attempt.mode` (`src/storage/schema.ts`) already accepts `'rush'`. The engine boundary is done. **Your guard work is at the orchestration layer:** the rush session hook must be tested to never invoke the rating-update path — mock/spy the rating module in the hook test and assert zero calls across a full simulated run, including wrong answers. A test that only checks `shouldRateAttempt('rush') === false` does not satisfy the DoD; that test exists already.
- The nav entry and Home mode card for Rush exist, disabled ("coming soon"). Enabling them is the last commit, not the first — the mode shouldn't be reachable until the loop is whole.
- `PuzzleCardShell`, all three interaction components, the combo/feedback treatments: reuse. Rush is a different session loop around the same card, not a new card.
- **`UserProfile` has no rush history field.** Add one (shape's your call — something like `rushStats: { bestScore, bestStreak, runs, lastRunAt } | null`), bump `CURRENT_SCHEMA_VERSION` 2 → 3, and add the migration to `src/storage/migrations.ts` following the exact pattern the v1→v2 daily migration established (real fixture: write v2, load under v3, assert shape).
- **Serving ramp doesn't exist.** New pure module `src/engine/rush.ts`, unit-tested like the rest of the engine:
  - `startRating = max(userRating − 400, 400)` (respect the rating floor), difficulty steps up per correct answer. Step size is your call — make it a named exported constant (something in the 25–50 range feels right against a K=32 rating system), because Thomas will tune it after play-testing.
  - Interaction weighting ~70/30 swipe-binary vs. the rest, degrading gracefully when the eligible pool at the current difficulty lacks swipe puzzles — never stall a run because the weighted bucket is empty.
  - No repeat within a single run; reuse `selection.ts` utilities where they fit, but **do not modify practice/daily selection semantics** — those constants are locked. If sharing code requires touching them, duplicate instead and note it.
  - Pool exhaustion mid-run (high difficulty, small pool): widen downward/around rather than ending the run early — a run should only end by strikes. Document the fallback behavior in the module.
- **Rush UI doesn't exist.** `src/app/rush/` mirroring the practice/daily structure: `RushPage`, `useRushSession`, CSS file. Strikes indicator (3 slots, filled on miss — danger tokens), running count and in-run streak in the play column header region, end-of-run card with the stats + share text + "run it back" CTA.

## Design constraint

There is no Rush screen in `docs/design/codoro-v2-arena.html`. Same rule that worked for Home: **compose entirely from the existing v2 system** — tokens, card surfaces, chip styles, the stat treatments, feedback patterns, Icons.tsx. Strikes should fall out of existing danger-token treatments. If the end-of-run card genuinely needs a visual pattern that doesn't exist anywhere in the app, stop and flag it for a Claude Design round rather than inventing one. The end-of-run card is a share/retention moment — bias toward the boldest existing treatments, not new ones.

## Share text

Per-run, clipboard, same mechanism as Daily's (reuse the share plumbing, don't fork it): something like `Codoro Rush — 23 solved · 🔥 best 31 — getcodoro.com`. Match Daily's format conventions; no spoilers problem here, so keep it punchy. Exact copy is Thomas's to tweak — put it in one obvious template function.

## Telemetry

Rush attempts flow through the existing PostHog choke point with `mode: 'rush'` plus run-level context (run id, position in run, difficulty served). End-of-run event with final score. The build plan wants this data for calibration even though Rush is unrated.

## Definition of done (build plan + orchestration guard)

- [ ] Full run: 3 wrongs end it, summary numbers correct, best score persists across restart and displays on Home/end card
- [ ] Unit test proving Rush attempts never call the rating update path **at the hook/orchestration layer** (spy-based, full-run simulation)
- [ ] Schema v3 migration with real v2-fixture test, matching the established pattern
- [ ] Engine tests: ramp start/step/floor, 70/30 weighting (statistical over N draws is fine), no-repeat within run, empty-bucket and pool-exhaustion fallbacks
- [ ] Rush attempts + end-of-run events visible in PostHog with `mode: 'rush'`
- [ ] Nav entry and Home card enabled only in the final commit; disabled state gone
- [ ] `pnpm validate` green; zero new dependencies; no hex outside `index.css`

## What you can verify yourself vs. what's on me

Own: everything above; also document (one paragraph in the PR description) how I can temporarily override my rating to play-test the ramp at low and high ratings — export/import edit is fine if that's the cleanest path; don't build a dev UI for it.

Mine: 5+ full runs on my phone judging feel — serving pace, whether 3 strikes arrives too fast at my rating, whether the ramp constant is right (that's why it's a named constant); confirming my rating is identical before/after runs; share text paste on iOS/Android.

## Orchestration

- Branch `phase-7-rush`, PR into `main` when green.
- Commit order: engine ramp module → schema v3 migration → session hook + guard test → Rush UI (page, strikes, end card, share) → telemetry + enablement. No batching.
- Delegate to a subagent: share-text template, CSS scaffolding, the statistical weighting test boilerplate. Keep your strongest reasoning on the schema migration and the rating-isolation guard — same category as Phase 6: mistakes there corrupt real stored data or silently break the "Rush is unrated" contract, which is a launch-blocking correctness promise.
- No AI attribution in commits.

When done: the ramp constants you chose and why, the migration shape, confirmation of the spy-test approach for the rating guard, the play-test override instructions, and anything you couldn't compose from the v2 system.
