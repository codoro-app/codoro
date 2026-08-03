# Prompt for Claude Code — v2 Phase 5 (quiz mode upgrades, timers, and session pacing)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**Check the branch state before anything else.** This phase assumes `d66b8a3` ("Phase 4: pilot run (3 puzzles), model switch to Sonnet, and amendment") is in `main`'s history. If it isn't, stop and ask — Item 0 edits a file that commit created. Work on `v2-phase-5a` off `origin/main`, PR back to `main`; then `v2-phase-5b` off the updated `main`. See "This phase is two PRs" below — that split is not optional.

Scope is `docs/v2-build-plan.md` **Phase 5**, widened by direct user decision to absorb five items the plan didn't carry: a live dead-affordance bug on `/puzzle/:id`, a missing layout rule on the Trace page, per-puzzle timers in Rush **and** Trace, a streak-pause moment, and interaction-type filters in Practice. All five are locked below. Read the Phase 5 section, the Phase 4 amendment's handback bullet on the output-checkpoint distractor tell, `src/app/practice/interactionTypes.ts`, and `src/engine/rush.ts` before writing code. The plan is authoritative where this prompt is silent; where they conflict, this prompt's locked decisions win and the amendment records why.

Standing rules, unchanged: `src/app/pwa/` is hands-off (list any touched file there in your summary), no hex outside `index.css`, no AI attribution in commits, `pnpm validate` must not require Python, `src/engine/` stays React-free, `selectNext` untouched, telemetry stays snake_case and additive. **Zero new dependencies** — this one bites in Item 5 (`drag-order`), see locked decision 6.

---

## This phase is two PRs, and that is a locked structural decision

The repo's own sizing rule is "one session = one focused build block ending in a green `pnpm validate` and a merged PR — no long-lived branches." This phase has seven items and the user has chosen to keep them together. Both things can be true only if the phase ships as **two sequential PRs**, not one branch that lives for a week:

- **Phase 5a** — Items 0–4. Content-defect fix, the dead-button fix, the Trace layout fix, Daily reveal, Practice filters. All small, all independently valuable, no shared state. Merge before starting 5b.
- **Phase 5b** — Items 5–7. `drag-order`, the timer work across Rush and Trace, the streak-pause moment. These share session-state surface area and a real-device verification pass.

**If 5b is running long, stop after Item 5 (`drag-order`) and hand back rather than pushing through.** `drag-order` ends at a natural, mergeable boundary and is the item with a real-device gate. Splitting 5b again is a better outcome than one unmergeable branch; silently continuing is the failure mode this section exists to prevent.

**One out-of-band prerequisite that is not your work but affects it:** production telemetry has never fired a single event (`docs/v2-backlog.md`). The activation runbook is `docs/runbooks/posthog-activation.md` and it is an ops task the user runs, not a code change — `src/telemetry/` is correctly written and correctly gated. Do not "fix" it in code. Its relevance here is that the timer constants in Item 6 have no data behind them and won't until this is live.

---

## Ask questions.

**Stop and ask rather than deciding on your own authority if any of these come up:**

- A locked decision below appears to contradict something you find in the code or the plan. Report the specific contradiction; do not pick a side.
- Item 0's regeneration turns out to require a model call after all (see locked decision 2 — it should not).
- `drag-order` can't be built to the mobile bar in locked decision 6 without an npm dependency, and you're tempted to add one.
- Any timer number below turns out to be unplayable rather than merely untuned — see locked decision 4 on why these are guesses, and what "unplayable" would have to look like to justify changing one without play data.
- The streak-pause moment (Item 7) needs to interrupt a mode where interrupting is wrong, and you can't resolve it from decision 8.
- You believe a puzzle the validator accepted is bad, and you can't articulate a machine-checkable rule that would have caught it. (Same standing rule Phase 4 carried, and Item 0 is what happens when it gets answered and then not acted on.)

---

## Decisions — locked, do not relitigate

