# v2 Phase 2 — post-merge review (scrubber spike)

Review of the Phase 2 scrubber work as merged to `main` (`f7f651e..11c0e49`). Read against
`docs/prompts/claude_code_prompt_v2_phase2.md` and the Phase 2 section of `docs/v2-build-plan.md`.

Scope of this document: correctness and tech-debt findings, plus the two open design decisions
Phase 3 would otherwise inherit by default. No code changes were made — this is the write-up
requested before actioning anything.

**Verdict:** the phase's core thesis holds. Trace generation is real, the storage decision is
well-reasoned, and the go/no-go amendment is honest. One defect is live in production behaviour
(P0) and one design flaw is baked into both the schema and the five pilots (P1). Neither
invalidates the go/no-go's "proceed to Phase 3," but P0 should not sit on `main` and P1 gets
much more expensive after Phase 4 authors content against the current semantics.

---

## Severity summary

| ID  | Severity                      | Finding                                                                                            | Where                                                      |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| P0  | **Critical — live on `main`** | Scrubber puzzles are servable in Practice with no renderer; the card is unplayable and unescapable | `usePracticeSession.ts`, `PuzzleCardShell.tsx`             |
| P1  | **High — design**             | `var-value` and `output` checkpoints ask about state already visible on screen                     | `content/schema.ts`, all 5 pilots, `ScrubberDebugPage.tsx` |
| P2  | **Medium**                    | JS trace determinism is claimed but not enforced; the test cannot fail                             | `jsTraceGen.ts`, `jsTraceGen.test.ts`                      |
| P3  | Low                           | `vars` key order is not stable across steps within a trace                                         | `jsTraceGen.ts`                                            |
| P4  | Low                           | Multiple `console.log`s between steps join with a space, not a newline                             | `jsTraceGen.ts`                                            |
| P5  | Low                           | An `output` checkpoint cannot express "this line prints nothing"                                   | `content/schema.ts`                                        |
| P6  | Informational                 | `node:vm` isolation claim is overstated for Phase 4's threat model                                 | `jsTraceGen.ts`                                            |

---

## P0 — Scrubber puzzles are servable in Practice and unplayable there

**Critical. Reachable by users on `main` today.**

`usePracticeSession.ts`'s `poolForPattern` filters by pattern only:

```ts
const pool = resolvePool(puzzlePool) as ContentPuzzle[]
return pattern === null ? pool : pool.filter((puzzle) => puzzle.pattern === pattern)
```

`PuzzleCardShell` renders three conditional branches — `mcq`, `swipe-binary`, `tap-line` — with
no `scrubber` case. A scrubber puzzle therefore renders its prompt and snippet, then an empty
`.puzzle-card__interaction` div. `handleCommit` never fires, so `committed` stays false, so the
`Continue` button (gated on `committed && committedPayload`) never appears. The user's only
escape is a page reload.

**Exposure:** 5 of 113 puzzles in unfiltered practice. With the `scope-closures` pattern filter
applied it is 2 of ~9 — likely to be hit within the first few puzzles.

**Other modes:**

- **Rush is correctly guarded.** `isRushEligible` narrows to `RushInteraction` before
  `toRushPuzzle`, and the doc comment explains why the guard exists rather than relying on the
  call-site type error. This is the right pattern and the right reasoning.
- **Daily is safe by accident, not design.** `DAILY_CALENDAR` is a curated id list and none of
  the five new ids appear in it. Anything that regenerates that calendar from the pool
  reintroduces the bug in Daily.

**Root cause is the non-exhaustive shell, not the missing filter.** `PuzzleCardShell`'s chain of
`{puzzle.interaction === '...' && <Body />}` expressions is silently valid when a new union
member is added. A `switch` with a `default: assertNever(puzzle)` would have surfaced this as a
`tsc` error the moment `ScrubberSchema` joined the discriminated union. Phase 3 adds another
interaction body, so this recurs unless the exhaustiveness guard lands.

**Recommended fix (two parts):**

1. Derive the pools once in `src/content/index.ts` so no consumer has to remember to filter:

   ```ts
   export const quizPool = puzzlePool.filter((p) => p.interaction !== 'scrubber')
   export const scrubberPool = puzzlePool.filter((p) => p.interaction === 'scrubber')
   ```

   Practice, Daily, and Rush consume `quizPool`. `puzzlePool` remains only where the union is
   genuinely correct: `contentStats.ts`, and Phase 1b's `/puzzle/:id` lookup. This makes the
   whole bug class structurally impossible rather than a rule someone must remember, and it
   supersedes the need for a second `isRushEligible`-shaped filter in Practice.

