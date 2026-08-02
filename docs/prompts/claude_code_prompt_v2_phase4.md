# Prompt for Claude Code — v2 Phase 4 (scrubber content pipeline + volume)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**Check the branch state before anything else.** This phase assumes `c5e0e89` ("v2 Phase 3: Trace mode (scrubber UI) (#37)") is in `main`'s history **and** that PR #38 (v2 Phase 1b — shareable links) has merged. If #38 is still open, stop and ask whether to proceed anyway — nothing here depends on it functionally, but branching Phase 4 off a `main` that's about to take a merge will cost you a rebase, and that's the user's call, not yours. Work on `v2-phase-4` off `origin/main`, PR back to `main`.

Scope is `docs/v2-build-plan.md` **Phase 4**, plus the OD-2 and OD-3 rows in "Known open defects" — both carry a decision deadline of "before Phase 4's first batch generation run," and both decisions are recorded below as locked. Read the Phase 4 section, both OD rows in full, and the Phase 3 pre-merge corrective amendment (specifically its rejected-alternative reasoning on co-valued checkpoints) before writing code. The plan is authoritative. Append an amendment if your work contradicts it; silent divergence is this repo's named failure mode.

Standing rules, unchanged: `src/app/pwa/` is hands-off (list any touched file there in your summary), no hex outside `index.css`, no AI attribution in commits, `pnpm validate` must not require Python, `src/engine/` stays React-free, `selectNext` untouched, telemetry stays snake_case and additive. **Zero new dependencies** — `node:child_process` is stdlib and in scope; anything from npm is not.

---

## Ask questions. This phase is the one where guessing is expensive.

Every phase before this one was reversible. This phase writes puzzle files whose `id`s are permanent by house rule (`PATTERN_PREFIXES` in `generatePuzzles.ts`: "Once assigned, never change — ids are forever"), and it consumes the user's curation time, which is the actual scarce resource here. It is _not_ dollars: under decision 4 this run spends no credits at all, and even on the API backend the whole 60-puzzle run measures out at a few dollars. Do not let a cost guard's green light stand in for judgment about whether the content is worth keeping.

**Stop and ask rather than deciding on your own authority if any of these come up:**

- A locked decision below appears to contradict something you find in the code or the plan. Report the specific contradiction; do not pick a side.
- The two-pass generation shape (Item 4) turns out not to fit `generatePuzzles.ts`'s existing structure without a rewrite larger than a sibling module.
- The deterministic distractor synthesis (Item 4) can't produce enough plausible wrong answers for some checkpoint kind, and you're tempted to fall back to asking the model for them.
- The pattern allowlist (locked decision 6) leaves you unable to hit the rating spread or bucket-coverage targets, and you're tempted to add a pattern back.
- The pilot measurement (Item 6) is ambiguous — Haiku's rejection rate lands near the abort threshold rather than clearly above or below it.
- Anything about the run costs more than the projected ceiling, for any reason.
- You believe a puzzle the validator accepted is bad, and you can't articulate a machine-checkable rule that would have caught it.

Asking is cheap here and re-running a batch is not. "I proceeded because it seemed reasonable" is the failure mode this section exists to prevent.

---

## Decisions — locked, do not relitigate

1. **OD-3 is fixed UI-side, not content-side.** Mask answer-valued cells across the step range while a checkpoint is pending, rather than only at the exact `afterStep`. **Do not** add the candidate validator rule ("no variable, at any step from `afterStep` back to the previous checkpoint, may equal the answer"). Reasoning, recorded so it isn't re-argued: backward scrubbing is unbounded, so the content rule would have to hold across most of a trace — on `tc-009`'s 17 steps with 2 checkpoints, nearly all of it — which makes it a brutal generation filter that raises retry rate and cost and fights the pattern-coverage targets; it rejects `tc-009` checkpoints 0 and 1 as authored, so you pay content edits _and_ the permanent constraint; and it is a close cousin of the co-valued rule the Phase 3 corrective already rejected for damaging `mut-009`'s aliasing pedagogy. Read that rejected-alternative section before proposing any variant of this again.

   **Scope the mask narrowly**: mask the specific answer-valued cells over the pending range, not whole rows and not whole steps. A player scrubbing backward to re-read the trace must still be able to read it; a range fix that turns the state panel into a wall of `?` has traded one defect for a worse one. If you cannot make that distinction cleanly in the current gating model, stop and report rather than shipping the coarse version.

   This fix is not machine-verifiable, so it takes the repo's revert-check discipline: a test that goes red when the range branch is deleted, written against the real `scrubberPool` per `src/content/README.md`'s fixture rule, not a hand-built fixture. Re-audit the whole pool for this leak vector — the OD-3 row was written from one adversarial pass that happened to hit `tc-009`, not an exhaustive sweep.