1. **There is no real player data. Stop designing around it.** An earlier draft of this prompt treated `rushStats.bestScore` comparability across the timer change as the hard problem in this phase. It isn't — the user has confirmed no production player data exists. Migrate `rushStats` through `src/storage/`'s existing versioned path (`CURRENT_SCHEMA_VERSION` + `runMigrations`) because that path exists and is the only sanctioned way to change a stored shape, **not** because a number needs preserving. Reset the timed-era bests outright. Do not build a dual-key untimed/timed split, do not add a migration note to the UI, do not spend a review pass on it. If you find yourself writing more than a few lines of migration, you have misread this decision.

2. **Item 0's `oob-011` fix is deterministic and costs zero model calls.** The trace (`steps[]`) is on disk and is ground truth by construction — re-running `synthesizeChoices` against it after the fix regenerates both checkpoints' `choices`/`correct` with no propose call, no placement call, and no review call. Do **not** re-run `generate:scrubber-puzzles`. Do **not** hand-author replacement distractors. If the corrected `synthesizeChoices` can't serve one of these two checkpoints from the existing trace, that is information about the fix, not a licence to fall back to a model — stop and report.

3. **The dead Continue button is a real defect in both branches, not just Trace.** The user reported it on a shared `/puzzle/tc-009` link and observed that quiz links "work fine." **They do not** — `PuzzlePage.tsx` passes an empty `onContinue` to _both_ `TraceRunnerPuzzle` and `PuzzleCardShell`, and `PuzzleCardShell.tsx:191` renders the same `feedback-panel__continue` button wired to the same no-op. The difference is visibility, not behavior: a completed trace puzzle is a tall page (`oob-012` is 52 steps), so the "Practice more like this" CTA sits far below the fold while the dead Continue sits right under the feedback panel and reads as the obvious next action. On a short quiz card the CTA is immediately visible and the dead button goes unnoticed.

   **Fix both branches. Do not fix only the one that was reported** — shipping a fix for the visible half of a defect while leaving the mechanism in place is precisely the drift this repo's review discipline exists to catch. The file's own doc comment (lines 34–37) records the original call: "forking either shell to hide its Continue button was ruled out — the CTA below is the real next step." That reasoning is sound and stands; the error was leaving a live button wired to nothing rather than giving it the CTA's destination. Wire `onContinue` to navigate to `/practice?pattern=<slug>` in both branches and update that doc comment to say so. Hiding the button by forking a shell remains ruled out.

4. **Timer values are guesses with no data behind them, and the code must say so.** Ship `15s` per quiz puzzle (Rush) and `30s` per checkpoint (Trace). **These numbers are not derived from anything** — production telemetry has never fired a single event (see `docs/v2-backlog.md`, "Production telemetry was found completely inactive"), so there is no attempt-duration distribution to size against. Both are named, exported constants with a doc comment saying they are untuned starting points to be play-tested, exactly the way `RUSH_DIFFICULTY_STEP` already carries that note. Do not bury a magic number in a component.

5. **Rush escalates on difficulty only; the Rush timer is flat.** Rush already ramps difficulty (`stepDifficulty`, +`RUSH_DIFFICULTY_STEP` per correct answer). Compressing the clock on top of that compounds two curves, and a run whose difficulty is the product of two untuned ramps cannot be tuned by feel — you would not know which knob produced the miss. The difficulty ramp is already timer compression in effect: a harder puzzle takes longer to read against the same 15s. Ship the flat clock, play it, and let a future phase add compression if the ramp alone turns out to be too gentle. **Rush also keeps 3 strikes** — a run can now end two ways (strikes exhausted, clock exhausted) and both must land in the same ended phase with the same stats write. Rush stays unrated: `shouldRateAttempt('rush', _)` stays hardcoded `false`.

   This supersedes the "3-strikes, **no countdown timer**" locked decision recorded in `src/engine/rush.ts` (the `RUSH_STRIKE_LIMIT` doc comment) and `src/app/rush/RushPage.tsx`'s header comment. Both are now wrong and must be corrected in the same commit that introduces the timer — do not leave a stale "locked" claim in source contradicting shipped behavior.