2. Convert `PuzzleCardShell`'s interaction dispatch to an exhaustive `switch` with an
   `assertNever` default, so the next union member is a compile error rather than a blank div.

**Test gap:** nothing asserts that the practice pool excludes scrubber. Worth adding alongside
the fix, since the pool split is the invariant being protected.

---

## P1 — Two of three checkpoint types ask about state already on screen

**High. Affects the schema, all five pilots, and the debug harness identically.**

`ScrubberDebugPage`'s runner renders `steps[stepIndex]`'s variable map, then shows the checkpoint
whose `afterStep === stepIndex`. The consequence:

- `oob-009` checkpoint 2 asks "what is `sum`?" with `sum = NaN` printed three lines above the
  choices.
- `scl-010` checkpoint 2 asks for `vals` with `vals = [2, 2, 2]` already displayed.
- Only `next-line` is genuinely forward-looking — it asks about `steps[afterStep + 1]`, which
  has not been rendered.

This is not merely a harness bug. The schema refinement enforces the same reading:
`var-value` compares `choices[correct]` against `steps[afterStep].vars[target]`, and `output`
against `steps[afterStep].output`. The five pilots are authored around it, so Phase 3 and Phase 4
inherit it.

**Why it got through.** The phase prompt is internally inconsistent. It describes checkpoints as
"pause points where the player predicts **before the scrubber advances**", but specifies the
refinement literally as "`target` names a variable present in the trace **at that step**, and
`choices[correct]` **equals** the trace's value for it." Phase 2 implemented the literal text
faithfully and every test passes — but they pass for the wrong reason. This is precisely the
Amendment 4 failure mode the prompt opened by citing: a test that asserts an end state rather
than the mechanism.

**No test in the suite asserts that a checkpoint's answer is not already visible.** That is the
missing mechanical guarantee, and it is the same class of rule as
`validateSwipeDirectionBalance` — which the prompt explicitly named as the precedent for what
"the schema mechanically rejects bad content" means here.

### Option A — shift the question forward

Redefine a checkpoint at `afterStep: N` as asking about `steps[N + 1]` for all three question
types. The "cannot sit on the final step" rule generalises from `next-line` to all types.
Terminal-state checkpoints survive by moving one step earlier (`scl-010`'s `vals` question would
sit at `afterStep: 14`). Traces do not regenerate; only checkpoint placement changes.

- **For:** one uniform rule; fewer branches in the refinement; the UI never has to conceal
  anything.
- **Against — compound prediction.** "After the next line runs, what is `x`?" silently requires
  the player to first predict _which_ line runs next. At a loop boundary — where the interesting
  puzzles live — this fuses two questions into one, and a miss does not distinguish which half
  was wrong.
- **Against — authoring friction.** `steps[N + 1]` is frequently a loop header at which nothing
  changed, so a "value must change" guard would reject many otherwise natural placements.

### Option B — keep the semantics, mask at the pause (recommended)

The scrubber's natural beat is: the line has run, the vars panel shows `sum = ?`, the player
fills it in. The masked row _is_ the question, which reads as intentional rather than as a gap.
This is how debugger-teaching tools present the same interaction.

The objection to B is that it moves a correctness property out of the validator and into UI code,
which cuts against the phase's central thesis. That is fixable — B does not have to be UI-only.
Pair it with two new refinements:

1. **`var-value` hard-fails unless the target changed at this step** —
   `steps[N - 1].vars[target] !== steps[N].vars[target]` (a target absent at `N - 1` and present
   at `N` counts as changed). This guarantees the masked value is one the player had to compute,
   not one that has been sitting unchanged on screen for several steps.
2. **`output` hard-fails unless `steps[N].output` is present.** Today `actual` falls back to
   `''`, which can never match a `.min(1)` choice — so the requirement already exists implicitly
   and undocumented. Make it explicit (see P5).

`next-line` needs no change.

Phase 3 then owns one narrow, testable UI obligation: mask the target row at a checkpoint. A
render test asserting the target value is not present in the DOM at the pause covers it.

