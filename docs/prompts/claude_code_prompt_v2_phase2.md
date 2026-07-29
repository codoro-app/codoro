# Prompt for Claude Code — v2 Phase 2 (scrubber spike: trace format, engine, tooling)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**Check the branch state before anything else.** `origin/main` was at `e38f842` ("Phase 1a follow-up: four routing defects (#34)") when this was written, on top of `16036c3` ("v2 Phase 1a: URL routing (#33)"). **If `e38f842` isn't in `main`'s history, stop and say so** — one of its items changes what the service worker serves for a path with a query string, and this phase adds a dev-only route that must not leak into any of the three route registries Phase 1a introduced.

Read Amendment 4 of `docs/v2-build-plan.md`'s Phase 1a section before you start. It is four defects that each passed the full test suite at merge time, and its lesson applies directly to this phase: a test that asserts an end state rather than the mechanism will pass for the wrong reason. This phase's determinism and schema-refinement tests are exactly that shape.

Standing rules, unchanged: `src/app/pwa/` is hands-off (list any touched file there in your summary), no hex outside `index.css`, no AI attribution in commits. Dependencies are **not** zero this phase — see the authorization section, which is narrow.

Scope is `docs/v2-build-plan.md` **Phase 2**. Read that section, the "Locked decisions" table (especially _Trace ground truth_ and _Scrubber languages_), and the "Known open defects" table before writing code. The plan is authoritative. Append an amendment at the end of the phase if your work contradicts it; silent divergence is the failure mode on this repo and it has bitten before.

---

## What this phase is

The risk phase. Everything unknown about v2 lives here: what a trace is, how prediction is scored, and whether trace generation can be automated. If the answer to any of the go/no-go questions at the bottom is bad, v2's flagship gets renegotiated **here**, before UI and content spend — that is the entire point of doing this before Phase 3.

**UI polish is explicitly out of scope.** The deliverable is a proven format, engine support, and five pilot puzzles rendered through a deliberately ugly dev-only debug harness. If you find yourself styling something, stop.

