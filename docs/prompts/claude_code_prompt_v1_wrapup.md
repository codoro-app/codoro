# Prompt for Claude Code — v1 wrap-up (close it out, don't grow it)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first; confirm `main` includes the squash-merged gap-driven-generation PR. Standing rule as every phase: `src/app/pwa/` is hands-off; list any touched file there in your summary.

---

## Framing — read this before you make any judgment call

**v1 is being closed out, not improved.** It will not be marketed and is not expected to acquire users. The core content is bug-spotting _quiz questions_, not puzzles, and that is a v2 problem — not something to patch here.

Every trade-off in this prompt resolves toward **done, honest, and cheap** over **better**. If you find yourself wanting to improve gameplay, content quality, or add a feature: stop, write it in the v2 backlog file (Task F), move on. Scope creep here has negative expected value — the time belongs to v2.

Two hard constraints:

- **API token budget is tight — this pass spends $0 on the API.** You author the 4 needed puzzles yourself (Task B); `pnpm generate:puzzles` is not run. Do not propose regenerating, re-reviewing, or re-calibrating the existing 104.
- **No new features.** Nothing from `todo.md` gets built in this pass except Task E.

---

## Task A — Renegotiate the Phase 8 content DoD

`codoro_build_plan.md` Phase 8 requires ≥150 puzzles. The pool is at 104 and will be 108 after Task B. **Amend the plan rather than generate 42 more.**

This is explicitly authorized by the plan's own text: _"renegotiate the 150 target early if not [realistic]; 120 well-calibrated puzzles beat 200 rushed ones."_

Edit the Phase 8 convergence checkpoint in `codoro_build_plan.md`:

- Change `≥150 puzzles` to `≥108 puzzles` and mark it met.
- Add a dated amendment note directly beneath the checklist explaining **why**, in plain language: the pool was capped at 108 because v1's content format was judged to be quiz questions rather than puzzles, so additional volume in the same format had no expected return. The curve-shape requirements (per-pattern spread, no empty buckets) were still met in full. Reference `docs/phase8-content-status.md`.
- Leave every other Phase 8 checkbox as-is; they get ticked by Task B's result.

Do not quietly delete the 150 target. The amendment record is the point — future-you needs to know this was a decision, not a slip.

## Task B — Close the curve gaps by authoring the 4 puzzles yourself

**Do not run `pnpm generate:puzzles`.** The API budget is tight and this is a 4-puzzle job — you are going to write these files directly. The script stays in the repo untouched for v2; it just isn't the tool for a batch this small.

First run `pnpm generate:puzzles --dry-run` **only** to confirm the manifest still matches the analysis (a dry run makes zero API calls). It should be exactly:

- concurrency @ 1200-1399 ×2 (bias low)
- error-handling @ 1800-1999 ×2 (bias high)

If it differs, stop and report — something changed on disk.

### Before you write anything

Read, in this order:

1. `src/content/CALIBRATION.md` — the S/T/D/C rubric. Score each puzzle on all four dimensions and **put the scores in your PR description**, not in the JSON. This is the thing that keeps ratings honest.
2. `src/content/schema.ts` — `PuzzleSchema` is authoritative. Note the `superRefine` cross-field checks: `correct_choice` must index into `choices`, and `correct_line` must be a valid 0-indexed line of `snippet`.
3. `src/content/GENERATING_PUZZLES.md` — the authoring conventions the existing pool follows.
4. The 8 existing puzzles in each target pattern (`src/content/puzzles/concurrency/con-00{1..8}.json`, `src/content/puzzles/error-handling/err-00{1..8}.json`) — match their voice and shape, and make sure you aren't restating a bug that's already covered.

You have an advantage the API pipeline doesn't: you can read the entire existing pool. Use it to avoid duplicates.

### Files to write

| id        | pattern        | target rating | interaction                              |
| --------- | -------------- | ------------- | ---------------------------------------- |
| `con-009` | concurrency    | 1200–1399     | pick to move the mix toward swipe-binary |
| `con-010` | concurrency    | 1200–1399     | "                                        |
| `err-009` | error-handling | 1800–1999     | "                                        |
| `err-010` | error-handling | 1800–1999     | "                                        |

Path is `src/content/puzzles/<pattern>/<id>.json`. IDs are permanent — never reuse or renumber.

The pool is currently 36% swipe-binary against a 45% target, and swipe-binary is what feeds Rush. Prefer it for at least 2 of the 4 where the bug suits a correct/buggy framing.

**Rating placement matters more than the bucket edges.** Don't cluster on round numbers — the existing pool's biggest calibration smell is that most ratings land on exactly 1000/1600/1700/1900. Pick values the rubric actually produces (1275, 1340, 1875, 1910 — whatever the S/T/D/C scores justify) and keep them inside the target bucket.