**Evidence the refinement is aimed correctly.** `scl-010`'s first checkpoint sits at
`afterStep: 7` asking for `i`. Step 6 has `i = "2"` and step 7 has `i = "2"` — unchanged, so the
answer was on screen a full step before the question. That checkpoint is weak under either set of
semantics, and rule 1 rejects it. `oob-009`'s `sum` checkpoint (60 → NaN across the step) passes
cleanly. One real hit among a handful of `var-value` checkpoints across five pilots is reasonable
evidence the rule discriminates.

**Cost if deferred:** Phase 4 authors 40–60 puzzles against whichever semantics are in place.
Changing them afterwards means re-picking checkpoints across the whole corpus.

---

## P2 — JS trace determinism is claimed but not enforced

**Medium.**

The two backends have asymmetric guarantees:

- **Python** restricts `__builtins__` to an allowlist (`pyTracer.py`) and pins
  `PYTHONHASHSEED=0` on spawn (`pyTraceGen.ts`) so `set`/`frozenset` repr order is stable. The
  amendment also documents a real nested-`repr()` address leak found and fixed while authoring
  `scl-010`. This side is solid.
- **JS** does neither. `vm.createContext({ console, [TRACE_FN]: trace })` yields a fresh realm
  with the full standard library, so `Math.random()`, `Date.now()`, and `new Date()` are all
  reachable from a snippet. A snippet using any of them produces a different trace on every run,
  and the resulting puzzle still passes `validate:content` — the validator only checks internal
  consistency, never reproducibility.

The determinism test generates a deterministic snippet twice and deep-compares. It cannot fail,
regardless of whether the guarantee holds. This satisfies the DoD line by construction rather
than by mechanism.

**Recommended fix:** freeze `Math.random` to a seeded PRNG (or remove it from the context) and
pin `Date` in the sandbox, then add a test that a snippet calling `Math.random()` either throws a
clear authoring error or traces identically across two runs. The Python side already demonstrates
the intended posture; this brings JS to parity.

---

## P3 — `vars` key order is not stable across steps

**Low, but it will be visible in Phase 3's UI.**

`bindingNamesInScope` returns `Object.keys(path.scope.getAllBindings())`, which is scope-insertion
order. In `oob-009` this yields `sum, arr` for the first two steps and `i, sum, arr` from the loop
onward — the variable panel reorders mid-scrub as bindings enter scope.

Run-to-run this is deterministic, so the DoD determinism test passes. It is a rendering-stability
problem, not a correctness one: a panel whose rows jump position as the user scrubs is
distracting in exactly the moment the user is comparing values across steps.

**Recommended fix:** either sort keys, or preserve first-seen order across the whole trace so a
variable keeps its row once it appears.

---

## P4 — Output from multiple `console.log`s joins with a space

**Low, but it interacts with `output` checkpoints.**

`sandboxConsole.log` accumulates into `outputSinceLastTrace` joined by `' '`, so two separate
`console.log` calls between trace steps collapse onto one line. Since `output` checkpoints
compare that string exactly, the display string and the real program output can disagree.

Also: the debug harness labels the field `output so far:`, but the value is output _since the
previous step_, not cumulative. Worth correcting before Phase 3 copies the label into real UI.

**Recommended fix:** join with `'\n'`, and relabel in the harness.

---

## P5 — An `output` checkpoint cannot express "this line prints nothing"

**Low — likely intentional, currently undocumented.**

`ScrubberCheckpointSchema` requires `choices` items to be `z.string().min(1)`, and the refinement
computes `actual = step.output ?? ''`. An empty string can therefore never be `choices[correct]`,
which means an `output` checkpoint can only sit on a step that actually produced output — and the
question "does this line print anything?" is inexpressible.

This is probably the right constraint, but it is currently an emergent consequence of two
unrelated rules rather than a stated one. Make it an explicit refinement with a clear error
message (see P1 option B, rule 2), so an author who tries it gets told why rather than getting a
confusing choices mismatch.

---

## P6 — `node:vm` isolation claim is overstated

**Informational — matters at Phase 4, not now.**

`jsTraceGen.ts`'s doc comment states "no require, process, fs, or timers are reachable from the
sandboxed snippet." That is true of the naive path, but `node:vm` is explicitly not a security
boundary — `this.constructor.constructor('return process')()` reaches out of the context.

This is fine while snippets are hand-authored by you. Phase 4 executes LLM-generated snippets,
which changes the threat model from "my own code" to "code I did not write." The Python backend
already runs in a child process; the JS backend does not.