**Also out of scope, do not drift into:** anything from Phase 1b (`/puzzle/:id`, share affordances, OG); `interactionTypes.ts` / `PuzzleCardShell` integration (that's Phase 3 — see Item 5); the batch generation pipeline and `COST_CEILING_USD` per-model split (Phase 4); OD-1's swipe gesture (do not touch `SwipeBinary.tsx`'s `useDrag` config, `gestureThreshold.ts`, or `DEFAULT_SWIPE_THRESHOLD`).

---

## What exists today, and the four places this phase collides with it

Read these before designing anything. Each one is a decision you have to make deliberately, not a file you can extend on autopilot.

**1. `src/content/schema.ts`** — a Zod discriminated union on `interaction` (`mcq` | `swipe-binary` | `tap-line`) over a shared `BaseSchema`, with cross-field checks chained on as a `superRefine` after the union because they need the discriminant narrowed. Your `scrubber` variant is a fourth member and its consistency refinements go in that same `superRefine`. Note the existing comment explaining why `McqSchema`/`SwipeBinarySchema`/`TapLineSchema` are each exported flat in addition to the union: Claude's structured outputs can't handle the `$defs` shape `zodOutputFormat` produces for a discriminated union. Phase 4 will need the same for scrubber — export the flat variant now, but do **not** build any generation prompt around it this phase.

**2. `src/content/index.ts`** — `puzzlePool` is `import.meta.glob('./puzzles/**/*.json', { eager: true })`, parsed through `PuzzleSchema` at build time. **Every puzzle in the repo is bundled into the app's JS.** That's fine at 108 small quiz puzzles and it is a genuine risk for scrubber content: a trace is one entry per executed line with a variable map per step, so a single puzzle could plausibly be 2–5 KB of JSON where an MCQ is ~600 bytes. At Phase 4's volume that is hundreds of KB in a bundle Phase 7 already has to claw ~58 KB out of.

**Measure this on your five pilots and write the number down** — mean and worst-case serialized trace bytes, and the resulting `dist/` delta. Do not solve it this phase (lazy-loading content per puzzle is a real architectural change and premature at five puzzles), but if the pilots land above ~5 KB each, say so loudly in the go/no-go: it becomes an input to the "does the flat trace model hold" question, and Phase 4's volume target has to be priced against it rather than discovered later.

**3. `src/storage/schema.ts` + `src/storage/migrations.ts`** — `AttemptSchema` is at `CURRENT_SCHEMA_VERSION = 3`, and its only answer field is `choice_index: number | null` with the comment "not every interaction type has a choice index." A scrubber attempt has _N_ per-checkpoint results, which that field cannot express. The plan's DoD says "Engine scoring unit-tested including the attempt-log shape for per-checkpoint results," so this is in scope and it means a **schema version bump to 4 with a forward-only migration**, following `migrations.ts`'s existing contract (each migration stamps its own `schema_version`; the runner never auto-increments).

Decide and justify: a nullable `checkpoint_results` array on `AttemptSchema` is the obvious shape, but "nullable field every existing record has as null" versus "a separate store" versus "don't record them in v2 at all" are not equivalent, and Phase 6 calibrates against this log. Pick one, write the reasoning into the schema's doc comment, and make the migration a no-op that only bumps the version if that's genuinely all it needs — an honest no-op migration with a test is better than skipping the version bump and letting v3 records mean two different things.

**Do not widen `AttemptMode`.** Scrubber is an interaction type, not a mode; it's played in `practice`/`daily`/`rush` like everything else. `shouldRateAttempt`'s exhaustive switch stays a three-case switch.

**4. `src/content/tools/validatePuzzles.ts`** — the shared validation core for `validate:content`, and the precedent for what "the schema mechanically rejects bad content" means here. Read `validateSwipeDirectionBalance` and its doc comment: it's a **hard failure**, not a warning, with a written argument for why a warning would not have caught the v1 anchoring bug. Trace/checkpoint consistency is the same class of rule and gets the same treatment.

---

## Dependency authorization

You will need a JS instrumentation path. **Authorized: the `@babel/*` packages needed to parse and transform a snippet, as `devDependencies` only.** `node:vm` is stdlib. Nothing else — and specifically nothing that ends up in `dependencies`, because a trace generator is authoring tooling that runs on your machine and in CI, never in the browser.

Python needs no dependency: a `sys.settrace` harness is stdlib, run via `node:child_process` against the system `python3`.

**Hard constraint: `pnpm validate` must not require Python.** CI is `ubuntu-latest` (which does have `python3`, so this is about intent, not availability) and `pnpm validate` runs on every PR. Trace _generation_ is an authoring command you run deliberately; trace _validation_ is pure Zod over already-generated JSON and must stay dependency-free. Keep them in separate scripts and say in your summary which script runs where. If you find yourself adding a Python invocation to the `validate` chain, you've merged two things that should stay apart.

If you conclude a `node:vm` + Babel approach genuinely can't produce the trace shape the plan specifies, **stop and report rather than reaching for a heavier instrumentation library on your own authority.**

---

## Item 1 — Trace schema

New `interaction: 'scrubber'` member of the `src/content/schema.ts` union. Keep the trace minimal and flat, per the plan:

- `steps: Array<{ line: number; vars: Record<string, string>; output?: string }>` — one entry per executed line, variables as **display strings** (post-line state). Display strings, not typed values, on purpose: the UI renders them and the validator compares them, and neither needs a type system for JS and Python values to agree on.
- `checkpoints: Array<{ afterStep: number; question: 'next-line' | 'var-value' | 'output'; target?: string; choices: string[]; correct: number }>` — 2–4 pause points where the player predicts before the scrubber advances.

The Zod refinements are the deliverable, not the field list. Every checkpoint must be provably consistent with the trace itself:

- `afterStep` in range of `steps`; checkpoints strictly ordered and non-duplicated
- `correct` in range of `choices`; `choices` distinct
- `var-value`: `target` names a variable present in the trace at that step, and `choices[correct]` **equals** the trace's value for it
- `next-line`: `choices[correct]` equals `steps[afterStep + 1].line`, and a checkpoint cannot sit on the final step
- `output`: `choices[correct]` equals the output actually produced at that point
- `line` values in range of the snippet's line count (`tap-line`'s existing `correct_line` check is the precedent)

**A wrong trace must not be able to pass validation.** That is the whole game — v1's content weakness was unverifiable LLM assertions, and this is the mechanism that makes scrubber content structurally different. Prove it with a deliberately corrupted fixture per refinement, not one blanket "invalid puzzle" test.

Export the flat `ScrubberSchema` alongside the union (see collision note 2 above) and re-export types through `src/content/index.ts`'s barrel — nothing outside `src/content/` imports `schema.ts` directly.

## Item 2 — Trace generator tooling

New `src/content/tools/traceGen/`. Both languages produce the **same output shape**; that shared shape is the contract, so define it once and have each backend target it.

- **JS**: Babel transform inserting a per-line trace call, executed in `node:vm` with a **step budget** and **no I/O** — no `require`, no network, no filesystem, no timers. An infinite loop in a snippet must terminate with a clear error naming the budget, not hang CI or your session.
- **Python**: a `sys.settrace` harness run via subprocess, same output shape, same step budget, same isolation posture.

**Determinism is a DoD line and the easiest thing to get subtly wrong.** No timestamps, no `Math.random`/`random` without an injected seed, no object identity or memory addresses leaking into a display string (`<object at 0x7f...>` will silently make Python traces non-reproducible), and stable key ordering in `vars`. Test it by generating twice and deep-comparing — including across a subprocess restart for the Python path.

The tool writes the trace. A human or an LLM writes the snippet and picks checkpoint locations. Nothing about the trace is ever authored by hand — if you find yourself hand-editing a `steps` array to make a pilot work, that's the signal that the generator is wrong, not the trace.

## Item 3 — Engine scoring

`src/engine/`, pure TS, lint boundary enforced (`eslint.config.js` blocks `react`/`react-dom`/`**/app/*` imports from that folder — don't work around it).

Locked rule: **all checkpoints correct on first try = solve; any miss = fail.** One binary rated outcome per puzzle, exactly as v1, so Elo semantics don't change and existing ratings stay comparable. Per-checkpoint results go into the attempt log for future partial-credit tuning; rating stays binary in v2.

"First try" needs a definition you write down: whether a checkpoint accepts a second answer at all, and whether a miss stops the run or lets the player continue scrubbing for the explanation. The plan doesn't specify it and it's a real design decision that Phase 3's UI will inherit. Pick one, justify it in the doc comment, and flag it in your summary as a decision I may want to overrule.

Barrel-export through `src/engine/index.ts`. Note `src/engine/selection.ts` deliberately knows only `{ id, rating }` about a puzzle — **do not teach selection about interaction types.** Nothing about scrubber should reach `selectNext`.

## Item 4 — Five pilot puzzles

At least two per language, authored **end-to-end through the real tooling**. Not hand-written JSON. The point is to measure the authoring path, not to produce five files.

Time yourself honestly per puzzle, idea → validated JSON, and report the real number — that figure is the first go/no-go question and an optimistic estimate here costs Phase 4 dearly.

Aim the pilots at things a quiz can't ask: loop state that diverges from intuition, mutation through an alias, an off-by-one that only shows up at the boundary, closure capture in a loop, integer/float or truthiness surprises. If a pilot would work equally well as an MCQ, it isn't testing the format.

## Item 5 — Debug harness (deliberately ugly)

A dev-only route, reachable only when `import.meta.env.DEV`. Follow the existing pattern in `src/app/devTools/` — `DevPuzzleToggle` both is conditionally mounted **and** self-checks `import.meta.env.DEV` at render time, "so an accidental unconditional import can never surface it in a built app." Do the same here.

Because Phase 1a made routes real, a dev route now has three places it could leak into production. **It must not appear in any of them:** no entry in `public/_redirects`, no entry in `vite.config.ts`'s `navigateFallbackDenylist` allowance, and no entry in `ROUTE_META`. Confirm in your summary that a production build contains no reference to the debug route or its component, by grepping `dist/` — not by reasoning about it.

Bare `<pre>`-grade output is correct here: step through, show line + vars, stop at checkpoints, take an answer, reveal. **No `interactionTypes.ts` changes, no `PuzzleCardShell` registration** — `CommitPayload`'s `{ correct, choiceIndex }` shape cannot express a multi-checkpoint attempt, and reshaping it is Phase 3's job with the UI in hand. Keep the harness's own local plumbing entirely inside the debug route.

---

## Go/no-go checkpoint — the actual deliverable

Answer these three in writing, appended to `docs/v2-build-plan.md` as a Phase 2 amendment. Answer them **honestly**; a "yes" that isn't true costs three phases, and a "no" here is a cheap, successful outcome for this phase.

1. **Authoring cost.** Can one scrubber puzzle go idea → validated JSON in under ~15 minutes of tooling-assisted work? Report your measured per-puzzle time across all five. If not, name the bottleneck specifically — snippet design, checkpoint placement, trace inspection, or validator round-trips.
2. **Is it fun?** Is scrubbing the pilots more engaging than the v1 quiz, even ugly? Self-test plus one other person on the debug build — two data points beat zero. Report what you can observe; the human half is mine to do and I'll add it.
3. **Does the flat trace model hold?** Or did the pilots immediately demand call stacks, object graphs, or closures that the schema can't express? Be specific about which pilot broke it and how.

Add a fourth, from collision note 2: **what did five pilots cost in bundle bytes**, and what does that extrapolate to at Phase 4's volume?

If any answer is bad, renegotiate in the amendment — shrink checkpoint types, restrict to JS-only, or simplify the trace model — before Phase 3.

---

## Definition of done — code

- [ ] `interaction: 'scrubber'` in the content schema; flat variant exported; barrel re-exports updated
- [ ] `validate:content` **hard-fails** a deliberately corrupted fixture per refinement (not one blanket case), and passes the five pilots
- [ ] Trace generator produces byte-identical traces on repeated runs, JS and Python, including across a subprocess restart
- [ ] Runaway snippets terminate on a step budget with a clear error; no I/O reachable from a snippet
- [ ] Engine scoring unit-tested, including the attempt-log shape for per-checkpoint results; rating stays binary; `AttemptMode` unwidened; `selectNext` untouched
- [ ] Storage schema decision made, version bumped with a forward-only migration and a migration test, reasoning in the doc comment
- [ ] 5 pilot puzzles (≥2 per language) pass validation and are playable on the debug route, all authored through the tooling
- [ ] Debug route absent from a production build — verified by grepping `dist/`, and absent from `_redirects`, the SW denylist, and `ROUTE_META`
- [ ] `pnpm validate` green **without Python on the PATH being required**; new deps are `devDependencies` only and named in the summary
- [ ] Go/no-go answered in writing as a plan amendment, including the bundle-bytes number

## What you verify vs. what's on me

**Yours:** everything above.

**Mine (do not attempt, do not check off):** the human half of go/no-go question 2 (handing the debug build to someone); the outstanding Phase 0 and 1a production checks (PostHog event from a real phone, `/nonsense` HTTP 404 in a tab and in the installed PWA, cold load of `getcodoro.com/legal`, PWA install/launch/SW-update against a real deploy); OD-1 device repro.

**OD-1 — do not touch.** If something you're building makes the repro cheaper to capture, mention it with a cost estimate. Don't build it unprompted.

## Orchestration

- Branch `v2-phase-2`, PR into `main` when green. This phase is 2–3 sessions; if you're splitting across sessions, split at a commit boundary below and leave the branch mergeable.
- Commit order: trace schema + refinements + corrupted fixtures (no generator yet, hand-written fixtures are correct _here_ and only here) → JS trace generator → Python trace generator → engine scoring → storage schema bump + migration → pilot puzzles → debug route. Each commit independently green.
- Delegate to a subagent: the Python `settrace` harness, corrupted-fixture boilerplate, and the debug route's markup. **Keep your strongest reasoning on the schema refinements and the determinism guarantees** — those are the two places a wrong call passes every test and only surfaces as unverifiable content three phases later, which is exactly the v1 failure this phase exists to avoid.
- Report: measured per-puzzle authoring time; mean and worst-case trace bytes plus the `dist/` delta; the "first try" definition you chose and why; the storage schema shape you chose over the alternatives; which script requires Python and which doesn't; the `dist/` grep result for the debug route; and anything in the plan you had to contradict.