**The concurrency pair is the important one.** `1200-1399` is empty, and 1200 is exactly where every new user starts. These two puzzles are the first non-trivial thing a new player will be served. Make them genuinely good — a real concurrency bug at moderate difficulty, not a toy. This is the one place in this whole wrap-up where quality is worth extra effort.

Concurrency at ~1300 is a real constraint: most classic concurrency bugs are 1600+. Aim for something where the race is visible once pointed out but easy to skim past — a non-atomic read-modify-write, a shared counter without a lock, an `await` inside a loop that was meant to be parallel.

### Then verify

- `pnpm validate:content` — must pass. This is the actual gate; it catches malformed JSON, bad indices, duplicate ids, out-of-range difficulty.
- `pnpm content:stats` — confirm every pattern now spans ≥800pt, no empty bucket between 800 and 2199, total 108.
- `pnpm validate` — full green.

### Self-review pass

The API pipeline had a separate `selfReview()` call that pass/failed each puzzle in a fresh context. Reproduce that: after writing all 4 and passing validation, **re-read each file cold in a subagent** and check, for each — is the stated bug actually a bug, does the explanation correctly describe it, are the distractors plausible but unambiguously wrong, and does the difficulty match the rubric score? Report the verdicts. Fix and re-verify anything that fails.

Do not skip this because you wrote them. Same-context self-review is the weakest kind.

### Do not touch

`src/content/dailyCalendar.ts` is append-only and pinned by `dailyCalendar.test.ts`. These 4 puzzles do **not** get appended to it — the Daily calendar is seeded and frozen, and adding entries is a separate decision.

### Deferred: generator model split

The earlier version of this plan had you split `const MODEL` in `generatePuzzles.ts` into separate generate/review models and make the cost constants per-model. **Skip it.** You aren't running the script today, and refactoring pricing constants for a tool that won't execute is busywork. Log it in `docs/v2-backlog.md` as a prerequisite for any future batch run, noting that `INPUT_COST_PER_MTOK`/`OUTPUT_COST_PER_MTOK` are currently hardcoded to Sonnet rates and feed the `COST_CEILING_USD` guard, so they must be corrected before trusting a projection against a different model.

## Task C — Replace the README

`README.md` is still the stock `create-vite` template — it talks about Oxlint and the React Compiler, neither of which this project uses. It is the first thing anyone opening this repo sees, including future-you in six months.

Write a real one, short:

- What Codoro is, in two sentences.
- Live URL, and that it's a PWA (installable).
- Stack: Vite + React 19 + TS strict, pnpm, Cloudflare Pages, IndexedDB, PostHog.
- Local dev: prerequisites (Node from `.nvmrc`, pnpm via Corepack), `pnpm install`, `pnpm dev`.
- The script table: `validate`, `test`, `validate:content`, `content:stats`, `generate:puzzles`.
- Architecture in five lines — the `engine` / `content` / `storage` / `telemetry` / `app` split and the lint-enforced rule that `engine/` imports nothing from React or `app/`.
- A **Status** section stating plainly: v1 complete, not actively developed, v2 in planning. Link `docs/v1-retro.md`.

No badges, no roadmap section, no marketing voice.

## Task D — Reduced Phase 9 hardening

Phase 9's full checklist assumes a launch. There is no launch. Do **only** these, and tick them in the build plan as you go:

- [ ] `pnpm validate` passes clean from a fresh clone (typecheck, lint, test, validate:content, build)
- [ ] Lighthouse on production `getcodoro.com`: PWA installable, performance ≥90, a11y ≥90. Report the actual numbers. If something fails and the fix is under ~30 minutes, fix it; otherwise record it in the v2 backlog and move on.
- [ ] 404 handling, favicon, apple-touch-icon, OG tags present and correct on every route
- [ ] Error boundary fires an event that actually lands in PostHog (trigger one deliberately in a preview deploy and confirm)
- [ ] Export → clear site data → import round-trip works on production
- [ ] SW update flow verified against one real deploy

**Explicitly skip** (write one line in the retro saying they were skipped and why): PostHog growth dashboards for day-2 return / session length, the week-long storage-survival soak, the fresh-user friend walkthrough, cross-device Daily verification. All of these measure adoption that isn't coming.

## Task E — Minimum legal

From `todo.md` item 8. The app sets analytics cookies via PostHog and stores user data locally, so this isn't optional theater.

- A single `/legal` route (or a static page) with short Terms and a Privacy notice: what's collected (anonymous PostHog events, no accounts, no PII), that puzzle progress lives in the browser's local storage and can be exported or cleared by the user, and a contact address (the project Gmail).
- Footer link to it from the app shell.
- Keep it plain-language and under a page. Compose from existing design tokens; do not invent new visual patterns.

Note in your summary that this is a good-faith developer-written notice, not reviewed by a lawyer.

