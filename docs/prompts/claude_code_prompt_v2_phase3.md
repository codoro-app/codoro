# Prompt for Claude Code — v2 Phase 3 (scrubber UI: the Trace mode)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**Check the branch state before anything else.** `origin/main` was at `2fab500` ("Phase 2 corrective: P0-P6 from the post-merge review (#36)") when this was written. If that commit isn't in `main`'s history, stop and say so — this phase builds directly on the corrective PR's pool split, refinements, and amended Phase 3 plan section, and none of the instructions below are safe without them. Work on `v2-phase-3` off `origin/main`, PR back to `main`.

Scope is `docs/v2-build-plan.md` **Phase 3, as amended by the Phase 2 corrective** — read the amended section (items 3–4 were rewritten; two DoD lines were added), the Phase 2 corrective amendment itself, and `docs/v2-phase2-review.md` P1 Option B before writing code. The plan is authoritative. Append an amendment if your work contradicts it; silent divergence is this repo's named failure mode.

Standing rules, unchanged: `src/app/pwa/` is hands-off (list any touched file there in your summary), no hex outside `index.css`, no AI attribution in commits, `pnpm validate` must not require Python, `src/engine/` stays React-free, `selectNext` untouched, telemetry stays snake_case and additive. **Zero new dependencies.** The scrub gesture uses whatever Practice's swipe already uses (`@use-gesture` is in the tree) — if you conclude you need anything else, stop and report.

---

## Decisions — locked, do not relitigate

