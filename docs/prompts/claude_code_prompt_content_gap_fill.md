# Prompt for Claude Code — Content: make puzzle generation gap-driven, not count-driven

Paste this into Claude Code in the codoro repo. `git fetch && git status` first, confirm `main` is up to date (the Phase 8 puzzle-content merge is in). This is content-tooling work, not an app phase.

---

## ⚠️ HARD BUDGET: $0.86 total — this is the entire remaining API balance

There is **86 cents** of credit left, full stop. A full-batch generation run can exceed that, so this task is as much about _not overspending_ as about closing the gaps. Treat these as non-negotiable:

- **Scope to the DoD minimum, not full coverage.** Do NOT generate puzzles to fill every empty bucket in every pattern — that's dozens of puzzles and will blow the balance. Generate only the handful needed to (a) clear the two failing patterns and (b) make the global 1200–1399 bucket non-empty. That's roughly **6–10 puzzles**, not 40.
- **Add a real, in-loop cost ceiling.** Add a `COST_CEILING_USD` constant (default **0.70**, leaving margin under 0.86 for review calls and rounding) and check the running total after each puzzle. When cumulative cost crosses it, stop the batch immediately and report — do not start another puzzle.
- **Order the DoD-critical puzzles first** (the two failing patterns, then the dead-zone fillers) so if the ceiling trips mid-batch, the most important gaps are already written.
- **Dry-run must print a cost estimate.** Extend `--dry-run` to project total cost from a conservative per-puzzle token assumption (use the existing `costOf` helper). If the projection exceeds `COST_CEILING_USD`, print a warning and shrink the manifest before I approve.
- **Do not touch `max_tokens`.** The 8192 ceilings exist because tighter caps truncated generation in testing — lowering them to "save money" just produces unparseable output that costs tokens and yields nothing. Leave them.
- **Keep `selfReview`.** It's ~half the per-puzzle cost but it's the quality guard, and a wrong explanation is worse than no puzzle. Budget for it; don't cut it.

**Show me the dry-run manifest + cost projection and wait for my go-ahead before any paid call.**

---

## The problem

Phase 8 filled every pattern to exactly 8 puzzles (104 total), so the count DoD reads as met — but the _distribution_ DoD is not. `pnpm content:stats` today:

```
Difficulty histogram
  800-999    6
  1000-1199  30
  1200-1399  0   <-- dead zone, zero puzzles
  1400-1599  14
  1600-1799  29
  1800-1999  11
  2000-2199  14
```

Two concrete failures:

1. **Global dead zone at 1200–1399.** Zero puzzles in the exact band a median user sits in. The rating engine can only serve them 1100s (too easy) or jump to 1500s (too hard), with nothing between.
2. **Two patterns violate the Phase 8 "≥800-point spread per pattern" DoD:**
   - `concurrency`: ratings `[1600,1600,1600,1700,2000,2050,2100,2100]` — range 500, **no easy puzzles at all**.
   - `error-handling`: ratings `[1000,1050,1075,1100,1500,1575,1575,1650]` — range 650, **nothing hard**.

   The other 11 patterns already pass ≥800, so this is targeted, not a rewrite.

## Root cause (in `src/content/tools/generatePuzzles.ts`)

`buildFullManifest` is **count-driven**: it tops each pattern up to `TARGET_PER_PATTERN = 8` and assigns difficulty via a three-value `bandCycle` (`low`/`mid`/`high`) advanced by a single global cursor. Two structural bugs fall out of that:

- **The bands don't cover the curve.** `BAND_RANGES` targets only `900-1100`, `1500-1700`, `1900-2150`. Nothing ever requests `1100-1500` or `1700-1900`, so the 1200–1399 hole is baked into the design — no amount of reruns fills it.
- **Per-pattern spread isn't guaranteed.** Because bands are assigned by a global cursor over each pattern's gap count, a pattern can receive bands that don't include a low _and_ a high of its own. That's exactly how `concurrency` got all-high and `error-handling` got all-low.