## Task F — The v1 retro and v2 backlog (the actual deliverable)

Create `docs/v1-retro.md`. This is the bridge to v2 and the highest-value artifact in this pass — give it real thought rather than summarizing commits.

Cover:

**What shipped.** Phases 0–8 in a short table with the one-line outcome of each.

**The central finding — quiz vs. puzzle.** Write this carefully, it's the v2 thesis:

> The content is quiz questions about bugs, not puzzles. An MCQ where three of four options are implausible is trivia. A swipe-binary "correct or buggy?" is a coin flip with an explanation attached. Neither requires the player to _hold state and reason forward_ — and that's the thing that separates a puzzle from a quiz. Wordle is a puzzle because constraints accumulate across guesses. Codoro v1 asks one-shot recognition questions, so it plays like a flashcard deck with an Elo score bolted on.
>
> Notably, the v1 build plan already identified the fix and deferred it: the **execution scrubber** — stepping through code state — was cut from v1 and named the "V2 flagship." That instinct was correct.

**Secondary findings**, from `docs/phase8-content-status.md`:

- Difficulty curve was bimodal with a dead zone at exactly the 1200 starting rating — new users drew only from the trivial cluster, then hit a 1600 wall.
- LLM-assigned ratings anchor to round numbers instead of applying the calibration rubric.
- Language mix ended up 61% JavaScript, 2% C — no target mix was ever set the way interaction type had one.
- 104 puzzles ≈ four sessions before repeats. Content volume is the binding retention constraint in any format.
- No backend meant no leaderboard, no head-to-head, no social loop — an Elo rating nobody else can see is a number in a drawer.

**What the architecture bought.** Be honest both directions: the pure-`engine`/tested-storage/content-pipeline separation means v2 can replace the _content format and UI_ without touching rating, streak, requeue, selection, or persistence. That was the right call and it's why v2 is a rebuild of the top half, not a rewrite. Against that: nine phases were spent before a single external user tried it.

**What was skipped in wrap-up and why** — the Task D skip list.

Then create `docs/v2-backlog.md`: a flat, unprioritized capture of everything deferred — `todo.md`'s remaining items (drag-drop code blocks, Rush timer and escalation, shareability, rating reveal on Daily, mobile drag/sizing bugs, browse-puzzles view sync bug, LCP, swipe-always-right bug, the security/Clerk block), plus anything you flagged during this pass. Do not design or prioritize it. Capture only.

Delete `todo.md` once its contents are absorbed, so there's one backlog and not two.

## Task G — Repo hygiene and tag

- Delete merged local and remote branches. As of this writing that's everything except `main`: `content/gap-driven-generation`, `daily-curated-pool`, `fix/mastery-panel-sync`, `phase-6-daily`, `phase-6.5-ui`, `phase-7-rush`, `phase-8-puzzle-content`, `ui-v2-arena`, `ui-v2-followups`, plus the stale `phase-1-rating-engine`, `phase-2-storage-layer`, `phase-3-content-pipeline`, `phase5-fixes-asset-cache`, `phase5-fixes-sw-cache` on origin. **Verify each is actually merged into `main` before deleting** — report anything that isn't rather than deleting it.
- The ten `claude_code_prompt_*.md` / `claude_design_prompt_*.md` files are untracked in the repo root. Either commit them to `docs/prompts/` as build history or delete them — your call, but the root shouldn't stay littered. State which you did.
- Tag `v1.0.0` on `main` after everything above is merged, with an annotated message pointing at `docs/v1-retro.md`.

## Out of scope — do not touch

- Any gameplay or "make it fun" change, including the Rush countdown timer
- Any auth, accounts, backend, or the `todo.md` security block
- Any content generation beyond Task B's four puzzles
- Any v2 design or implementation work

## Definition of done

- [ ] Phase 8 DoD amended in the build plan with a dated, reasoned note; all its boxes now honestly tick
- [ ] 108 puzzles, hand-authored not API-generated; `content:stats` shows every pattern ≥800pt spread and no empty bucket 800–2199
- [ ] S/T/D/C rubric scores reported for each new puzzle; cold subagent review passed on all 4
- [ ] `generatePuzzles.ts` unmodified; its model/pricing split logged in the v2 backlog instead
- [ ] README replaced; no trace of the Vite template
- [ ] Reduced Phase 9 list complete with real Lighthouse numbers reported
- [ ] `/legal` route live and linked from the shell
- [ ] `docs/v1-retro.md` and `docs/v2-backlog.md` written; `todo.md` absorbed and deleted
- [ ] Branches pruned, prompts filed or removed, `v1.0.0` tagged
- [ ] `pnpm validate` green from a fresh clone

Work in small PRs, not one giant one — plan edits, content, README/legal, docs, hygiene. `main` is protected; squash-merge each.