1. **User-facing name: "Trace", route `/trace`.** Internal code keeps the `scrubber` vocabulary (`scrubberPool`, `ScrubberPuzzle`, `interaction: 'scrubber'`) — do not rename internals; the split between product label and internal term is deliberate and matches how `swipe-binary` renders under a friendlier surface. Files for the mode live in `src/app/trace/` (`TracePage.tsx`, `useTraceSession.ts`, `tracePage.css`), following Rush's structure (`src/app/rush/`). The plan's original item 1 path (`src/app/practice/interactions/Scrubber.tsx`) predates the own-mode amendment — the component lives with its mode in `src/app/trace/`, and your amendment records that one-line supersession.
2. **Attempts stamp `mode: 'practice'`.** `AttemptMode` stays the three-value union — the Phase 2 prompt's rule survives the mode amendment, but the _reasoning_ changed, so re-document it where the stamp happens: a Trace attempt is a rated practice-surface attempt; `shouldRateAttempt('practice')` already means "rated," which is correct; and scrubber attempts are already unambiguously identifiable in the log by `checkpoint_results !== null` (the storage v4 field), so widening a persisted enum (schema v5 + migration) would buy a distinction the data already expresses. If you find a read-site where this conflation is actually wrong — Phase 6 calibration reads, streak logic, anything — **stop and report with the specific site** rather than widening the enum on your own authority.
3. **One binary rated outcome per puzzle** — all checkpoints correct on first try = solve, any miss = fail (`scoreScrubberAttempt` in `src/engine/scrubber.ts` already implements this; consume it, don't reimplement). Shared Elo ladder, no `UserProfile` changes, no second rating number.
4. **Mask at the pause (P1 Option B).** At a `var-value` checkpoint the target variable's row shows a masked value (e.g. `?`), never the answer; at an `output` checkpoint the step's output line is masked the same way. The mask is the question. The corrective PR's refinements guarantee the masked value is one the player had to compute (it changed at that step) — the UI's only obligation is to not leak it before the answer commits. `next-line` checkpoints mask nothing; they ask about a step not yet rendered.
5. **Out of scope, do not drift into:** Daily serving scrubber (deferred content call), Phase 1b (`/puzzle/:id`, share, OG), Phase 4 (batch pipeline, child-process traceGen — OD-2 stays open), any Practice/Rush/Daily behavior change beyond nav additions, partial-credit rating.

---

## How to run this: orchestration

Run this as an orchestrator. You (the lead) own sequencing, design judgment, and the merge decision. Delegate via the Task tool by the nature of the work:

- **Haiku subagents** — mechanical work: enumerating the route registries and every nav surface that lists modes; running the suite and reporting failures; grepping `dist/` at the gate; auditing that no `quizPool` consumer changed.
- **Sonnet subagents** — bounded implementation from a written brief: each item below, once you've made the calls it flags to you.
- **Lead (you)** — the design calls: the scrub interaction model (Item 2's gesture arbitration is the hardest problem in this phase), the checkpoint reveal flow, and the amendment prose. Do not delegate amendment wording.

**Review loop — mandatory, per item.** After each item, spawn a **fresh reviewer subagent (sonnet, no prior context)** with the item's brief and the diff, asking: _does the test fail if the fix is reverted?_ The reviewer checks mechanisms, not end states — e.g. delete the mask branch and confirm the mask render test goes red; serve a quiz puzzle to the Trace session and confirm the pool-invariant test catches it. Loop until clean, then commit. Granular commits, one concern each. The corrective PR's final-gate reviewer caught a genuinely skipped step last time — keep that bar.

---

## What exists that you build on — read before designing

- `src/engine/scrubber.ts` — `CheckpointResult`, `scoreScrubberAttempt`. The engine is done; this phase consumes it.
- `src/app/devTools/ScrubberDebugPage.tsx` — the ugly-but-correct reference for trace playback semantics (step index, checkpoint gating at `afterStep`, the "output since previous step" label). It stays: it is Phase 4's authoring harness. Reuse its logic by extraction if that's clean; do not couple the real UI to the dev page.
- `src/app/rush/useRushSession.ts` / `RushPage.tsx` — the structural precedent for a mode with its own session shape. Match its patterns for profile load, attempt persistence, telemetry, and error states rather than inventing new ones.
- `src/app/practice/usePracticeSession.ts` — the reference for the rated-attempt lifecycle: `shouldRateAttempt`, rating update, requeue on miss, `recentIds` feeding `selectNext`. Trace's session does the same lifecycle with `scrubberPool` and `scoreScrubberAttempt` deciding the binary outcome.
- `src/app/practice/interactions/SwipeBinary.tsx` + its gesture config — the hard-won v1 swipe lessons (axis lock, thresholds). The scrub drag surface has the same class of problems. Do not modify these files; learn from them.
- The corrective PR's pool-invariant test (`src/content/index.test.ts`) — the standard "asserted in a test, not by inspection" looks like.

**The three route registries** (Phase 1a lesson — a route that misses one works in dev and 404s or mis-caches in production):

1. `src/app/routes.ts` — `ROUTES` + `labelForPath` + the route-meta table (`useRouteMeta.ts`).
2. `public/_redirects` — Cloudflare Pages needs `/trace /index.html 200`.
3. `vite.config.ts` — `navigateFallbackDenylist` regex must admit `trace`. This file configures the PWA but is not `src/app/pwa/`; changing the regex is in scope. Change only the regex, and list the change explicitly in your summary.

A haiku subagent enumerates all nav surfaces first (`NavRail`, `ModeSwitcher`, `Home`, `AppShell`, anything else importing `ROUTES`) so none is missed; you decide what each shows.

---

## Item 1 — Trace session hook (`useTraceSession.ts`)

The rated lifecycle against `scrubberPool`: select (via `selectNext` with the scrubber pool mapped through `toEnginePuzzle`, same as Practice does), serve, collect per-checkpoint results as the player answers, score via `scoreScrubberAttempt` on completion, persist the attempt (`mode: 'practice'`, `checkpoint_results` populated, `choice_index: null`), update rating, requeue on miss, feed `recentIds`.

Notes:

- A five-puzzle pool is thin for `selectNext` — check its requeue-starvation guard and recency window against a pool this small and report what you find; if the guard makes the mode unservable at 5 puzzles, the fix is a documented parameter at the call site, not a `selectNext` change (locked).
- Per-checkpoint telemetry: the `attempt` event carries interaction type and per-checkpoint results (amended DoD line). Additive snake_case fields only; update `src/telemetry/README.md` in the same commit.
- **Tests:** the pool-invariant test (Trace serves from `scrubberPool` — revert-the-import must fail it); full rated lifecycle including requeue-on-miss and rating delta, following `usePracticeSession`'s test shape.

Reviewer focus: stamp the attempt with a wrong mode or a null `checkpoint_results` and confirm a test notices; serve from `puzzlePool` and confirm the invariant test fails.

## Item 2 — Scrubber component (`src/app/trace/Scrubber.tsx` or split as you see fit)

Code pane with current-line highlight, state panel with live variable rows, scrub control. Mobile-first: horizontal drag surface (chess.com-analysis-style) plus prev/next tap targets; desktop gets arrow keys. Variable rows keep stable order — the trace JSON's first-seen key order is already stable post-corrective; render in that order, no sorting.

The gesture is the risk. Constraints, from v1's scars:

- The drag surface must not fight vertical page scroll — axis-lock the same way `SwipeBinary` does, and the surface must not sit where iOS PWA edge gestures live (safe-area insets respected).
- Scrubbing must feel continuous (drag distance maps to step position), not like hidden tap targets.
- Haptics on checkpoint results, matching the existing haptics utility usage.

**Tests:** render tests for line highlight and panel state at a given step index; key order preservation; arrow-key stepping. Gesture physics can't be meaningfully unit-tested — say so in the summary and cover what can be (the step-position mapping function, extracted pure).

Reviewer focus: the step-position mapping is pure and tested; no `SwipeBinary`/`gestureThreshold` file was touched.

## Item 3 — Checkpoint flow + mask (P1 Option B's UI half)

Scrubbing forward locks at a checkpoint (`afterStep`): the player cannot advance past it until answered. At the pause:

- `var-value`: the target's row in the state panel shows a mask, not the value. Choices render (reuse MCQ answer plumbing per the plan — extract from `Mcq.tsx` only what's cleanly shareable; do not fork its accessibility handling).
- `output`: the step's output is masked; choices render.
- `next-line`: nothing masked; choices are line numbers; `steps[afterStep + 1]` must not be rendered or pre-highlighted before the answer.

On answer: reveal the correct value, unmask, show the state diff for that step, record the `CheckpointResult`, resume scrubbing. After the final step (all checkpoints answered), the standard explanation/solve screen with rating delta — reuse the existing solve-screen pattern, don't invent a new one.

**Tests (DoD lines, verbatim):** a render test asserting the masked value is **absent from the DOM** at the pause — not visually hidden, absent — for both `var-value` and `output`; and one asserting `steps[afterStep + 1]` content is absent at a `next-line` pause. Plus first-try-vs-retry correctness: only first-try answers feed `scoreScrubberAttempt`.

Reviewer focus: delete the mask branch → mask test red. Answer a checkpoint wrong then right → attempt still scores as fail.

## Item 4 — Route, nav, and mode surface

`/trace` in all three registries (see above), nav label **Trace**, entries in `NavRail`/`ModeSwitcher`/`Home` matching how Rush presents (including any icon convention — `Icons.tsx`). Route meta in the `useRouteMeta` table. Deep-load of `/trace` must work cold in production (that's what registries 2 and 3 are for) — verify in the built output, not by reasoning.

Reviewer focus: grep the built `dist/` for the route's presence in the app shell and the denylist regex; confirm `/trace` appears in `_redirects`.

## Item 5 — Build-plan amendment

Append to the Phase 3 section: the name decision (Trace, `/trace`, internals keep `scrubber`), the component-location supersession of the original item 1 path, the `mode: 'practice'` stamp reasoning (Decision 2 above, condensed), anything `selectNext`'s small-pool behavior forced at the call site, and any DoD line you could not fully verify without a physical device — named explicitly as remaining manual verification, not silently checked off.

## Item 6 — Final gate

Full `pnpm validate` (typecheck, lint, tests, `validate:content`, build). Haiku subagent confirms: debug route still absent from `dist/`, no new packages of any kind, no `src/app/pwa/` files touched, `quizPool` consumers unchanged. Then a **final fresh reviewer subagent** reads the amended Phase 3 plan section plus this prompt against the finished diff and reports anything skipped or silently divergent. Resolve, then open the PR.

**PR description:** per-item summary, the registry/nav enumeration list, the amendment text, and the manual-device checklist (below). No AI attribution.

---

## DoD (from the amended plan, plus this prompt's additions)

- [ ] All 5 pilot puzzles playable start-to-finish (desktop verifiable in CI; phone items go on the manual checklist)
- [ ] Scrub gesture doesn't conflict with page scroll or PWA edge gestures on iOS — manual checklist, named as such
- [ ] Rated attempt lifecycle (attempt log, rating update, requeue on miss) verified in tests for the Trace path
- [ ] Telemetry: `attempt` events carry interaction type + per-checkpoint results; README updated in the same commit
- [ ] Trace serves from `scrubberPool`, never `quizPool`/`puzzlePool` — asserted in a test
- [ ] Masked value absent from the DOM at the pause (`var-value` and `output`); `steps[afterStep + 1]` absent at a `next-line` pause
- [ ] `/trace` present in all three route registries; cold deep-load verified against the built output
- [ ] Attempts stamped `mode: 'practice'` with `checkpoint_results` populated; reasoning documented at the stamp site
- [ ] Amendment committed; every item independently reviewed via the revert-the-fix check

**After merge, the human check the plan demands:** hand the phone to someone and say nothing. If they can't figure out scrubbing within ~15 seconds, the affordance is wrong — fix before Phase 4.
