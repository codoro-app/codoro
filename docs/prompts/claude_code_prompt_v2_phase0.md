# Prompt for Claude Code — v2 Phase 0 (carryover fixes + live verification)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first; confirm `main` is at the docs commit (`Move root prompt files into docs/prompts/`). Standing rules, unchanged from v1: `src/app/pwa/` is hands-off (list any touched file there in your summary), zero new dependencies unless explicitly authorized below, no hex outside `index.css`, no AI attribution in commits.

Scope is `docs/v2-build-plan.md` Phase 0. **That phase was rewritten after a misdiagnosis inherited from the v1 retro — the section below is the corrected version and the plan now matches it. Do not go looking for the bug the retro described; it isn't there.**

---

## The swipe-binary bug is content, not code

v1's retro and the original backlog both say _"`SwipeBinary.tsx` always resolves 'right' instead of tracking actual swipe direction."_ That is wrong, and `docs/v2-build-plan.md` and `docs/v2-backlog.md` have both been corrected. `SwipeBinary.tsx` and `gestureThreshold.ts` resolve direction correctly — `resolveSwipeCommit` returns the real direction and `handlePick` scores it against `puzzle.correct_direction`.

The actual defect, verified across the library:

- **All 39 swipe-binary puzzles have `correct_direction: "right"`. Zero have `"left"`.**
- Every label pair is phrased safe-on-left / buggy-on-right: `Safe`/`Buggy`, `Terminates`/`Infinite recursion`, `Thread-safe`/`Race condition`, `Sorts correctly`/`Coercion bug`, and so on.
- Root cause: `src/content/tools/generatePuzzles.ts` (~line 158) ships a single swipe-binary worked example in the system prompt with `correct_direction: 'right'`, and every generation run anchored to it. `src/content/devPuzzles.ts` (~line 51) has the same value.

Impact — this is the rating-integrity bug the plan meant to describe, just one layer up: swipe-binary is 39 of 108 puzzles (36% of the library), and a player who swipes right without reading climbs Elo for free. Rated attempts on those puzzles carry no signal.

**Your first commit is a failing test that proves this**, at the content level (a distribution assertion over `puzzlePool`), not at the component level. Do not "fix" `SwipeBinary.tsx` — if you believe you've found a real component-level direction bug on top of this, write the failing test first and flag it in your summary rather than assuming the retro was right.

### What to build for it (scope is locked — do not expand)

1. **Rebalance the existing 39.** Swapping `left_label` ↔ `right_label` and flipping `correct_direction` is semantics-preserving. Do roughly half — target a 45–55% split, deterministic (seed by puzzle id, not `Math.random`), so the result is reproducible and reviewable. A one-off script under `src/content/tools/` is fine; commit the script and the resulting JSON diff separately so the JSON churn is reviewable on its own. Check every `explanation` and `prompt` field in the puzzles you flip for text that references a side ("swipe right if…") and fix any you find.
2. **Guard it in the validator.** `validateContent` fails when swipe-binary `correct_direction` skews past **65/35** in either direction across the library, with an error message naming the current split. This is a hard failure, not a `content:stats` warning — the whole point is that a future generation run cannot quietly re-anchor. Add the deliberately-skewed fixture test that proves the rule fires.
3. **Fix the generator prompt.** `generatePuzzles.ts`'s worked examples must show both directions, and the instruction text must state explicitly that `correct_direction` should be chosen independently per puzzle and is expected to land near 50/50 across a batch. Same for `devPuzzles.ts`'s sample.

### What is explicitly NOT in scope

The deeper tell survives this fix: the label that _names a bug_ is still always the correct answer, because every snippet in the library contains a bug. A player who reads the labels and ignores the code still wins. The real fix is authoring snippets where the code is genuinely fine — that is **Phase 6 content work, not Phase 0**. Note it in your PR description; do not start it. If your rebalance work suggests a cheap schema affordance that would make those puzzles easier to author later (it may not), mention it in the summary — don't build it.

---

## Item 2 — Swipe gesture reliability on phones

Separate from the above, and this one is real. Audit the touch path end to end: `gestureThreshold.ts`, `@use-gesture`'s `useDrag` config in `SwipeBinary.tsx`, `touch-action`, and scroll interference.

Specific thing to check first, because it's the most likely culprit: the commit path computes signed velocity as `vx * dirX`. `@use-gesture` reports `direction` as `-1 | 0 | 1` from the **last movement delta**. On a real finger release — where the finger often pauses or micro-reverses just before lift — `dirX` can be `0` (velocity collapses to 0, fails `minVelocity`, no commit) or flip sign (direction mismatch, no commit). The failure mode that produces is _"my swipe did nothing and I had to tap the button,"_ which is consistent with "buggy on phones." Confirm or rule this out with a unit test at the `gestureThreshold` layer plus whatever component-level test the fix warrants; if it's the cause, derive the signed velocity from the gesture's own sign convention rather than multiplying by a last-frame direction.

