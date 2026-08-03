# Prompt for Claude Code — v2 Phase 5b (drag-order, timers, streak-pause + payoff moments)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**This is an addendum, not a standalone brief.** The authoritative spec for this phase is `docs/prompts/claude_code_prompt_v2_phase5.md`, **"Phase 5b — Items 5–7"** plus locked decisions **1, 4, 5, 6, 7, 8, and 10** and the standing rules at its top. Read that first; nothing there is relitigated here. This file adds one item, one precondition, and a usage-budget discipline the original prompt didn't need.

**Precondition:** the `v2-phase-5a` PR must be **merged to `main`** before you branch. Work on `v2-phase-5b` off the updated `origin/main`. If 5a is not merged, stop and say so — do not branch off `v2-phase-5a`.

The plan (`docs/v2-build-plan.md`) has been updated since the original prompt was written: Phase 5's build list now carries item 4 (payoff moments), the Phase 5 amendment has items 9–10 recording this scope addition and a 5a review note, and new phases 5c/6b/6c exist downstream. None of the downstream phases are your scope. Decision 10's out-of-scope list still stands in full, and now also excludes: challenge links (Phase 5c), boss challenges (6b), missions (6c).

---

## Item 8 (added) — Payoff moments

Direct user decision, 2026-08 (todo.md item 5; recorded as Phase 5 build item 4 in the plan). Folded into 5b because it rides the streak-pause surface Item 7 builds. **Build Item 7 first; Item 8 extends it.**

Two moments, no more:

1. **New highest run-streak** (Practice and Trace only, same modes as the streak-pause per decision 8): when the streak-pause fires at a streak that exceeds the stored best, the pause itself carries the celebration — "New best streak" framing on the same screen, not a second interruption. Persist the best through `src/storage/`'s existing versioned path, same discipline as decision 1's `rushStats` migration: a few lines, not a project.
2. **New Rush personal best**: on the run-ended screen Rush already renders, when `bestScore` was just beaten. Rush is never interrupted mid-run (decision 8); the ended screen is the only legal surface.

Constraints, same spirit as Item 7's brief: smallest version that lands the beat — a moment, not a stats dashboard. **Explicitly excluded: any new-best-_rating_ celebration.** The stored rating is still inflated by pre-rebalance blind-right swipes (Phase 0's reset note), so "new peak rating" would celebrate an artifact. Do not add it.

Telemetry: additive, snake_case — a field or event distinguishing a streak-pause that carried a new-best from one that didn't, and a rush-run-end that set a best. Update `src/telemetry/README.md` in the same commit.

---

## Usage budget — this run is on a constrained allowance

The user is roughly halfway through today's Claude usage. The original prompt's "reviewers are affordable here" note is **downgraded**: spend deliberately.

- **Delegate more implementation than the original prompt allowed.** The lead keeps every design call (drag-order data shape, pointer-event drag model, checkpoint-timeout semantics, streak-pause/payoff interaction shape) and all amendment prose. But well-specified mechanical implementation goes to **cheaper subagents (Haiku)**: the timer-constant plumbing once the lead has decided where the clock lives, the stale-comment corrections in `rush.ts`/`RushPage.tsx` (decision 5's second paragraph), the progress-bar CSS, the `rushStats` migration boilerplate after the lead writes its shape, and test scaffolding from the lead's written assertions. Haiku gets a tight brief and a named file list, never an open-ended task.
- **Run the two Haiku sweeps from the original prompt first** (discriminant sites for the new `interaction`; `rushStats` read sites) — unchanged, they're already the cheap path.
- **Review loop stays mandatory but leaner.** Fresh Sonnet reviewer per item for the three design-heavy items (5, 6, 7+8 as one unit), given the item brief and the _tight_ diff only — not the whole branch. The revert-check question is unchanged: does the test fail if the fix is reverted? Mechanical commits (comment fixes, CSS) don't get their own reviewer; they ride the nearest item's review.
- **Stop rule, sharpened:** the original prompt's "if 5b runs long, stop after Item 5" now also applies to _usage_, not just time. If the allowance is nearly gone after Item 5 (`drag-order`), commit at that mergeable boundary, open the PR for what exists, and hand back with the remaining items listed. A merged half is worth more than an unmerged whole.

---

## Definition of done

The original prompt's Phase 5b DoD list stands in full (schema + exhaustive-switch sites + data-shape and Rush-inclusion calls recorded; real-device drag pass with device/OS/browser recorded; Rush flat 15s clock with both end paths into one ended phase; Trace 30s per-checkpoint clock with timeout as a normal `CheckpointResult`; named untuned constants; `visibilitychange` handling). Added:

- [ ] Streak-pause carries the new-best-streak framing when applicable; best streak persisted via the versioned storage path
- [ ] Rush run-ended screen marks a new personal best; no mid-run interruption anywhere
- [ ] No rating-based celebration exists anywhere in the diff
- [ ] Telemetry additions documented in `src/telemetry/README.md`
- [ ] Amendment appended to `docs/v2-build-plan.md`'s Phase 5 amendment section covering 5b's decisions (the amendment's own text promises this "once that PR lands") — written by the lead, not delegated
- [ ] `pnpm validate` green; zero new dependencies; one PR: `v2-phase-5b` → `main`
