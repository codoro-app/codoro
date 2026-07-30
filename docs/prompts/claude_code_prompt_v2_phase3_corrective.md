# Prompt for Claude Code — v2 Phase 3 corrective (pre-merge)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**Check the branch state before anything else.** `origin/main` was at `2fab500` ("Phase 2 corrective: P0-P6 from the post-merge review (#36)") when this was written, and `v2-phase-3` was at `a3246a3`, **open and unmerged**. If Phase 3 has already been merged, stop and say so — this prompt is written to amend the open PR, and the item numbering, branch, and "no new branch" instruction below all change if it landed.

**This is a pre-merge corrective, not the usual post-merge one.** Phases 1a and 2 both merged and then took a follow-up PR. That is deliberately not the pattern here: the two findings below are player-facing correctness bugs in the flagship interaction, Phase 1b is gated on Phase 3 and reuses Trace's renderer directly, and the plan's own qualitative gate ("hand the phone to someone and say nothing") returns garbage signal while Finding 1 is live — a tester hits a self-contradictory question inside 20 seconds and you'd wrongly conclude the _scrub affordance_ is broken. **Commit onto `v2-phase-3` and update the existing PR.** Do not open a new branch.

Everything else about Phase 3 reviewed clean and is not in scope: `pnpm validate` is fully green (69 test files, 563 tests), all three route registries are confirmed in the built `dist/`, the debug route is absent from `dist/`, zero new dependencies, `src/app/pwa/` and `src/engine/` untouched, no hex outside `src/index.css`, no AI attribution. Four separate revert-the-fix checks were run against the branch and all four turned their test red (mask branch, `scrubberPool` import, `maxAllowedIndex` gating, the `lockedRef` double-click guard). Do not re-litigate any of that.

Standing rules, unchanged: `src/app/pwa/` is hands-off, no hex outside `src/index.css`, no AI attribution in commits, `pnpm validate` must not require Python, `src/engine/` stays React-free, `selectNext` untouched, `AttemptMode` stays a three-value union, telemetry stays snake_case and additive. **Zero new dependencies** — nothing here needs one.

---

## The findings

Both were found by playing the deployed preview build. **Neither is caught by any existing test, and the reason is the same for both: every Trace test asserts against a synthetic fixture, and no test renders the real bundled `scrubberPool`.** That is the transferable lesson and Item 3 exists to close it permanently.

Note that the content files themselves are unchanged in the Phase 3 diff — both defects are latent from Phase 2. Phase 3 is simply the phase that put them in front of a player, and is therefore the phase that owns fixing them.

### Finding 1 (blocker) — `next-line` choices are labeled in a different base than the code gutter

`ScrubberStepSchema.line` is a **0-indexed** offset into the snippet's lines, and `validateScrubberCheckpoints` correctly enforces `choices[correct] === String(steps[afterStep + 1].line)` in that same base. But the UI renders line numbers **1-indexed** in two places — `Scrubber.tsx`'s gutter (`{i + 1}`) and `CheckpointPanel.tsx`'s `StateDiff` (`Line {nextStep.line + 1}`) — while `CheckpointPanel` renders the choice strings **raw**.

Observed on `mut-009`: the gutter shows lines 1–6, the question is "Which line runs next?", the choices are `1` / `4` / `5`, the correct answer is `1`, and the reveal reads **"Next: Line 2"**. Gutter line 1 is `function addTax(cart) {`; the line that actually runs next is gutter line 2, `cart.push('tax');`. A player who reasons correctly finds no matching choice and must guess, and whichever they pick the reveal contradicts the choice list.

All three `next-line` checkpoints in the pool are affected:

| puzzle    | choices shown | correct label | gutter line it means |
| --------- | ------------- | ------------- | -------------------- |
| `mut-009` | `1`, `4`, `5` | `1`           | 2                    |
| `oob-009` | `1`, `2`, `3` | `3`           | 4                    |
| `scl-009` | `1`, `2`, `4` | `4`           | 5                    |

### Finding 2 (blocker) — the mask is defeated by a co-valued variable in the same state panel

At a `var-value` pause the target's row correctly renders `?`, satisfying the DoD line literally. But nothing masks _other_ rows holding the same value, and the answer is frequently sitting in the panel verbatim.

Observed on `mut-009` checkpoint 1: `original` shows `?` while `cart` shows `["apple","banana","tax"]` two rows above — which is exactly the correct choice. The `output` direction has the same hole: on `tc-009` checkpoint 1 the question is "What did this line print?" with choices `5` / `3` / `2`, the answer is `3`, and the panel shows `count 3` and `v 3`.

Full pool audit:

| puzzle    | checkpoint                  | masked value               | also visible as |
| --------- | --------------------------- | -------------------------- | --------------- |
| `mut-009` | 1 (`var-value`, `original`) | `["apple","banana","tax"]` | `cart`          |
| `tc-009`  | 0 (`var-value`, `count`)    | `1`                        | `v`             |
| `tc-009`  | 1 (`output`)                | `3`                        | `count`, `v`    |