`DEFAULT_SWIPE_THRESHOLD` values (120px / 0.3 px/ms) are tunable, but treat retuning as the last resort, after the sign bug is ruled out — the current values are documented and reasoned, and lowering thresholds to paper over a sign error would trade one bug for accidental commits.

---

## Item 3 — Browse selection doesn't reflect in the puzzle view

Backlog wording: _"Browse Puzzles doesn't reflect selection in the puzzle view on the right; should also be able to interact with the puzzle-view type directly."_ Reproduce on **desktop (≥1024px)** first — the symptom is layout-specific and doesn't exist on mobile.

Strong hypothesis, verify before acting: `PracticePage.tsx`'s `view === 'patterns'` branch returns early and renders **only** `.app-shell__main`. The desktop `.app-shell__sidebar` and the puzzle card are both unmounted, so Browse is a full-page takeover rather than a master-detail view — there is no "puzzle view on the right" to reflect a selection into. (`usePracticeSession.setPatternFilter` does correctly re-serve a puzzle on selection, so the state layer is probably not at fault.)

Target behavior on desktop: the pattern list and an interactive puzzle coexist; selecting a pattern immediately serves and renders a playable puzzle from that pattern without a separate navigation step. Mobile keeps the current full-screen picker flow — don't cram a two-pane layout onto a phone.

**Scope discipline:** Phase 1 gives Browse a real `/browse` route and Phase 1 owns the routing rework. Fix the layout/selection defect within the existing `view` state machine; do not introduce a router, and do not build a full puzzle browser. If the clean fix genuinely requires routing, stop and say so rather than pulling Phase 1 forward.

Compose from the existing v2 design system — tokens, card surfaces, chip and progress-track styles already in `practicePage.css`. If a genuinely new visual pattern is needed, flag it for a Claude Design round instead of inventing one.

---

## Definition of done — code

- [ ] Failing-then-passing content test proving the swipe-direction distribution defect
- [ ] Swipe `correct_direction` split lands in 45–55%, deterministic and reproducible from the committed script
- [ ] `validate:content` **fails** on a >65/35 skew fixture; passes on the rebalanced library
- [ ] Generator prompt and `devPuzzles.ts` no longer anchor to a single direction
- [ ] Swipe commit path: root cause of dropped gestures identified in writing, fixed, and covered by a test that would have caught it
- [ ] Desktop Browse: selecting a pattern renders an interactive puzzle in-layout; mobile flow unchanged, with tests at both widths
- [ ] `pnpm validate` green; zero new dependencies

## What you verify vs. what's on me

**Yours:** everything above, plus a one-paragraph note in the PR on how I can reset my local rating after the swipe rebalance (export → edit → import is fine — don't build a dev UI). My stored rating is inflated by however many blind-right swipes I made; I want the option to zero it before Phase 1.

**Mine (do not attempt, do not check off):**

- PostHog receiving real `session_start` / `attempt` events from production on a phone (the `VITE_POSTHOG_KEY` Cloudflare Pages env var was set outside the repo and has never been confirmed live)
- Bad path on getcodoro.com returning HTTP 404
- Service-worker update prompt appearing against a real redeploy
- Swipe gesture feel on real iOS and Android hardware

If any of your work changes what I need to check on device, say so explicitly at the end of your summary.

## Orchestration

- Branch `v2-phase-0`, PR into `main` when green.
- Commit order: failing distribution test → validator rule + fixture → generator/devPuzzles prompt fix → rebalance script → rebalanced puzzle JSON → gesture fix → desktop Browse fix. No batching; the JSON diff stays isolated from logic changes.
- Delegate to a subagent: the rebalance script, CSS scaffolding for the desktop Browse layout, test boilerplate. Keep your strongest reasoning on the gesture sign analysis and the validator threshold rule — those are the two places a wrong call silently re-corrupts rated attempts.
- When done: report the actual before/after direction split, the confirmed root cause of the gesture drop (or evidence there wasn't one), what the desktop Browse fix touched, and anything you couldn't compose from the existing design system.

## Build-plan status

`docs/v2-build-plan.md` Phase 0 and `docs/v2-backlog.md` are **already corrected** — the rediagnosis, the 45–55% rebalance, the validator rule, the gesture sign-bug hypothesis, the desktop-only Browse framing, and the Phase 6 deferral of genuinely-correct-code swipe puzzles are all recorded there. Treat the plan as authoritative; you don't need to amend it up front.

Do append an amendment at the end of the phase if your work contradicts any of it — specifically if the gesture root cause turns out not to be the `vx * dirX` sign issue, if the desktop Browse fix can't be done inside the existing `view` state machine, or if the rebalance surfaces something about the schema that changes Phase 6's shape. Same amendment convention v1 used. Silent divergence from the plan is the failure mode here; the plan was wrong once already because nobody checked it against the code.
