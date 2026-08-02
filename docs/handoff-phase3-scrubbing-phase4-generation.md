# Handoff — Trace scrubbing affordance (Phase 3) + Phase 4 generation options

**Purpose:** a discussion handoff, not a build prompt. Two open subjects: (1) whether the Trace scrub affordance is actually usable on a phone, and (2) how Phase 4's generation run should be configured before any money is spent. Nothing here is locked; the point is to decide.

**Written:** 2026-07-31. Repo `codoro-app/codoro`. Plan of record: `docs/v2-build-plan.md`.

---

## Where things stand

|                 |                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `main`          | `c5e0e89` — v2 Phase 3: Trace mode (#37), including the pre-merge corrective                   |
| PR #38          | v2 Phase 1b — shareable links. Reviewed, corrective applied and verified, **ready to merge**   |
| Content         | 113 puzzles: 42 mcq, 39 swipe-binary, 27 tap-line, **5 scrubber**                              |
| Scrubber pilots | 3 JavaScript / 2 Python; patterns: scope-closures ×2, mutable-state, off-by-one, type-coercion |

Phases 0, 1a, 2, 3 are merged. Phase 1b is one merge away. Phase 4 is next in the flagship arc and is the first phase that spends real money.

**Do not relitigate these** — they're settled and documented in the build plan's amendments:

- Trace is its own mode/route (`/trace`), internals keep the `scrubber` vocabulary; shared Elo ladder, one binary outcome per puzzle.
- Attempts stamp `mode: 'practice'`; `AttemptMode` stays a three-value union.
- `steps[].line` is 0-indexed everywhere; the UI converts at the render boundary only.
- Checkpoint masking covers **every co-valued row**, not just the target. A validator rule rejecting co-valued checkpoints was considered and rejected — it would categorically kill the mutable-state aliasing pattern. See the Phase 3 amendment for the full reasoning before proposing it again.
- Local-first, no backend, no accounts in v2.

---

## Subject 1 — Is the scrub affordance actually usable?

### What shipped

`src/app/trace/Scrubber.tsx`. Three ways to move through a trace:

- **Horizontal drag track** — `@use-gesture/react` `useDrag`, `axis: 'x'`, `axisThreshold: { touch: 20 }`, `touchAction: 'pan-y'` on the track. Continuous: drag distance maps to step position via `mapDragToStepIndex.ts` (pure, unit-tested). One step per ~12% of track width, floor 24px.
- **Prev/next tap targets** — `‹` / `›` buttons, ≥ `--tap-target-min`.
- **Arrow keys** — the track is `role="slider"`, `tabIndex={0}`; Left/Right step by one. `@use-gesture`'s built-in key handling is disabled so there's exactly one code path.

Safe-area insets are wired on the track's **left/right** edges (the relevant ones for a horizontal control).

### What is and isn't verified

Verified: the pure step-mapping function, line highlighting, panel state, key-order preservation, arrow-key stepping, checkpoint gating, masking — all under jsdom, plus pool-level tests against real content. The full loop was driven end-to-end on the deployed preview with a mouse.

**Not verified: anything about real touch.** Gesture physics can't be exercised under jsdom, and no physical-device pass has happened. Two DoD lines remain explicitly unchecked in the Phase 3 amendment:

- All 5 pilot puzzles playable start-to-finish on a real phone
- Scrub gesture doesn't conflict with page scroll or PWA edge gestures on iOS

### The test the plan demands

Hand someone your phone on `/trace` and say nothing. If they can't figure out scrubbing within ~15 seconds, the affordance is wrong — fix before Phase 4.

Worth doing with 2–3 people, not one. And worth watching _what they try first_: if they reach for the code pane or swipe the card rather than the track, that's a discoverability problem, not a gesture-tuning problem, and the fixes are completely different.

### The risk nobody has priced — OD-1

`OD-1` in the open-defects table: **the swipe gesture in Practice is still unreliable on a real phone after both Phase 0 gesture fixes, and it is undiagnosed with no captured repro.**

The Trace drag surface is built on the same library, and its `axisThreshold: { touch: 20 }` was applied on the same reasoning that was supposed to fix swipe — and didn't fully. So there's a live possibility that the phone test fails for the same unknown root cause, in which case tuning the scrubber is treating a symptom.

**Question for the discussion:** if the phone test fails, does OD-1 get diagnosed first (it's owned by Phase 8 today), or does Trace get a scrubber-specific workaround? Doing the latter without the former risks shipping two independently-tuned gestures that share a defect.

### Open item — OD-3

Scrubbing **backward** one step from a pending checkpoint re-renders that step with no masking, so a sibling row can hold the answer. Confirmed on `tc-009` for both `var-value` and `output`; 5 of 7 checkpoints are clean. Just assigned to Phase 4 with a decision deadline.

Two candidate fixes, and the choice has to be made **before** generation, not after:

- **UI-side:** mask across the step range while a checkpoint is pending, not just at the exact pause. A real change to the gating model, not an extension of the row-set it already computes. Costs nothing in content.
- **Content-side:** a validator rule that no variable, at any step from the checkpoint's `afterStep` back to the previous checkpoint, may equal the answer. Unlike the rejected co-valued rule this would _not_ damage `mut-009`'s aliasing pedagogy — but it would reject `tc-009` checkpoints 0 and 1 as authored, and it constrains every puzzle the generator produces.

If the answer is content-side, the generator needs the rule before the batch run or you regenerate. That's the whole reason this is sequencing-critical rather than bureaucratic.

---

## Subject 2 — Phase 4 generation options

Target from the plan: **40–60 scrubber puzzles**, ≥800 rating points spanned per major pattern represented, no empty 200-point bucket in 800–2199, 60/40 JS/Python. Current pilots are exactly 3/2 — already on target ratio, just 12× short on volume.

### Gate A — pricing constants are wrong today (blocking precondition)

`src/content/tools/generatePuzzles.ts`:

```ts
const MODEL = 'claude-sonnet-5' // ONE constant, used for BOTH generate and review
const INPUT_COST_PER_MTOK = 2 // intro pricing through 2026-08-31
const OUTPUT_COST_PER_MTOK = 10 // standard rate is $3/$15 after
const COST_CEILING_USD = 0.7
```

Three separate problems:

1. **One model constant for two different jobs.** Generate and review both use `MODEL`. The plan's blocking precondition is splitting these into per-model constants with per-model pricing — the cost guard is silently wrong the moment they differ.
2. **The intro pricing expires 2026-08-31 — one month out.** If the batch run slips into September, `$2/$10` becomes `$3/$15` and every projection is 50% low. The plan already says to confirm pricing on the day of the run; this is the concrete reason.
3. **`COST_CEILING_USD = 0.7` is too low for this run.** At the current token estimates a quiz puzzle costs roughly $0.025 all-in, so 60 puzzles ≈ $1.50 — the ceiling halts the run less than halfway. And scrubber puzzles carry traces, so their token profile is bigger and the existing estimates don't apply. **Decision needed:** re-estimate against a real scrubber generation before setting the ceiling, rather than scaling the quiz number.

### Gate B — OD-2, `node:vm` isolation

`jsTraceGen.ts` executes snippets in-process via `node:vm`, which is not a security boundary (`this.constructor.constructor('return process')()` escapes it). Python already runs in a subprocess (`pyTracer.py`); JS does not.

This has been acceptable because Phase 2/3 snippets are hand-authored — "my own code." Phase 4 changes the threat model to "code an LLM wrote that I haven't read," executed on your machine, unattended, ~60 times. **Decision needed in writing before the first batch run:** move JS generation to a child process, or accept the risk with a stated rationale.

### Options to discuss

**Volume and staging.** 40 vs 60. Consider a staged run — generate 10, play them, then decide — rather than one 60-puzzle batch. The pilot set is 5; going straight to 60 is a 12× jump on a pipeline that has never run at volume. Staging costs a little more per puzzle in overhead and buys a cheap abort point.

**Model split.** Whether generation and review use the same model, and which. Cheaper generation with stricter review is a real option now that the constants are being split anyway. This interacts with Gate A directly.

**What the validator can and can't catch.** The machine can verify checkpoint consistency, determinism, and (if chosen) the OD-3 range rule. It cannot verify "is this interesting." The plan is explicit that human/LLM review is only ever for interestingness, never correctness — worth confirming that split holds for the scrubber pipeline, where a trace can be perfectly consistent and still pedagogically pointless.

**Difficulty anti-anchoring.** v1 clustered most of 104 puzzles at exactly 1000/1600/1700/1900. The plan calls for an S/T/D/C rubric summing to non-round values, plus a `content:stats` warning when >15% of the library sits on one rating value. Decide whether that warning is advisory or a hard gate.

**Pattern coverage.** Pilots cover 4 patterns; scope-closures has 2, everything else 1. Decide the target distribution across patterns before generating, or the batch will inherit whatever the prompt happens to favor.

---

## Suggested shape for the conversation

1. Do the phone test first — it's ~10 minutes and it's the cheapest risk reduction available before the most expensive phase. Bring back what people actually did, not just pass/fail.
2. Decide OD-3 (UI vs content), because content-side changes the generator's rules.
3. Decide OD-2 (isolation) — a yes/no with a written reason.
4. Then price the run: re-estimate scrubber token costs, split the model constants, set a real ceiling, choose staged vs single batch.
5. Only then write the Phase 4 build prompt.

**The one-way door:** everything before Phase 4 was reversible. Sixty puzzles generated under the wrong masking rule, the wrong difficulty distribution, or an unverified affordance is the first mistake in this plan that costs real money to undo. That's the reason for the ordering above, not process for its own sake.