6. **`drag-order` is built on Pointer Events, mobile-first, with zero new dependencies.** The obvious move is `dnd-kit` or `react-beautiful-dnd`; the zero-dependency rule is not waived and the reasoning is not new — v1's _named enemy_ was drag jank and sizing on phones (`docs/v1-retro.md`), and a library that abstracts the pointer layer makes that class of bug harder to diagnose on the one platform where it matters.

   Concretely: pointer capture rather than mouse/touch event pairs, explicit `touch-action` handling so the drag never fights vertical page scroll, thumb-sized hit targets, and no layout shift when a block lifts (reserve the space, don't reflow). **Test on a real mid-range phone before merging, not after** — a plan DoD line, and the one DoD item here that a green `pnpm validate` cannot stand in for. Prior art worth reading first: `src/app/practice/gestureThreshold.ts` and the two Phase 0 amendments on `@use-gesture` (the 32 ms `BEFORE_LAST_KINEMATICS_DELAY` staleness, and `DragEngine`'s zero `axisThreshold.touch` locking to the wrong axis) — documented failure modes of this exact problem space on this exact codebase.

7. **The Trace timer is per-checkpoint and lives in Trace mode only. Rush stays quiz-only.** `RushInteraction` excludes `scrubber` by construction (`src/engine/rush.ts`) because a multi-checkpoint attempt doesn't fit Rush's strike-or-move-on loop — that stands, and this phase does not change it. A whole-puzzle budget for a trace puzzle was rejected: `oob-012` is 52 steps with 4 checkpoints and `oob-010` is 14 steps with 3, so one number cannot serve both, and a player who spends their budget scrubbing has been punished for using the mode's core interaction.

   **The clock runs only while a checkpoint is on screen and unanswered.** Scrubbing between checkpoints is free and untimed — that is the reading and reasoning the mode exists to teach, and timing it would train skimming. What a checkpoint timeout _does_ is a design call you make and record: scoring it as a miss and advancing is the obvious shape, but it interacts with `scoreScrubberAttempt`'s "each checkpoint accepts exactly one answer" contract and with `useTraceSession`'s completion path. Whatever you pick, a timeout must produce the same `CheckpointResult` shape as a real answer — no third state.

   **`/puzzle/:id` renders the same `TraceRunnerPuzzle`.** Decide whether a shared link is timed and say so explicitly rather than inheriting it by accident. A stranger following a link cold, on a puzzle they didn't choose, timed, unrated, is a worse first impression than the same puzzle untimed — recommend untimed there, but it is your call and it must be a call.

8. **The streak-pause moment applies to Practice and Trace only — never Rush, and Daily can't have one.** Interrupting a timed Rush run to congratulate the player is self-defeating, and Daily is a single puzzle so a streak of 5 within it is undefined. Trigger at a run-streak of 5 correct in a row.

   Two things to decide and record: whether it blocks (Quizlet Learn's round-complete screen blocks; a toast doesn't) and whether it's dismissible without breaking the streak. **The point of the feature is a place to stop, so the pause must offer stopping as a real option, not just a "keep going" button with confetti** — if the only exit is "continue," you've built a congratulation, not a pause. Recommend: blocking, with an explicit "done for now" that leaves the streak intact and a "keep going" that continues the session.

