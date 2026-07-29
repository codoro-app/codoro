# Prompt for Claude Code — v2 Phase 2 corrective (pre-Phase 3)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**Check the branch state before anything else.** `origin/main` was at `1657740` ("v2 Phase 2: scrubber trace format, engine, and tooling (#35)") when this was written. If that commit isn't in `main`'s history, stop and say so. Work on a new branch `v2-phase2-corrective` off `origin/main`, PR back to `main`.

This prompt actions `docs/v2-phase2-review.md` (the post-merge review of Phase 2). If that file is not in the repo root's `docs/`, it exists untracked in the working copy — **your first commit adds it verbatim as build history**, alongside this prompt file in `docs/prompts/`. Read it in full before writing any code. It is the source of truth for findings P0–P6; this prompt only adds the decisions and the execution order.

Standing rules, unchanged from every prior phase: `src/app/pwa/` is hands-off (list any touched file there in your summary), no hex outside `index.css`, no AI attribution in commits, `pnpm validate` must not require Python, `src/engine/` stays React-free, `selectNext` untouched, `AttemptMode` stays a three-value union, telemetry stays snake_case and additive. Zero new dependencies this time — nothing in this prompt needs one. If you believe you need one, stop and report.

---

## Decisions — locked, do not relitigate

These were decided against the review on 2026-07-29. Implement them; do not reopen the alternatives. If implementation surfaces evidence that one is wrong, **stop and report with the evidence** rather than silently choosing differently — silent divergence is this repo's named failure mode.

1. **P1 semantics: Option B — keep `afterStep` semantics, mask at the pause.** A checkpoint at `afterStep: N` asks about `steps[N]`, exactly as today. The UI (Phase 3, not this PR) masks the target row at the pause. What lands **now** are the two hard refinements that make B honest at the validator layer:
   - `var-value` hard-fails unless the target **changed at that step**: `steps[N-1].vars[target] !== steps[N].vars[target]`, where a target absent at `N-1` and present at `N` counts as changed. `afterStep: 0` counts as changed by definition (nothing was on screen before).
   - `output` hard-fails unless `steps[N].output` is present. This replaces the current emergent behaviour (`actual = step.output ?? ''` can never match a `.min(1)` choice) with a stated rule and a clear error message. This is also the P5 fix.
   - `next-line` is unchanged.