2. **OD-2 is fixed by isolation, before any generation run.** Move `jsTraceGen.ts`'s execution to a child process, mirroring the pattern `pyTraceGen.ts`/`pyTracer.py` already establishes in-repo. The concrete blast radius, which the OD row states abstractly: `generate:puzzles` runs as `tsx --env-file=.env`, so the Anthropic API key is in `process.env` of the exact process running `vm.runInContext` — and the confirmed escape payload reaches the real host `process`. Phase 4 runs unreviewed model-written snippets through that generator, unattended, dozens of times.

   Note what this is _not_ fixing: `DEFAULT_MAX_TRACE_STEPS` and `DEFAULT_TIMEOUT_MS` in `traceGen/types.ts` already cover hangs adequately. This is about the escape and the key, so don't let the work drift into re-engineering the step budget. Preserve the existing `jsTraceGen` public signature and its test suite — `jsTraceGen.test.ts` should pass unchanged or the change is bigger than it needs to be. Close the OD-2 row in the defects table in the same commit.

3. **Model split: Haiku 4.5 generates, Sonnet 5 reviews** — with the abort criterion in Item 6. Review is the only stage where a wrong judgment ships; generation is bounded by a schema, three few-shot examples, the trace executor, and the validator.

4. **The pipeline gets a pluggable model backend, and this run uses the CLI one.** `generatePuzzles.ts` today calls the Messages API via `@anthropic-ai/sdk` with an `ANTHROPIC_API_KEY`, which bills to a Claude Platform account. The user does not have credits and is on a Pro plan, which does not cover Console/API usage. Per Anthropic's help center as of the 2026-06-15 pause notice, `claude -p` (Claude Code non-interactive mode) draws on the **subscription's** usage limits — so the run is affordable through the CLI and not through the SDK.

   Build a backend seam with two implementations: the existing `api` backend (unchanged, kept for Phase 6 quiz volume and for whenever credits exist) and a new `cli` backend that shells out to `claude -p --model <model>` via `node:child_process`. **Default to `cli`.** Select with a flag, and fail loudly with a clear message if the chosen backend's credential/binary isn't present rather than silently falling through to the other.

   No new npm dependency — `node:child_process` is stdlib, and you are already adding it for Item 3. Do **not** add `@anthropic-ai/claude-agent-sdk`; that would break the zero-dependency rule for something the CLI already does. Do **not** attempt to authenticate `@anthropic-ai/sdk` with a subscription token; that is not a supported path and is not what this decision authorises.

   **The known regression, and you must design for it rather than discover it:** the `api` backend gets real structured output via `zodOutputFormat`. `claude -p` does not offer that guarantee — the CLI backend prompts for JSON, extracts it, and hands it to the same Zod validation, which is already the authoritative check (`PuzzleSchema` + `superRefine`, per the file's own doc comment). `MAX_GENERATION_ATTEMPTS = 3` absorbs the parse failures. Expect a higher retry rate on the CLI backend than the API backend, at any model. Verify the exact `claude -p` flags against the installed CLI's `--help` before building against them — do not assume flag names from memory, and report what you find.

5. **Staged run: 10 → stop → 30 → stop → top up.** Not one batch of 60. The abort points are for the user's curation time, not the money. Each stage ends with a hard handback (Item 7), not a judgment call by you.

6. **Pattern allowlist for scrubber content** — generate only: `off-by-one`, `mutable-state`, `scope-closures`, `type-coercion`, `control-flow`, `recursion-termination`, `data-structure-misuse`. Seven patterns across 40–60 puzzles is 6–8 each, which is a coherent per-pattern target instead of whatever the prompt happens to favor.

   Excluded deliberately, with reasons that belong in the amendment: `concurrency` is _unrepresentable_ in this format — a trace is deterministic and single-threaded, so a race condition cannot be expressed, and any concurrency "scrubber puzzle" would pass every machine check while teaching nothing. `null-undefined`, `input-validation`, and `error-handling` are typically one-step failures with no interesting intermediate state. These stay available to quiz content; the allowlist is scrubber-only.

7. **Language mix 60/40 JS/Python**, per the plan. Current pilots are 3/2 — already on ratio.

8. **The anti-anchoring clustering check is advisory in Phase 4, a hard gate in Phase 6.** The >15%-on-one-rating threshold is N-dependent: at a staged pilot of 10, two puzzles sharing a rating is 20% and would block a run for a non-defect. Emit it as a `content:stats` warning now; the plan's Phase 6 DoD is where it becomes a failure.

9. **Out of scope, do not drift into:** OD-1 (still Phase 8, still undiagnosed — do not speculatively retune any gesture), Phase 5 quiz upgrades, Phase 6 quiz volume or recalibration, Daily serving scrubber content, any rating/Elo change, the Batch API (a 50% discount on a ~$2 run is not worth the async complexity).

---

## How to run this: orchestration

Run this as an orchestrator, but **a deliberately lean one** — see the budget note below, which is the reason this section is shorter than Phase 3's.

- **Lead (you)** — sequencing, all implementation, and every design call: the range-masking model (Item 2 is the hardest problem in this phase), the backend seam (decision 4), the two-pass pipeline shape and the deterministic distractor strategy (Item 4), the interestingness bar, and all amendment prose. Do not delegate amendment wording.
- **Haiku subagents** — only genuinely mechanical, parallel sweeps where the answer is a list and the lead would otherwise burn context reading many files: the full `scrubberPool` OD-3 leak sweep (which puzzles/checkpoints leak, via target row or sibling row), and enumerating every call site of `jsTraceGen`. Not for reading a single file — read it yourself.
- **Sonnet reviewer subagents** — the mandatory review loop below. This is the one delegation that stays non-negotiable.

**Review loop — mandatory, per item.** After each item, spawn a **fresh reviewer subagent (sonnet, no prior context)** with the item's brief and the diff, asking: _does the test fail if the fix is reverted?_ The reviewer checks mechanisms, not end states — delete the range-mask branch and confirm the pool test goes red; point the isolated trace generator at the escape payload and confirm it can't reach `process.env`. Loop until clean, then commit. Granular commits, one concern each. Phases 2 and 3 both had real bugs caught only by a context-free reviewer; that history is why this survives the trimming.

**Budget discipline — this is different from previous phases.** Under decision 4 the generation calls run through `claude -p` on the user's Pro subscription, and _this Claude Code session draws on the same pool_. Every subagent you spawn is generation budget not spent on puzzles. That is the explicit reason the delegation list above is narrower than the Phase 3 prompt's: keep the reviewers and the sweeps, do the rest inline. If you find yourself wanting to spawn something not listed above, say why in your summary rather than just doing it.

---

## Item 1 — Gate A: per-model constants and the backend seam (blocking precondition)

Two halves. Build the seam from decision 4 first, then fix the cost guard.

**The cost guard.** `generatePuzzles.ts` has one `MODEL` constant used for both generate and review, and one pair of `INPUT_COST_PER_MTOK` / `OUTPUT_COST_PER_MTOK`. The moment the models differ, the guard is silently wrong — the plan's named blocking precondition. Split into per-model constants with per-model pricing and make `costOf` take the model.

Do this **even though the CLI backend spends no credits.** It is plan-mandated, the `api` backend keeps it, and Phase 6 will need it. **Confirm current pricing at `https://platform.claude.com/docs/en/about-claude/pricing` on the day of any `api`-backend run and record what you saw in the commit message** — as of 2026-08-01 the Sonnet 5 intro rate of $2/$10 is live but **expires 2026-08-31**, after which it is $3/$15 and every projection built on the old number is 50% low. Haiku 4.5 is $1/$5.

`COST_CEILING_USD = 0.7` is wrong for the `api` backend for a different reason than the plan implies. Re-derive it: the model never emits `steps[]` (the trace generator does), so a scrubber puzzle's token profile is a propose call, a checkpoint-placement call whose _input_ carries the trace, and a review call whose input carries the same. **Measure this against a real scrubber generation — do not scale the quiz estimate.** Set the ceiling at roughly 2.5× the measured projection; it is a runaway-loop circuit breaker, not a budget.

**The CLI backend needs its own guard, because dollars aren't the constraint there — subscription usage is.** A dollar ceiling is meaningless when no credits are spent, and removing the guard entirely would leave a runaway loop free to drain the user's Pro limits, which are shared with their interactive Claude Code work. Add a **call-count and token ceiling** per run for the `cli` backend, sized against the measured per-puzzle call count from the pilot. Report cumulative calls and tokens as the run proceeds, not only at the end.

Extend `--dry-run` to report the projection per stage, split by model and labelled with the active backend and what unit it's spending (credits vs. subscription usage).

---

## Item 2 — OD-3 range masking (blocking precondition)

Locked decision 1 above has the full brief. Blocking because content generated under a leaking UI may be content you'd have authored differently.

Sequence: the Haiku pool sweep first (which puzzles leak, at which checkpoints, via target row or sibling row), then design the range model against real cases, then implement, then the revert-check review. Report the sweep results before implementing — if the sweep finds the leak is far more widespread than `tc-009`, that's information about the masking model, and it may change what "narrow" can mean.

---

## Item 3 — OD-2 child-process isolation (blocking precondition)

Locked decision 2 above has the full brief. Blocking for the obvious reason: it must land before any model-written snippet executes.

Add a test that the confirmed escape payload (`this.constructor.constructor('return process')()`) cannot reach the host process from the isolated backend. That test is the evidence the OD-2 row closes on.

---

## Item 4 — The scrubber generation pipeline

**Design call, yours: sibling module (`generateScrubberPuzzles.ts`) or extension of `generatePuzzles.ts`.** The plan allows either. Read both and decide; the shared surface worth reusing is the id-counter logic, `writePuzzle`, the cost accounting, and the validation loop — the divergent parts are the manifest, the prompt, and the two-pass shape below. Record the call and its reasoning in your summary.

**The plan's item 1 has a spec bug you need to fix, not follow.** It reads "LLM proposes snippet + bug + checkpoint placements → trace generator executes → validator asserts." Proposing placements before the trace exists is impossible for anything but `next-line`: a `var-value` checkpoint's `choices` are actual values at actual steps, and they don't exist until execution. Generation is necessarily **two-pass**:

1. **Propose** — model emits snippet, pattern, language, prompt, explanation, difficulty. No `steps`, no `checkpoints`. The model must never emit a trace; `traceGen` is the only source of truth for `steps[]`, per `traceGen/types.ts`.
2. **Execute** — the isolated trace generator produces `steps[]`.
3. **Place checkpoints** — against the real trace.

Note this contradicts `traceGen/types.ts`'s doc comment ("`checkpoints` … is a human/LLM authoring decision, not something a trace tool derives from execution") only in emphasis, not in fact — the trace tool still doesn't decide; the placement pass does, now with the trace in hand. Update that comment if you change what's true, and say so in the amendment.

**Deterministic distractor synthesis.** For `var-value` and `output` checkpoints, derive `choices` from the trace rather than asking the model to invent them: the best distractors are values the variable _actually held at other steps_, because those are precisely the stale-state and off-by-one wrong answers the puzzle is teaching. See `tc-009` — `count`'s real values across the trace (`"0"`, `"1"`, `"2"`, `"3"`) are better wrong answers than anything a model would fabricate. This is cheaper, more reliable, and pedagogically better. The model's judgment is still needed for _which step is worth pausing at_; the choice set is machine work. If some checkpoint kind can't be served this way, stop and ask (see the questions section).

Every checkpoint must satisfy `ScrubberSchema`'s `superRefine` rules already in `src/content/schema.ts` — ordering, range, uniqueness, the `var-value` changed-since-previous-step rule, the `next-line` not-on-final-step rule. Anything inconsistent is **rejected automatically, never reviewed by a human**; human/LLM review is only for "is this interesting." That split is the plan's rule and it holds here.

**Scrubber-scoped gap manifest.** `buildGapManifest()` is quiz-shaped: its `INTERACTION_CYCLE` is `swipe-binary`/`mcq`/`tap-line`, and it computes per-pattern spread over `loadValidPuzzles()`, which returns _all_ puzzles. Write a scrubber manifest that scopes spread and bucket coverage to scrubber content only, honours the pattern allowlist, and steers the 60/40 language mix. Keep the existing manifest's two properties — gap-driven and idempotent — because they are what makes the staged run cheap: each stage recomputes against what's now on disk and targets only the remaining gaps.

**While you're there, a real bug to fix or file:** because `buildGapManifest` counts scrubber puzzles into per-pattern spread, the _quiz_ manifest is already contaminated by the five pilots — `scope-closures` looks better covered in quiz terms than it is. Verify this is actually true before acting on it. If it is, either fix it here (scope the quiz manifest to quiz interactions) or add it to the open-defects table with an owner phase. Do not leave it undocumented.

**Difficulty anti-anchoring.** The rubric prompt applies S/T/D/C dimensions and instructs explicitly that ratings sum to non-round values. v1 clustered most of 104 puzzles at exactly 1000/1600/1700/1900; the plan's fix is the rubric, and locked decision 8 sets the warning's severity.

---

## Item 5 — Review prompt, with one scrubber-specific question

The self-review call keeps its existing framing (correctness the schema can't express) plus one question the quiz reviewer never needed:

> **Can these checkpoints be answered from the snippet alone, without stepping through the trace?**

That's the scrubber-specific failure mode: a trace that is perfectly consistent, passes every validator rule, and is still a quiz with extra steps. Nothing mechanical catches it, and it's the difference between the flagship mode being worth playing and being a gimmick.

Add the `content:stats` clustering warning here (advisory, >15% on any single rating value), alongside the existing pattern-spread and empty-bucket reporting.

---

## Item 6 — Pilot run of 10, and the model-split measurement

Run the manifest with `--limit=10`. This stage is **attended** — watch it.

Then measure, and report the numbers: **Haiku's rejection rate against Sonnet's on the same specs.** Re-run a subset with Sonnet generating to get the comparison.

**Separate the two failure modes, or the measurement is worthless.** Decision 3b predicts the CLI backend raises the _JSON parse-failure_ rate at every model, because it has no structured-output guarantee. That is a backend artifact, not a model-quality signal. Count and report separately:

1. **Parse/format failures** — malformed or unextractable JSON. Attribute to the backend.
2. **Semantic rejections** — well-formed output that `PuzzleSchema`/`superRefine` or the trace executor rejected. This is the model-quality signal.
3. **Review failures** — passed the machine, failed "is this interesting."

Only category 2 (and, with judgment, 3) drives the model decision. Folding category 1 into the comparison would blame Haiku for the CLI backend's known regression, and would push you to Sonnet for the wrong reason.

**Abort criterion, decided in advance so it isn't rationalised after the fact:** if Haiku's category-2 rate exceeds roughly 2× Sonnet's, the cheap model is _more_ expensive — three attempts cost more than one Sonnet call — and worse, it's spending the user's curation time on dull puzzles. Switch generation to Sonnet 5 and record the measurement in the amendment either way. If the result lands ambiguously near the threshold, **stop and ask** rather than picking.

Also report the measured per-puzzle call count, which is what Item 1's CLI-backend ceiling gets sized against.

---

## Item 7 — Hard handback (do not skip, do not decide past this)

After the pilot 10, **stop and hand back to the user.** Do not proceed to the 30. Report:

- The 10 puzzles, with `content:stats` before/after
- Actual measured cost, against the projection
- The Haiku-vs-Sonnet rejection numbers and your recommendation
- Anything the validator accepted that you think is bad, with the machine-checkable rule that would have caught it (or an explicit "I can't articulate one")

The user then plays them — including on a phone — and decides whether stage 2 runs. **This handback is not advisory.** Sixty puzzles generated under a wrong rule is the first mistake in this plan that costs real time to undo, and the pilot exists to catch exactly that.

Stage 2 (30) and the top-up stage repeat the same shape: run, report, hand back.

---

## Definition of done

Phase 4's plan DoD, plus what the locked decisions add:

- [ ] Backend seam exists with `api` and `cli` implementations, `cli` is the default, and choosing a backend without its credential/binary fails loudly rather than falling through
- [ ] Pricing constants are per-model and correct, verified against live pricing and recorded in the commit
- [ ] `COST_CEILING_USD` re-derived from a measured scrubber generation, not scaled from the quiz estimate; the `cli` backend has its own call/token ceiling
- [ ] Zero new npm dependencies
- [ ] OD-2 closed in the defects table, with the escape-payload test as evidence
- [ ] OD-3 closed in the defects table, UI-side, with a revert-check test against the real pool, and a full-pool leak sweep on record
- [ ] ≥40 scrubber puzzles live; `content:stats` shows the curve targets met and no round-number clustering warning
- [ ] Zero puzzles in the library whose checkpoints a machine couldn't verify
- [ ] Pattern allowlist honoured; language mix within reach of 60/40
- [ ] The pilot handback happened before stage 2, and the model-split measurement is recorded in the amendment

**Amendment.** Append a Phase 4 amendment to `docs/v2-build-plan.md` recording: the two-pass supersession of plan item 1, the pattern allowlist and why `concurrency` is excluded on representability grounds, the OD-2 and OD-3 decisions with their reasoning, the model-split measurement result, and the re-derived cost basis. Do not delegate this prose.

**Never do speculatively:** retune any gesture (OD-1 is Phase 8 and undiagnosed), add a content rule that compensates for a UI defect, or proceed past a handback because the results looked fine.