## What to change

Make generation **gap-driven by difficulty distribution**, reading what's actually on disk:

1. **Replace the count target with a _minimal_ coverage target.** For each pattern, read existing `difficulty_rating`s (reuse `loadRawPuzzleFiles`, same source `countExistingByPattern` already uses) and compute min/max/range. Generate the **smallest set of puzzles that clears the DoD**, nothing more: (a) for any pattern with range < 800, add just enough at the missing end to reach ≥800 spread; (b) fill the empty global 1200–1399 bucket, and prefer assigning those fillers to patterns that _also_ need spread help there so one puzzle does double duty. Do **not** try to make every pattern cover every bucket — that's out of budget. Expect a total manifest around 6–10 puzzles.
2. **Fix the band system so it can cover the whole curve.** Either widen `BAND_RANGES` to a continuous set of bands with no gaps (add the missing 1100–1500 and 1700–1900 territory), or drop discrete bands and pass a concrete target rating/range per spec. Whichever you pick, `buildUserPrompt` must keep telling the model to compute the real S/T/D/C-derived rating per `CALIBRATION.md` — the band is the _target_, the rubric still sets the final number.
3. **Handle target drift.** The model computes its own rating from the rubric, so a puzzle aimed at a bucket may land in an adjacent one. Don't assume the target is hit — re-derive gaps from what's actually written on each run, and keep the manifest idempotent so a rerun tops up only the buckets still empty (same top-up-not-duplicate behavior `buildFullManifest` has now). A puzzle that lands outside its target bucket but is otherwise valid is fine — it just may leave its intended bucket for the next run.

## Guardrails — do not regress these

- Keep the full pipeline: `PuzzleSchema` validation → independent `selfReview` → discard-on-fail (never patch a failed puzzle). No changes to `schema.ts`, `CALIBRATION.md` scoring, or `validateContent.ts`.
- Keep id ownership (`peekNextId`/`commitId`/`PATTERN_PREFIXES`) — ids are forever, never reassign existing ones.
- Keep the interaction mix roughly at today's ~45/35/20 swipe-binary/mcq/tap-line at the batch level.
- Keep cost logging and the `--dry-run` path. **Run `--dry-run` first and report the planned manifest before spending real tokens on a full batch.**
- No new dependencies.

## Also in scope — make the gap check a command, not an eyeball

Extend `src/content/tools/contentStats.ts` so `pnpm content:stats` also prints, per pattern, `min / max / range` and a **FAIL flag when range < 800**, plus a list of any empty 200-pt global buckets in range. This is both the verification for this task and the standing DoD check for the Phase 8 convergence gate.

## Definition of done

- [ ] `pnpm content:stats` shows every pattern with range ≥ 800 and zero FAIL flags
- [ ] No empty 200-pt bucket between ~900 and ~2150 (the 1200–1399 dead zone is filled)
- [ ] `concurrency` has ≥2 puzzles ≤~1400; `error-handling` has ≥2 puzzles ≥~1900
- [ ] A second `generate:puzzles` run with the curve already covered generates **nothing** (idempotent)
- [ ] `--dry-run` prints the gap-derived manifest **and a projected cost** without API calls
- [ ] `COST_CEILING_USD` guard exists and aborts the batch before spend crosses 0.70
- [ ] Total actual spend stayed under $0.86 (report it)
- [ ] `pnpm validate` green; no new deps; no changes to schema/calibration/validation semantics

## Orchestration

Branch `content/gap-driven-generation`, PR into `main`. Show me the `--dry-run` manifest and the updated `content:stats` output before running a full paid batch — I want to eyeball the gap plan and approve the spend first. If the redesign balloons past `generatePuzzles.ts` + `contentStats.ts`, stop and describe what you found. No AI attribution in commits.

When done: one paragraph on the new gap-derivation logic, the before/after `content:stats`, and the batch cost.