**Recommended:** either soften the doc comment to match what `node:vm` actually provides, or move
the JS generator to a child process before Phase 4 begins batch generation. Not urgent now, but
worth deciding deliberately rather than discovering.

---

## What the phase got right

Recording this explicitly, because the findings above are not the whole picture.

- **The storage v4 decision is the strongest work in the phase.** A nullable
  `checkpoint_results` array with `.default(null)`, an honest no-op `UserProfile` migration so v4
  has one unambiguous meaning, and the two rejected alternatives written into the doc comment
  with the reasoning. It also correctly identifies that `AttemptSchema` has never been part of
  the versioned migration chain and explains why retrofitting per-record migration for one
  nullable field is disproportionate. That is exactly the standard the repo should hold.
- **Thirteen per-refinement corrupted fixtures**, not one blanket "invalid puzzle" test — the
  prompt asked for this specifically and it was delivered.
- **Rush's `isRushEligible` guard** is correct, correctly typed, and its doc comment explains why
  a runtime guard exists rather than relying on the call-site type error.
- **Constraints held:** `AttemptMode` unwidened, `selectNext` untouched, engine folder stayed
  React-free, no `src/app/pwa/` changes.
- **The debug route is genuinely absent from `dist/`** — verified by grep, as required, not by
  reasoning. New dependencies are `devDependencies` only.
- **Bundle bytes were measured, not estimated** — two builds with and without the pilot files.
  Mean 1,814 bytes raw / 1,393 bytes bundled per puzzle, comfortably under the ~5 KB alarm
  threshold, with the Phase 4 extrapolation correctly flagged against Phase 7's reclaim target.
- **The go/no-go amendment is honest**, including the parts that make the phase look worse: the
  20-minute tooling-bug tax on `scl-010`, the refusal to self-assess "is it fun," and the named
  Python-specific limitations around closures and comprehension frames.

---

## Open decision — how scrubber separates from the quiz modes

The pool split in P0 is correct under every option below and commits to nothing. The remaining
question is the mode and the rating.

**Mixed into Practice — not recommended.** Beyond the pacing problem (a ~90-second
multi-checkpoint puzzle between ~12-second cards), `difficulty_rating` is author-assigned and
will not be empirically calibrated until Phase 6. Mixing an uncalibrated hard interaction into
the same Elo ladder means early scrubber content silently distorts the single number the user
reads as progress. The requeue ladder compounds it: a missed scrubber requeues, and re-serving a
90-second puzzle costs far more than re-serving a card.

**Own mode with its own rating.** Conceptually the honest split — pattern recognition and
execution simulation are different skills, and two ladders calibrate independently. The costs are
larger than they appear: a second field on `UserProfile` (schema v5), every rating read site in
practice/daily/rush/`MasteryView`/`StatusBar` needing to know which rating applies, and two
numbers where the user expects one. Elo also converges slowly, and at Phase 4's 40–60 puzzle
target a separate ladder is thin. It contradicts the locked decision already documented in
`scrubber.ts`: "one binary rated outcome per puzzle, exactly as v1, so Elo semantics don't change
and existing ratings stay comparable."

**Own mode with a shared rating — recommended.** Buys the pacing fix and the conceptual
separation for the cost of a route and a session hook, a pattern Rush already establishes. Keeps
one progression number and the Elo semantics Phase 6's calibration work assumes. Most importantly
it is reversible forward: `checkpoint_results` is already being logged, so Phase 6 can split the
ladder on evidence. Merging two ladders after users have seen two numbers is not cleanly
reversible.

**Related, decide separately:** whether Daily eventually serves scrubber. One deep puzzle per day
is arguably a stronger ritual than a daily MCQ, and it is the highest-leverage placement for the
format. The curated-calendar design already supports it; this is a Phase 3+ content call.

---

## Recommended sequencing

1. **P0 now, as a corrective commit on `main`.** Users can hit the dead card today. Pool split
   plus the `assertNever` exhaustiveness guard.
2. **P1 before Phase 4, ideally before Phase 3.** Whichever option is chosen, deciding it before
   the UI is built means Phase 3 implements against correct semantics and Phase 4 authors against
   them. Deferring means re-picking checkpoints across 40–60 puzzles later.
3. **P2 before Phase 4.** Batch generation is when a non-reproducible trace slips into content
   unnoticed.
4. **P3–P5 with Phase 3**, since they surface as UI concerns and the fixes are small.
5. **P6 as a deliberate Phase 4 decision**, not a silent one.