That is 2 of 5 `var-value` checkpoints and **1 of 1** `output` checkpoints. The output case is not a fluke of this content: `print(someVariable)` is the ordinary shape of an output checkpoint, so Phase 4's generator will reproduce it at volume unless the UI closes it.

---

## Decisions — locked, do not relitigate

Implement these; do not reopen the alternatives. If implementation surfaces evidence one is wrong, **stop and report with the evidence** rather than silently choosing differently.

1. **Finding 1 is fixed in the UI, not in content and not in the validator.** The 0-indexed `line` convention is correct and internally consistent — the trace generators, `ScrubberStepSchema`, the validator refinement, and `steps[].line` all agree on it, and changing that base would ripple through Phase 2's tooling for no gain. What is wrong is that `CheckpointPanel` renders a `next-line` choice as a raw string while every other line-number surface adds 1. Convert at the render boundary only, in `CheckpointPanel`. `StateDiff` already converts correctly and stays as-is.

2. **Finding 2 is fixed in the UI, and specifically NOT with a validator refinement rejecting co-valued checkpoints.** This is the important call and the obvious fix is wrong — here is the evidence, so you do not have to rediscover it and do not "improve" on it:

   In `mut-009`, `original`, `cart`, and `withTax` are the _same array by construction_ — that aliasing is the entire pedagogical point of the puzzle. Every step after step 0 therefore has a value collision, and the only collision-free `var-value` checkpoint available is step 0's pre-mutation `original = ["apple","banana"]`, a trivial question. A no-collision rule at the validator layer would **categorically reject the mutable-state aliasing pattern** — one of the four pattern categories, and the most interesting thing a scrubber can teach. Do not add that rule.

   The correct fix is that **the mask covers every row that would reveal the answer**:
   - At a `var-value` pause, mask the target's row _and every other variable row whose value equals the target's value at that step_.
   - At an `output` pause, mask the output _and every variable row whose value equals that output string_.

   For `mut-009` this is strictly better than the status quo, not merely safer: `original ?` and `cart ?` both hidden is precisely the aliasing insight the puzzle exists to teach, and it gives nothing away — both choices remain plausible, since knowing the two are equal does not tell you _which_ value they hold.

3. **`next-line` continues to mask nothing.** It asks about a step not yet rendered, and `maxAllowedIndex` already keeps `steps[afterStep + 1]` out of the DOM entirely. Unchanged.

4. **No content, schema, storage, telemetry, or engine changes.** If you conclude a content file must change, stop and report.

---

## How to run this: orchestration

Run this as an orchestrator. You (the lead) own sequencing, design judgment, and the merge decision. Delegate via the Task tool by the nature of the work:

- **Haiku subagents** — mechanical work: running the suite and reporting failures; re-confirming at the gate that `dist/` still lacks the debug route and that no package changed.
- **Sonnet subagents** — bounded implementation from a written brief: Items 1, 2, and 3 each.
- **Lead (you)** — the mask-propagation design in Item 2 (deciding where co-valued detection lives so `Scrubber` stays a pure display component), and the amendment prose. Do not delegate amendment wording.

**Review loop — mandatory, per item.** After each item, spawn a **fresh reviewer subagent (sonnet, no prior context)** with the item's brief and the diff, asking: _does the test fail if the fix is reverted?_ The reviewer checks mechanisms, not end states. This loop already earned its keep on this branch — it caught a real synchronous double-click race that every existing test passed through. Loop until clean, then commit. Granular commits, one concern each.

**One extra reviewer instruction specific to this corrective:** for every test you add, the reviewer must confirm it exercises the **real bundled `scrubberPool`**, not a fixture. A fixture-based version of either test would pass against the broken code — that is exactly how both defects reached a deployed build.

---

## Item 1 — Finding 1: `next-line` choice labels

In `CheckpointPanel.tsx`, render a `next-line` checkpoint's choices as displayed (1-indexed) line numbers, matching the gutter and `StateDiff`. Keep the conversion at the render boundary — `checkpoint.choices` and `checkpoint.correct` keep their existing meaning, and `handleClick` still reports the original index, so `CheckpointResult.choiceIndex` and everything downstream (scoring, storage, telemetry) are untouched. Guard the parse: `choices` is `z.array(z.string())` at the schema level, so decide and document what a non-numeric string renders as rather than emitting `NaN`.

**Tests:** a pool-level test — for every `next-line` checkpoint in the real `scrubberPool`, the rendered choice labels are exactly the 1-indexed line numbers the gutter shows, and the label of the correct choice equals the line number `StateDiff` reveals. Assert the choice-list and reveal agree; that agreement is the property that was violated.

Reviewer focus: remove the `+ 1` → the pool test goes red, and specifically red on `mut-009`, `oob-009`, and `scl-009`.