9. **Practice interaction filters reuse the existing query-param plumbing.** `PracticePage` already reads `?pattern=<slug>` on mount and applies it as a filter (see its doc comment and `PuzzlePage`'s `PracticeMoreCta`). Add `?interaction=<type>` alongside it, same shape, same mount-once semantics. **The pool-emptiness case is the real work, not the filter itself**: pattern + interaction together can select an empty set (there are 8 scrubber puzzles across 13 patterns — most pattern/interaction pairs have zero content). Selection must degrade to something legible — an empty-state that names what's missing — not stall, throw, or silently ignore the filter. Decide whether filters combine or are mutually exclusive, and make the UI say which.

10. **Out of scope, do not drift into:** OD-1 (still Phase 8, still undiagnosed — do not speculatively retune any gesture), scrubber content generation of any kind, Phase 6 quiz volume or recalibration, Phase 7 export/import or Lighthouse work, any rating/Elo change, `selectNext`, and `RUSH_SWIPE_WEIGHT` (tuned; leave it).

11. **The Phase 4 scrubber volume debt moves to Phase 6, and this PR is where that gets written down.** Phase 4's DoD line "≥40 scrubber puzzles live" is unmet (3 live), deferred on the cost finding in the Phase 4 amendment, item 7. Phase 6 is already "content calibration + quiz volume + batch runs" — widen its scope and DoD to cover scrubber volume under the usage-window-aware pacing that amendment calls for. Documentation edit only: **do not generate any scrubber puzzles in this phase.** A deferred target with no owner phase evaporates, and this plan's rule is that nothing gets to hide.

---

## How to run this: orchestration

Run this as an orchestrator. **Unlike Phase 4, the budget note is relaxed** — this phase makes no generation calls, so subagent spend competes only with your own session, not with puzzle output. Reviewers are affordable here in a way they weren't last phase.

- **Lead (you)** — sequencing, all implementation, and every design call: the `drag-order` data shape, the pointer-event drag model, the checkpoint-timeout semantics (decision 7 is the subtlest problem in this phase), the streak-pause interaction shape, and all amendment prose. Do not delegate amendment wording.
- **Haiku subagents** — mechanical parallel sweeps only: enumerating every read site of `rushStats`, and enumerating every place a new `interaction` discriminant must be handled (schema, `quizPool`/`QuizPuzzle` narrowing, `PuzzleCardShell` dispatch, `RushInteraction`, `PuzzlePage`, generation manifest, telemetry). Run that second sweep **first** — a discriminated union has a long tail of exhaustive-switch sites, and finding them one compiler error at a time is slower than working from a list.
- **Sonnet reviewer subagents** — the mandatory review loop below.

**Review loop — mandatory, per item.** After each item, spawn a **fresh reviewer subagent (sonnet, no prior context)** with the item's brief and the diff, asking: _does the test fail if the fix is reverted?_ The reviewer checks mechanisms, not end states — revert the distractor-pool change and confirm the format-tell test goes red against the real `scrubberPool`; revert the `onContinue` wiring and confirm a test asserts the button navigates rather than merely existing. Loop until clean, then commit. Granular commits, one concern each. Phases 2, 3, and 4 each had real bugs caught only by a context-free reviewer.

---

# Phase 5a — Items 0–4

## Item 0 — The output-checkpoint distractor tell

Phase 4's amendment recorded this as a discard reason, flagged it as "a real, specific gap in `synthesizeChoices`'s distractor pool for `output` questions worth a future fix," and then shipped it live in `oob-011` — twice.

**The mechanism, so you don't re-derive it.** `synthesizeChoices` (`src/content/tools/generateScrubberPuzzles.ts:546`), `output` branch:

```ts
const varValues = trace.steps.flatMap((s) => Object.values(s.vars))
const outputValues = trace.steps.map((s) => s.output).filter(...)
pool = [...new Set([...varValues, ...outputValues])].filter((v) => v !== correctValue)
```

then a uniform `seededShuffle(pool, seed).slice(0, MAX_DISTRACTORS)` with `MAX_DISTRACTORS = 3`. On a 25-step trace with 6 tracked variables, `varValues` contributes roughly an order of magnitude more distinct entries than `outputValues`, so **real recorded outputs almost never survive the slice** — the pool is nominally a union and effectively variable-values-only.

**The live consequence, confirmed by a full-pool sweep (exactly these two checkpoints across all 8 scrubber puzzles, nothing else):**

| Puzzle    | Checkpoint     | Correct                   | Distractors served        | Real outputs sitting unused in the same trace                         |
| --------- | -------------- | ------------------------- | ------------------------- | --------------------------------------------------------------------- |
| `oob-011` | cp 1 (step 10) | `"initial window sum:" 9` | `[Function]`, `0`, `10`   | `"window ending at index" 3 "sum:" 8` (and two siblings)              |
| `oob-011` | cp 3 (step 23) | `"max sum:" 10`           | `0`, `3`, `[2,1,5,1,3,2]` | `"initial window sum:" 9`, all three `"window ending at index"` lines |

In both cases the correct answer is the only choice that _looks like_ console output. A player who never reads the snippet picks it. That is the "answerable without tracing" failure mode Item 5 of the Phase 4 prompt exists to catch, arriving through the distractor synthesizer instead of through the model.

**Three pieces of work, in order:**

1. **Fix the pool.** For `output` checkpoints, prefer real recorded outputs as distractors, falling back to variable values only to fill a short pool — and prefer, above that, outputs sharing the correct answer's literal label. Keep the existing determinism and seeding properties; `generateScrubberPuzzles.distractors.test.ts` already asserts determinism and non-fixed answer position and must stay green.
2. **Add the machine-checkable rule**, since this one is: for an `output` checkpoint whose correct choice contains a quoted literal label, at least one distractor must also contain a quoted literal label. Where it goes is your call — a `superRefine` in `src/content/schema.ts` makes it a permanent data-integrity gate that would fail `pnpm validate:content` today (good — that is the point), while a `synthesizeChoices` post-check only guards future generation. Argue for the one you pick. If you make it a schema rule, `oob-011` must be regenerated in the same commit or the suite is red.
3. **Regenerate `oob-011`'s two output checkpoints** deterministically from its on-disk trace, per locked decision 2. The diff should touch `choices`/`correct` on those two checkpoints and nothing else — no `steps[]` change, no rating change, no explanation change. If anything else moves, you did it wrong.

**Second finding from the same sweep — file it, do not fix it here.** At `oob-011` cp 1 the answer is `"initial window sum:" 9` while `windowSum` and `maxSum` both display `9` on screen at that step. OD-3's range masking doesn't fire, because it masks on **value equality** (`step.vars[name] === answerValue`) and `"9" !== '"initial window sum:" 9'`. So an `output` checkpoint whose printed line _embeds_ a currently-visible variable's value leaks that value regardless of the OD-3 fix — and `console.log("label:", x)` immediately after computing `x` is about the most common shape in this content. This is a **containment** leak, structurally distinct from the equality leak OD-3 closed, and fixing it means another change to the masking model. **Add it to the "Known open defects" table as OD-4** with the mechanism above, `oob-011` cp 1 as the confirmed case, and an owner phase. Do not fix it here and do not fold it into Item 0. Naming it and giving it an owner is the deliverable.

---

## Item 1 — The dead Continue button on `/puzzle/:id`

Locked decision 3 has the full brief, including why "it only affects trace" is a reporting artifact rather than the shape of the bug. Both branches, one fix, doc comment updated.

The test worth writing asserts the button _navigates_, not that it renders. A test that only checks for a button labelled "Continue" passes today, against the defect.

---

## Item 2 — Trace page has no layout rule at all

The user reports Trace "doesn't match" the other pages and sits too high against the top of the screen. **The cause is not a tuning value — `.trace-page` has zero CSS rules in the entire codebase.**

`TracePage.tsx:26` renders `<div className="trace-page app-shell__main">`, and `trace-page` appears exactly once in `src/` — in that JSX. Every other page wrapper defines the same block in its own stylesheet (`.practice-page`, `.daily-page`, `.rush-page`, `.puzzle-page`, `.legal-page` — verify this yourself, it is a one-line grep). The block they share:

```css
display: flex;
flex-direction: column;
gap: var(--space-4);
width: 100%;
max-width: var(--content-width-mobile);
margin: 0 auto;
padding: calc(var(--space-4) + env(safe-area-inset-top)) var(--space-4) var(--space-4);
box-sizing: border-box;
```

`.trace-runner` (`scrubber.css:228`) accidentally covers part of it — flex column, gap, max-width, `margin: 0 auto`, and the 1024px desktop bump — which is why Trace looks _nearly_ right and not obviously broken. What it does not carry is the **`padding` line**, and that line is the entire reported symptom: no top padding, no horizontal padding, and no `env(safe-area-inset-top)`. In iOS standalone PWA mode that last omission means content renders under the status bar/notch, since `index.html` sets `apple-mobile-web-app-status-bar-style: black-translucent` (see `practicePage.css`'s own comment on why every other page carries this).

**The layering question is the actual design call, and it is yours.** `.trace-runner` currently duplicates page-level concerns (max-width, centering) that belong to the page wrapper. Two options:

- Add `.trace-page` matching the other pages and leave `.trace-runner` alone. Smallest diff; leaves a redundant max-width constraint nested inside an identical one. Harmless, but it is the kind of redundancy that drifts.
- Add `.trace-page` **and** strip max-width/margin from `.trace-runner`, leaving it as pure inner layout.

**Whichever you pick, check `/puzzle/:id` before and after.** `TraceRunnerPuzzle` renders `.trace-runner` on _both_ `/trace` and `/puzzle/:id`, and `.puzzle-page` already supplies the full page block — so option 2 changes the shared-link rendering too. That is probably fine (`.puzzle-page` constrains it) but it must be verified, not assumed, and a scrubber puzzle on a shared link is exactly the surface a stranger sees first.

Not a candidate for a snapshot test. Verify visually at mobile width and at ≥1024px, on both routes.

---

## Item 3 — Daily: post-solve rating reveal

Reveal the puzzle's rating only after the attempt is committed — never before, and never in a tooltip, `title`, or DOM node that exists pre-commit. Anchoring is the whole reason for the item; a rating a player can find in devtools before answering defeats it. Share text stays as-is unless a change is trivially obvious.

Assert absence from the DOM pre-commit, not visual hiding. `DailyPage.test.tsx` already has the query patterns.

---

## Item 4 — Practice: interaction-type filters

Locked decision 9 has the brief. The filter is small; the empty-pool degradation is the work. Two filters that individually have content can jointly have none, and Practice is an endless-stream mode whose whole contract is that it never runs dry.

---

# Phase 5b — Items 5–7

## Item 5 — `drag-order` as a fourth quiz interaction

Locked decision 6 has the mobile bar. Largest item; sequence it after the Haiku discriminant sweep so you work from a list rather than from compiler errors.

**Schema first, UI second.** `interaction: 'drag-order'` joins the discriminated union in `src/content/schema.ts` alongside `mcq`/`swipe-binary`/`tap-line`/`scrubber`. Decide and record: does a `drag-order` puzzle carry shuffled blocks plus a correct ordering, or a canonical ordering the runtime shuffles deterministically per attempt? The second is smaller on disk and can't ship an inconsistent pair, but it moves shuffle logic into the runtime where a bad seed is a content bug invisible in the file. Argue for the one you pick — this is a permanent data shape, as forever as a puzzle `id`.

`superRefine` rules the schema needs at minimum: the correct ordering is a permutation of the blocks (no duplicates, no omissions, no out-of-range indices), and fewer than three blocks is rejected (two blocks is a coin flip wearing a drag interaction).

**Generation support** means the manifest and prompt in `generatePuzzles.ts` can target it — **not** a generation run. No puzzles are generated in this phase (decision 11). Author two or three by hand for the tests and the real-device pass, and say so plainly in the summary rather than letting hand-authored fixtures read as pipeline output.

**Decide whether `drag-order` enters the Rush mix at all.** `RushInteraction` is a narrower union than `QuizPuzzle`, and a drag interaction under a 15s clock on a phone is a different proposition from a swipe. Whatever you decide, the union must say so explicitly rather than defaulting by omission.

---

## Item 6 — Timers: Rush (flat, per puzzle) and Trace (per checkpoint)

Locked decisions 4, 5, and 7 carry the brief. Three constraints that apply to both:

- **The clock is UI/session state, not engine state.** `src/engine/` stays React-free and `rush.ts` is pure selection logic — timers belong in `useRushSession`/`useTraceSession`, not in the modules that decide which puzzle to serve. If you find yourself importing a clock into `src/engine/`, stop.
- **Telemetry stays snake_case and additive.** A run that ends on the clock is a new outcome for `trackRushRunEnd` to distinguish, and a checkpoint that times out is a new outcome for the Trace attempt event. Add fields; don't repurpose them.
- **A backgrounded tab must not silently drain the clock.** `visibilitychange` handling is not a polish item here — a player who takes a call and returns to a failed run will read it as a bug, correctly.

**Read `src/engine/rush.ts` before assuming Rush escalation is unbuilt.** `startingRushDifficulty` (rating − `RUSH_RATING_OFFSET`, floored), `stepDifficulty` (+`RUSH_DIFFICULTY_STEP` on correct answers only), and the widening-window selection around it already exist and are already unit-tested. The plan's "difficulty escalates as the run progresses (engine change, unit-tested)" is **already satisfied** — your job is to verify it's wired end to end through `useRushSession` and visible to the player, not to rebuild it. If it is wired, say so and move on; do not manufacture a change to make a checkbox feel earned.

**The right-side Rush progress bar** reflects actual run state. Decide what "progress" means in a mode with no fixed length — strikes remaining, difficulty against the run's start, or the clock — and show one thing well rather than three ambiguously.

---

## Item 7 — The streak-pause moment

Locked decision 8 has the brief. Trigger at 5 correct in a row, Practice and Trace only.

This is the one item in the phase with no prior art in the repo and no plan line behind it — it came from the user directly, modelled on Quizlet's Learn-mode round break. Build the smallest version that actually offers stopping, and resist growing it into a stats dashboard; the feature is a breath, not a report. If it wants to become a screen, that is a signal to stop and hand back, not to keep building.

---

## Definition of done

Phase 5's plan DoD, plus what the locked decisions add. **5a and 5b each end with `pnpm validate` green and a merged PR.**

**Phase 5a:**

- [ ] `synthesizeChoices` prefers real recorded outputs for `output`-checkpoint distractors; `oob-011`'s two output checkpoints regenerated deterministically, diff limited to `choices`/`correct`
- [ ] The format-tell rule exists as a machine check, with a test that goes red if the distractor-pool change is reverted, written against the real `scrubberPool`
- [ ] OD-4 (containment leak) added to the defects table with mechanism, confirmed case, and owner phase — and **not** fixed
- [ ] `/puzzle/:id`'s Continue button navigates in **both** the quiz and scrubber branches; test asserts navigation, not presence; `PuzzlePage.tsx`'s doc comment updated
- [ ] `.trace-page` has a real layout rule carrying the same padding + `env(safe-area-inset-top)` every other page wrapper has; the `.trace-runner` layering call recorded; `/trace` **and** `/puzzle/:id` both verified visually at mobile width and ≥1024px
- [ ] Daily shows the rating only post-commit, asserted by DOM absence pre-commit
- [ ] Practice accepts `?interaction=`; a pattern+interaction combination with zero content produces a named empty state, not a stall
- [ ] Phase 6's scope and DoD widened in `docs/v2-build-plan.md` to own the deferred scrubber volume target

**Phase 5b:**

- [ ] `drag-order` in the schema with permutation + minimum-block `superRefine` rules; every exhaustive-switch site handled; the data-shape call recorded; the Rush-inclusion call recorded
- [ ] Drag verified smooth on a real mid-range phone — no layout shift, no scroll fighting, no mis-sized cards — with device/OS/browser recorded in the PR the way OD-1's capture checklist requires
- [ ] Rush: flat 15s per-puzzle clock; run ends on strikes **or** clock into the same ended phase; still unrated; escalation verified wired (not rebuilt); progress bar reflects real run state; stale "no countdown timer" comments in `rush.ts` and `RushPage.tsx` corrected
- [ ] Trace: 30s per checkpoint, clock runs only while a checkpoint is on screen and unanswered; timeout produces a normal `CheckpointResult`, no third state; the `/puzzle/:id` timed-or-not call recorded
- [ ] Timer values are named exported constants documented as untuned; backgrounding a tab does not drain a clock
- [ ] Streak-pause fires at 5 in Practice and Trace, never Rush; offers stopping as a real option, not a congratulation
- [ ] `rushStats` change goes through the versioned migration path (and is small — see decision 1)
- [ ] Zero new npm dependencies; zero scrubber puzzles generated

**Amendment.** Append a Phase 5 amendment to `docs/v2-build-plan.md` recording: the two-PR split and why; the `.trace-page` missing-rule defect and the `.trace-runner` layering call; the timer decisions including the supersession of the "no countdown timer" lock and the rejection of compounding escalation; the per-checkpoint-not-per-puzzle Trace timer reasoning; the `drag-order` data-shape call; Item 0's root cause and why it reached production after being flagged; OD-4's discovery; the dead-button defect and why the "trace only" report was a visibility artifact; the streak-pause and Practice-filter items arriving by user decision rather than from the plan; and the Phase 6 scope widening. Do not delegate this prose.

**Never do speculatively:** retune any gesture (OD-1 is Phase 8 and undiagnosed), add an npm dependency to make a drag feel better, generate content to fill a Phase 4 gap, or tighten a timer because a run felt easy once.