2. **Mode: scrubber gets its own mode with the shared rating.** This amends the build plan — Phase 3 as written says "first-class in Practice"; that is now wrong. This PR does **not** build the mode (that's Phase 3). This PR does the pool split that makes the quiz surfaces structurally safe, and rewrites the Phase 3 plan section so Phase 3 builds against the amended design.
3. **Sequencing: this corrective PR, then Phase 3, then Phase 1b.** Phase 1b stays gated behind Phase 3 because `/puzzle/:id` renders puzzles in their native interaction and there is no scrubber renderer until Phase 3 ships. Record this in the plan (see Item 5).
4. **Daily serving scrubber** is deferred as a Phase 3+ content call. The curated calendar already supports it; nothing here forecloses it.

---

## How to run this: orchestration

Run this as an orchestrator. You (the lead) own sequencing, design judgment, and the final merge decision. Delegate everything else via the Task tool, and pick the model by the nature of the work:

- **Haiku subagents** — mechanical, low-judgment work: locating every consumer of `puzzlePool`; regenerating pilot traces through the existing CLI; renaming the harness label; running the test suite and reporting failures; grepping `dist/` for the debug route.
- **Sonnet subagents** — bounded implementation with a written spec: each numbered item below is a self-contained brief a sonnet agent can implement once you've made the calls it flags to you.
- **Lead (you)** — the design calls: exact wording of the two new refinement error messages, checkpoint re-picks for the pilots (Item 4), and the build-plan amendment prose (Item 5). Do not delegate plan-amendment wording; it is the record future phases read.

**Review loop — mandatory, per item.** After each item's implementation, spawn a **fresh reviewer subagent (sonnet, no prior context)** with the item's brief and the diff, asking one question: _does the test fail if the fix is reverted?_ This is the Amendment 4 lesson — a test that asserts an end state passes for the wrong reason. The reviewer must actually check the mechanism (e.g., revert the pool split locally and confirm the new pool test goes red; feed a `Math.random()` snippet and confirm the determinism guard trips). If the reviewer finds a gap, fix and re-review. Loop until clean, then commit. Do not batch all items into one review at the end.

Commits stay granular, one concern each, in the order of the items below — the Phase 2 branch's history is the model.

---

## Item 1 — P0: pool split + exhaustive dispatch (first, it is live on `main`)

Per the review's recommended fix, both parts:

1. In `src/content/index.ts`, derive the pools once:
   ```ts
   export const quizPool = puzzlePool.filter((p) => p.interaction !== 'scrubber')
   export const scrubberPool = puzzlePool.filter((p) => p.interaction === 'scrubber')
   ```
   Practice (`usePracticeSession.ts`), Daily (`useDailySession.ts` / `dailyCalendar` validation), and Rush (`useRushSession.ts`) consume `quizPool`. `puzzlePool` remains only where the full union is genuinely correct: `contentStats.ts` / `validateContent.ts`, the dev tools, and (future) Phase 1b's `/puzzle/:id`. Have a haiku subagent enumerate **every** import site first; decide each one deliberately and list the decision per site in the PR description. Rush's `isRushEligible` guard stays — it protects a different invariant (the `RushInteraction` narrowing) and its doc comment explains why.
2. Convert `PuzzleCardShell.tsx`'s interaction dispatch from the `&&`-chain to an exhaustive `switch` with `default: assertNever(puzzle)`, so the next union member is a `tsc` error, not a blank div. Add the `assertNever` helper wherever the repo's conventions put shared type utilities — check before inventing a location.
3. **Tests:** an invariant test that `quizPool` contains no `interaction: 'scrubber'` puzzle and that Practice's serving path draws from `quizPool`; plus whatever makes the exhaustiveness real (the `switch` conversion itself is the compile-time test — verify by temporarily adding a dummy union member and confirming `tsc` fails, then remove it; state in the summary that you did this).

Reviewer focus: revert the pool split, confirm the new test fails. Confirm Daily's calendar validation now also rejects a scrubber id (it is currently safe **by accident** — a curated list that happens not to contain one; make it safe by rule).

## Item 2 — Generator fixes: P3 key order, P4 output join (before any pilot regeneration)

These land before Item 4 so the pilots are regenerated exactly once.

1. **P3:** `bindingNamesInScope` / the `vars` emission in `jsTraceGen.ts` — preserve **first-seen order across the whole trace** (a variable keeps its row once it appears). First-seen, not sorted: the review calls out that alphabetical sorting scrambles the natural reading order of the snippet. Check whether `pyTracer.py` has the same instability and fix it to the same rule if so.
2. **P4:** multiple `console.log` calls between trace steps join with `'\n'`, not `' '`. In `ScrubberDebugPage.tsx`, relabel `output so far:` to reflect what the value is — output **since the previous step** — so Phase 3 doesn't copy a wrong label into real UI.

Reviewer focus: a two-`console.log` snippet produces `"a\nb"`, and the fixture/test would have caught the old `' '` behaviour.

## Item 3 — P2: JS trace determinism, enforced not claimed

Bring the JS backend to the Python backend's posture (`PYTHONHASHSEED=0` + builtins allowlist is the model):

1. In the `vm.createContext` sandbox, make `Math.random` and `Date` (`Date.now`, `new Date()`) either **throw a clear authoring error** naming the offending API, or be deterministically pinned — your call as lead, but pick one posture for both APIs and write one sentence in the doc comment saying which and why. Throwing is simpler and honest for authoring tooling; pinning silently produces plausible-looking traces from snippets that _look_ nondeterministic to a reader. Lean toward throwing unless you find a pilot-relevant reason not to.
2. **Test that can actually fail:** a snippet calling `Math.random()` must either throw the authoring error or produce byte-identical traces across two runs — whichever posture you chose. Also keep the existing deterministic-snippet test; it's fine as a regression floor, it just isn't the guarantee.
3. **P6, doc-comment part only:** soften `jsTraceGen.ts`'s isolation claim to what `node:vm` actually provides (it is not a security boundary; `this.constructor.constructor('return process')()` escapes). Do **not** move JS generation to a child process in this PR — that is a deliberate Phase 4 decision. Record it as a row in the build plan's known-open-defects table: "JS traceGen runs in-process; `node:vm` is not a security boundary — decide child-process isolation before Phase 4 batch generation."

Reviewer focus: delete the new guard, confirm the new test goes red.

## Item 4 — P1/P5: schema refinements + pilot re-picks + fixtures

After Items 2–3, regenerate the five pilot traces through the real tooling (haiku subagent can drive the CLI; you review the diffs — key order and output joins will move, values must not).

1. Add the two refinements from Decision 1 to `src/content/schema.ts`'s `superRefine`, with error messages that tell an author **what to do**, not just what failed (the existing refinement messages are the register to match).
2. Run `validate:content`. Expect exactly one pilot casualty: `scl-010`'s checkpoint 1 (`afterStep: 7`, `i` unchanged `"2" → "2"` from step 6). Re-pick that checkpoint to a step where `i` actually changes. Re-validate all five pilots; if the refinements reject anything else, that is signal, not noise — evaluate each hit as lead before adjusting either the puzzle or (only with written justification) the rule.
3. **Corrupted fixtures:** the Phase 2 convention is one fixture per refinement, thirteen exist. Add two more — a `var-value` checkpoint on an unchanged step, and an `output` checkpoint on an output-less step — asserting on the new error messages.
4. Do **not** touch the debug harness beyond Item 2's relabel. Masking the target row is Phase 3's obligation, and the review already specifies its test (target value absent from the DOM at the pause) — that lands in Phase 3, not here.

Reviewer focus: both new fixtures fail validation for the stated reason and pass when corrected; `scl-010`'s re-picked checkpoint satisfies the changed-at-step rule against the regenerated trace.

## Item 5 — Build-plan amendments (lead writes these personally)

Append to `docs/v2-build-plan.md`, matching the existing amendment register:

1. **Phase 2 amendment:** post-merge review found P0–P6 (cite `docs/v2-phase2-review.md`); this PR actioned P0, P1 (Option B, with the two refinements named), P2, P3, P4, P5, and P6's doc-comment half. Record the Option B decision and the one-sentence reason A was rejected (compound prediction at loop boundaries).
2. **Phase 3 section rewrite:** replace items 3–4 and the affected DoD lines. Scrubber is served from a **dedicated mode** (route + session hook, Rush is the structural precedent) consuming `scrubberPool`, rated on the **shared** ladder (one binary outcome per puzzle, per the locked decision in `scrubber.ts`). Practice/Daily/Rush stay quiz-only via `quizPool`. Add Phase 3 DoD lines: the mask-at-pause render test, and "scrubber mode serves from `scrubberPool` — asserted in a test." Note Daily-serves-scrubber as a deferred Phase 3+ content call.
3. **Phase 1b note:** now additionally sequenced after Phase 3 (no scrubber renderer exists until then; a shared scrubber link would be the P0 dead card all over again). `/puzzle/:id` will consume `puzzlePool`, which is why that export survives.
4. The P6 open-defect row from Item 3.

## Item 6 — Final gate

Full `pnpm validate`, lint, `tsc`, test suite, production build. Haiku subagent greps `dist/` to confirm the debug route is still absent and confirms no new `dependencies` (this PR should add zero packages of any kind). Then a **final fresh reviewer subagent** reads `docs/v2-phase2-review.md` top to bottom against the finished diff and reports anything actioned incorrectly or silently skipped. You resolve its findings, then open the PR.

**PR description:** per-item summary, the per-import-site pool decision list from Item 1, and the amendment text. No AI attribution.

---

## Out of scope — do not drift into

The scrubber mode itself (route, session hook, `Scrubber.tsx`, mask-at-pause UI) — Phase 3. Phase 1b entirely. Child-process JS generation — Phase 4 decision. Batch pipeline — Phase 4. Anything in `src/app/pwa/`. `SwipeBinary.tsx` / gesture config. Elo/`selectNext` changes.

## DoD

- [ ] `quizPool`/`scrubberPool` split landed; Practice, Daily, Rush provably scrubber-free (test, not inspection)
- [ ] `PuzzleCardShell` dispatch is exhaustive; a new union member is a compile error (verified by the dummy-member check)
- [ ] Two new refinements landed with authoring-quality error messages + two corrupted fixtures
- [ ] `scl-010` re-picked; all five pilots pass `validate:content` under the new rules
- [ ] JS determinism enforced with a test that can fail; `node:vm` doc comment truthful
- [ ] `'\n'` output join; harness label corrected; `vars` key order stable first-seen
- [ ] Build-plan amendments (Phase 2, Phase 3 rewrite, Phase 1b note, P6 row) committed
- [ ] Review doc + this prompt committed as build history; every item independently reviewed via the revert-the-fix check