## Item 2 — Finding 2: mask propagation to co-valued rows

Implement Decision 2. `Scrubber.tsx` must stay a pure, fully-controlled display component — it currently receives `maskedTarget?: string` and `maskOutput?: boolean` from `TraceRunner`. Decide as lead whether the co-valued set is computed in `TraceRunner` and passed down (e.g. widening `maskedTarget` to a set of names, plus a flag for whether the output is masked) or derived inside `Scrubber` from the current step. Prefer whichever keeps `Scrubber` free of checkpoint semantics — it deliberately owns none today, and the doc comment says so. Whatever you choose, update both files' doc comments; they are unusually load-bearing in this directory.

Note the two directions are not symmetric: for `var-value` you mask variable rows equal to the _target's value_; for `output` you mask the output line _and_ variable rows equal to the _output string_.

**Tests:** a pool-level test — for every `var-value` and every `output` checkpoint in the real `scrubberPool`, render at the pause and assert the correct choice's exact string appears **nowhere** in the state panel or output line. This is the generalized form of the DoD's "masked value absent from the DOM" and it subsumes the existing fixture-based mask tests; keep those too as fast unit-level regressions.

Reviewer focus: revert the propagation so only the target row masks → the pool test goes red on `mut-009` cp1, `tc-009` cp0, and `tc-009` cp1. Confirm the test would also catch the output direction specifically, not just the var direction.

## Item 3 — Close the fixture-only gap the amendment must name

Both findings shipped past a fully green suite and a fresh final reviewer because no Trace test rendered real content. Items 1 and 2 each add a pool-level test; this item makes that a stated standard rather than an accident of this corrective:

- Add a short note to `src/content/README.md` (or wherever this repo documents content-test conventions — check before inventing a location) stating that any UI guarantee about checkpoint presentation must be asserted against the real `scrubberPool`, with these two findings as the worked example of why.
- Audit the remaining Trace tests and report — in the PR description, not necessarily as code changes — which other guarantees are fixture-only and would survive a real-content violation. You are not required to convert them all; you are required to say which ones are exposed.

## Item 4 — Build-plan amendment (lead writes this personally)

Append to the Phase 3 section's existing amendment, matching its register:

- Both findings, their root causes (0-indexed `line` convention rendered raw at one boundary and `+ 1` at two others; mask covering only the target row), and the fixes.
- **Why the validator route was rejected for Finding 2**, with the `mut-009` aliasing evidence — this is the part a future phase most needs, because the collision rule will look obviously correct to whoever proposes it next.
- A note to Phase 4: the generator will produce co-valued `output` checkpoints as a matter of course (`print(someVariable)` is the ordinary shape), and the mask propagation from Item 2 is what makes those safe. Phase 4 must not assume the validator screens them.
- The fixture-only testing gap from Item 3, named as the reason both defects survived review.
- Leave the two existing ⚠️ manual-verification lines (real-phone playability, iOS gesture conflict) exactly as they are — still open, still not checked off.

## Item 5 — Final gate

Full `pnpm validate` (typecheck, lint, tests, `validate:content`, build). Haiku subagent re-confirms: debug route still absent from `dist/`, no new packages, no `src/app/pwa/` files touched, no content/schema/storage/telemetry/engine changes. Then a **final fresh reviewer subagent** reads this prompt against the finished diff and reports anything skipped or silently divergent. Resolve, then update the PR description with the corrective's per-item summary appended to the existing one.

**Then re-verify by playing the deployed preview**, not just the test suite — both findings were invisible from the repo. Walk `mut-009` and `tc-009` end to end and confirm: the `next-line` choice labels match the gutter, the reveal agrees with the choice list, and no masked answer is readable anywhere else on screen.

---

## Out of scope — do not drift into

Content edits of any kind. Schema or validator refinements. Phase 1b. Phase 4's pipeline. The `axisThreshold` / gesture work (unchanged and correct). `SwipeBinary.tsx` or `gestureThreshold.ts`. Anything in `src/app/pwa/`. The `mode: 'practice'` stamp decision. `traceRecentIdsWindow`.

## DoD

- [ ] `next-line` choice labels match the code gutter and the reveal, asserted against the real `scrubberPool`
- [ ] No masked answer is readable elsewhere on screen at any `var-value` or `output` pause, asserted against the real `scrubberPool` (covers `mut-009` cp1, `tc-009` cp0, `tc-009` cp1)
- [ ] `Scrubber.tsx` still owns no checkpoint semantics; both doc comments updated
- [ ] No content, schema, storage, telemetry, or engine file changed
- [ ] Pool-level testing standard documented; fixture-only exposure audited and reported
- [ ] Build-plan amendment committed, including why the validator fix was rejected
- [ ] `pnpm validate` green; every item independently reviewed via the revert-the-fix check
- [ ] Both puzzles re-played on the deployed preview after the fix
