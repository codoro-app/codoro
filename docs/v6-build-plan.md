# v6 — The Coach: explanations, diagnosis, and the first paid tier

**Entry gate:** v5 closed at 5.4 + 5.6-lite (`docs/v5-closeout-decision.md`).

**Exit state:** a paid tier is live and has either taken real money from someone who is not
Thomas, or produced a written decision that it will not. Both outcomes close the version. Only
"we never found out" is a failure.

**Inserted 2026-09-19, direct user decision.** This version did not exist before. Gamification
and launch, previously v6, become v7; multiplayer becomes v8. This is the third renumber in the
repo's history — see the resequence banner in `docs/roadmap.md` and the warning in
`docs/v4-resequence` memory before trusting any version number in a doc written earlier.

## Why this version exists

The six-month monetization deadline (`docs/v5-closeout-decision.md`) makes the old sequence
unaffordable. v7's gamification work is retention work, and retention work is a multiplier on
traffic that does not exist yet. This version does three things instead: it builds the one
feature in the product that is plausibly worth paying for, it changes the positioning so the
product describes a problem people know they have, and it puts a payment mechanism in front of
both so the question gets answered rather than deferred.

## The thesis, stated so it can be proved wrong

People do not pay for more puzzles. Free alternatives have effectively unlimited content and
Codoro will never win on volume — there are 254 puzzles here and thousands on LeetCode.

People pay for three things in this category: an outcome tied to a deadline, something that
replaces a human, and obligation. The coach layer is the second one. When a player gets a puzzle
wrong, the product currently tells them what the bug was. It does not tell them **why the answer
they chose was wrong**, which is the thing a tutor sitting next to them would say and the thing
no free alternative does.

The structural advantage that makes this buildable: **every interaction type in this codebase
has a bounded wrong-answer space.** mcq has at most four wrong choices, swipe-binary has one,
tap-line has one per snippet line, scrubber checkpoints have at most four each. There is no
free-text answer anywhere in the schema. So the explanations can be generated once, offline,
and shipped as static content — zero runtime cost, zero latency, no LLM abuse surface, works
offline, and no per-request token bill. Competitors doing this are paying per token at request
time. See `docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md` for the full
design.

If the thesis is wrong, 6.5 is where that becomes visible, and it becomes visible in month three
rather than month six.

## The law this version must not break

**The paid tier adds; it never removes.** The existing per-puzzle `explanation` field stays free
and unchanged for everyone, signed in or not. Taking away something players already have in
order to sell it back is the fastest way to poison a 40-person userbase, and it would violate
the guest-first principle that has held since v5. Every phase below is additive.

## Phases

| Phase | What                                                                              | Sessions                     |
| ----- | --------------------------------------------------------------------------------- | ---------------------------- |
| 6.0   | Wrong-answer explanation content: generation pipeline + the mcq/tap-line batch    | 2–3 + generation runs        |
| 6.1   | The coach surface: rendering, free/paid split, the misconception label            | 1–2                          |
| 6.2   | Entitlements + Stripe: D1 table, Checkout, webhook, deletion-cancels-subscription | 2–3                          |
| 6.3   | Weakness diagnostic: pattern- and misconception-level accuracy, targeted drills   | 1–2                          |
| 6.4   | Repositioning: landing copy, OG text, store metadata                              | 1                            |
| 6.5   | Private cohort: 20–30 real players, measure day-2/day-7 return and conversion     | ongoing, not a build session |

**Sequencing.** 6.0 is the long pole and the only phase whose cost is mostly generation time
rather than coding time, so it starts first and its batches run in the background of everything
else. 6.1 needs 6.0's content to render. 6.2 is independent of both and can interleave. 6.3
depends on 6.0's `misconception` labels existing, which is why they are generated in 6.0 rather
than retrofitted. 6.4 depends on nothing and could be done in an evening — it is listed late
only because it is the smallest. 6.5 needs 6.1 shipped and should start the day it is.

### Phase 6.0 — Explanation content

Full spec: `docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md`. Summary:

1. `src/content/tools/generateExplanations.ts`, reusing `llmBackend.ts`'s existing CLI backend
   (subscription usage, not Console credits — and reusing `buildCliChildEnv`, see F33).
2. A new `src/content/explanations/<puzzle-id>.json` file per puzzle, deliberately **not** a
   field on the puzzle JSON and deliberately **not** re-exported from the content barrel (F32,
   F37 — this is the pools.ts lesson, and it has already bitten this repo once).
3. First batch: mcq (60 puzzles, 185 wrong choices) and tap-line (39 puzzles, ~560 wrong lines).
4. `validate:explanations` wired into `pnpm validate` and CI.
5. A stratified human read of ≥20 generated explanations before the batch ships. This is the
   quality gate that actually matters and the one most likely to get skipped.

**DoD:** every mcq and tap-line puzzle has a valid explanation file; `validate:explanations` is
in CI and fails on a malformed or orphaned file; the human read is recorded in the amendment with
what was found and what was regenerated; zero change to any existing puzzle JSON; a production
build confirms no explanation content entered any pre-existing chunk.

### Phase 6.1 — The coach surface

1. Wrong-answer explanations render in the existing feedback drawer in `PuzzleCardShell.tsx`,
   below the free explanation, never replacing it.
2. Free tier sees the free explanation plus a single honest line naming what the coach would
   have said — the misconception label, not a blurred paragraph or a fake preview.
3. Lazy load: the explanation file for a puzzle is fetched only on a wrong answer, only for an
   entitled user, through the same per-id promise-cache pattern as `puzzleBodyCache.ts`.
4. Metered free taste: N coach explanations per week for signed-out and free users (N settled in
   the build prompt; the recommendation in the spec is 3). A metered taste beats a time-limited
   trial here because it re-creates the buying moment every week instead of once.

**DoD:** free users' experience is provably unchanged except for the added label; the coach panel
renders for entitled users; no explanation chunk is fetched for an unentitled user beyond their
meter; play-path bundle size unchanged against the perf baseline, measured not asserted.

### Phase 6.2 — Entitlements and Stripe

1. Migration `0003_entitlements.sql`: an `entitlements` table keyed to `clerk_user_id` with
   `ON DELETE CASCADE`, carrying tier, Stripe customer and subscription ids, and period end.
2. Stripe Checkout, `GET /api/entitlement`, and `POST /api/stripe/webhook`.
3. **The webhook is the second unauthenticated write endpoint in the system** after
   `/api/report`. It gets the same treatment that endpoint's security posture established, plus
   signature verification and idempotency keyed on Stripe's `event.id` — Stripe retries, and a
   non-idempotent handler will double-apply. It needs its own line in T13's authz suite, because
   an authz suite structurally cannot cover an endpoint with no auth. See F34.
4. **Account deletion must cancel the subscription** (F38). Deleting a paying user's rows while
   Stripe keeps billing them is both a defect and a genuine ethical problem. This extends T13's
   deletion round-trip, which must be re-run and re-evidenced after this phase.
5. Client entitlement cache fails open for a short grace window so a paying user on a plane is
   not locked out, and fails closed after it (F36).

**DoD:** a real card (Stripe test mode, then one live transaction) moves a user from free to
coach; webhook replay of the same `event.id` is a no-op; deleting an account cancels the
subscription, verified against the Stripe API and pasted into the amendment; entitlement is
enforced in the Worker, with the client gate documented as display-only.

### Phase 6.3 — Weakness diagnostic

The `misconception` labels generated in 6.0 give a finer grain than the 13 existing pattern
slugs. Free tier shows overall rating and pattern-level accuracy. Coach tier shows the
misconception breakdown and generates a targeted drill set from the player's own worst three.
This reuses attempt data already in the sync payload; no new collection.

**DoD:** the diagnostic is computed from real stored attempts, never from placeholder numbers
(the repo's standing no-fake-numbers rule); a player with fewer than N attempts sees an honest
"not enough data yet" rather than a misleading chart.

### Phase 6.4 — Repositioning

Codoro's pattern taxonomy — off-by-one, null/undefined, concurrency, mutable-state,
type-coercion, scope-closures, resource-management and the rest — is not an algorithms product.
It trains the skill of reading code you did not write and finding what is wrong with it. That is
a category nobody owns, it maps onto the code-review interview round, and in 2026 it maps onto
reviewing LLM-generated code, which is a problem most working developers now have daily.

No new content is required for this. It is landing copy, meta description, the OG card text from
T11, and the app manifest description. It may be the highest-leverage session in the version.

**DoD:** a first-time visitor can tell within one screen what skill this trains and why they'd want it.

### Phase 6.5 — Private cohort

20–30 real players, recruited individually — not a launch post, and it does not spend the launch
audience. Measure day-2 and day-7 return, coach-panel open rate on wrong answers, and conversion.

**The decision rule, written before the data so it cannot be rationalized afterwards:**

- Day-7 return above 20% → the retention thesis holds; proceed to v7 and a real launch.
- Day-7 return 10–20% → the product works for some people; find out who before building more.
- Day-7 return below 10% → the coach layer did not fix retention. Do not build v7. The remaining
  moves are the one-time content pack and the classroom tier, and that call gets made in
  December with four months left, not in March with none.

## Running in parallel, not a phase

**Instructor conversations.** Five conversations with OSU CS faculty, TAs, or Columbus bootcamp
operators about a classroom tier — roster, assignment sets, progress dashboard. This costs zero
engineering time and has the highest dollar-per-sale of anything in this document. It is not a
phase because it is not code; it is listed because it should be happening throughout.

**Content authoring.** Agreed as needed (2026-09-19) and unchanged by this plan. Note the
interaction with 6.0: every new puzzle authored after the batch runs needs its own explanation
set, so `validate:explanations` must fail on a puzzle that has none, or coverage will silently rot.

---

# Amendment — 2026-09-20: Phase 6.0 built, first batch generated, human read outstanding

Executed against `docs/prompts/claude_code_prompt_v6_phase6_0_explanations.md` and
`docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md`, on branch
`feat/v6-phase6-0-wrong-answer-explanations`. All six pieces done; the coach UI, entitlements, and
Stripe remain out of scope (6.1/6.2), as specified.

## Piece 0 — F33 re-confirmed, no regression

`llmBackend.ts`'s `buildCliChildEnv` still strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/
`CLAUDE_API_KEY` before spawning `claude -p`, on every `spawnSync` call in the cli backend
(`checkCliAvailable` and `generateStructured` both pass it as `env`). The file has exactly one
commit in its history — the one that added this safeguard — so there was never a chance to
regress it. Live-verified anyway: with those three vars stripped, `claude -p` completed
successfully via subscription auth with no "ANTHROPIC_API_KEY ... takes precedence" warning.
Confirmed safe to route the batch through the default `cli` backend.

**Unplanned incident during this check, recorded for transparency:** a shell command intended to
print only whether `ANTHROPIC_API_KEY` was set (yes/no) instead printed its literal value into
this session's output, due to a bash parameter-expansion mistake (`${VAR:-default}` only
substitutes when `VAR` is _unset_, not when it's merely being probed). Flagged to Thomas
immediately; his response was that the key carries no funds, so the exposure is low-risk, but it
is still sitting in this session's transcript and worth rotating at his convenience.

## Pieces 1–4 — pipeline built

- `src/content/explanationSchema.ts` — `ExplanationEntrySchema`/`ExplanationSetSchema` per §3.2,
  plus a superRefine for duplicate targets and the swipe-binary single-entry/target-0 shape, and
  an ordinal-reference regex on `why_wrong` (§8 item 6). 25 unit tests at the bounds
  (`explanationSchema.test.ts`), mirroring `schema.test.ts`'s convention. `schema.ts`'s `IdSchema`
  was exported (previously private) so both schemas share one id-shape definition rather than a
  duplicated regex.
- `src/content/tools/generateExplanations.ts` — one LLM call per puzzle, requesting only `entries`
  from the model (puzzle_id/interaction/generated_at/generator_version are always owned by the
  script, never trusted from the model — same discipline as `generatePuzzles.ts`'s `id`).
  Idempotent by default (a puzzle whose file already validates and covers exactly its current
  wrong targets is skipped unless `--force`), writes per-puzzle immediately, batched by pattern,
  `--pattern`/`--interaction`/`--force`/`--dry-run` flags. Routes through `llmBackend.ts` with no
  new spawn path, per instruction. **Deviation from the spec's literal cost math worth recording:**
  `maxTokens` started at 8192 (matching `generatePuzzles.ts`) but a live 26-line tap-line puzzle
  produced 6678 output tokens before the largest puzzle in the pool (30 lines) was even reached —
  raised to 16384 before the real batch ran, to avoid silent truncation on the largest tap-line
  puzzles.
- `src/content/tools/explanationTargets.ts` (new, not named in the prompt) — `wrongTargetsFor(puzzle)`,
  factored out so the generator's idea of "which targets does this puzzle have" and the
  validator's idea can't drift into two independently-maintained copies.
- `src/content/tools/validateExplanations.ts` — all seven §8 conditions: four self-contained
  ones live in the schema itself (duplicate target, ordinal reference, swipe-binary shape,
  length/schema bounds), three cross-file ones (unknown `puzzle_id`, out-of-range target, target on
  the correct answer, missing coverage) live here against the real, validated puzzle pool.
  Coverage is enforced only for mcq/tap-line (swipe-binary is optional this phase, per §10/DoD).
  Wired into `pnpm validate` (right after `validate:content`) and into `.github/workflows/ci.yml`
  as its own step. Both the "unknown puzzle_id" and "target on correct answer" failure modes were
  exercised live against real files during development (then reverted) to confirm the checks
  actually fire, not just that they typecheck.
- `src/content/explanations.ts` — the lazy `import.meta.glob({ eager: false })` loader,
  `getExplanationSet(id)`, mirroring `index.ts`'s `getPuzzleBody` contract (undefined for a
  missing id, throws only on a schema-invalid file). Never re-exported from `./index`;
  `barrelBoundary.test.ts` extended with `getExplanationSet` in `FORBIDDEN_NAMES` plus a violation
  fixture and a deep-import fixture, exactly as asked. **Measured, not asserted, per the DoD:** a
  real `vite build` was run and `grep`'d across the entire `dist/assets/` output for
  `why_wrong`/`misconception`/`ExplanationSet`/`getExplanationSet` — zero matches. Nothing in the
  app imports `getExplanationSet` yet (the coach UI is 6.1), so the whole module currently
  tree-shakes out of the production bundle entirely, which is a stronger result than "isolated to
  its own chunk" — there is presently no reachable import path into it at all. The barrel-boundary
  test is what keeps that property from regressing once 6.1 actually wires a consumer in.

## Piece 5 — first batch: 99/99, one retry

mcq (60 puzzles, 185 wrong choices) and tap-line (39 puzzles, ~560 wrong lines) both ran to
completion. Final state: **99 explanation sets, 99 schema- and cross-check-valid**
(`validate:explanations: 99 explanation set(s) OK`).

- mcq: 56 generated this session (4 had already been generated during Piece 2's own pipeline
  testing) + 4 = 60/60, 0 failures.
- tap-line: 35 generated in the first run, 1 failure (`cf-032`, the largest tap-line puzzle in the
  pool — 30 lines / 29 wrong lines — the `claude` CLI exited immediately with no output on all 3
  retry attempts, a transient failure rather than a cost or logic problem), 3 already generated
  during Piece 2/4 testing = 38/39. Retried alone afterward and succeeded on the first attempt =
  39/39, 0 failures net.
- Combined usage: 96 real calls across the two batches (mcq + first tap-line run) plus 1 retry
  call = 97 calls, all via the `cli` backend (Claude subscription usage, not Console API credits).

**A live check-in happened mid-run, recorded because it changes how future batches should be
run.** After the tap-line batch's one failure, Thomas asked whether this could be done through
chat instead, out of concern about spending money — this session's standing feedback memory
("content work through chat, not API") is specifically about scripts that call the Anthropic
Console API with Thomas's own key, which is exactly the failure mode Piece 0/F33 exists to
prevent for _this_ pipeline (the `cli` backend spends subscription usage, the same pool this
conversation itself runs on, not a separate metered budget). Once that mechanism was restated,
Thomas chose to retry the script for the one remaining puzzle rather than have it hand-written in
chat — recorded here so a future session doesn't need to re-litigate it, but also doesn't assume
blanket permission for LLM-billed scripts beyond what this pipeline's specific, verified
subscription-billing design covers.

## Piece 6 — 20-sample human read staged, not performed

`docs/v6-explanation-sample-2026-09-20.md`: 20 entries, one wrong-answer explanation each,
stratified across all 13 patterns (10 via mcq, 10 via tap-line, chosen so the two halves' coverage
overlaps in the middle and spans all 13 together), three difficulty bands (6 low / 8 mid / 6
high), and both interaction types generated this batch. Three tap-line rows were deliberately
forced to a `not-the-bug-site` filler entry so that convention is represented too — though all
three landed on the same "trivial declaration/signature line" flavor of that convention rather
than a more varied set, noted as a sampling-script weakness in the file itself, not a generation
defect. Selection was a local, zero-LLM-call script reading the already-generated files.

**The read has not happened.** Per the spec's explicit instruction, the generating session must
not be the grading session — this file exists to be read by Thomas or a fresh-context session, with
a blank verdict column per entry and the pass bar (>2/20 substantively wrong ⇒ the prompt is
broken, fix and regenerate, don't hand-patch) restated at the top of the file.

## DoD

- [x] Piece 0's F33 check confirmed in writing (live-verified; see above)
- [x] Every mcq and tap-line puzzle has a schema-valid explanation file (99/99)
- [x] No entry targets a correct answer anywhere in the batch (`validate:explanations` clean)
- [x] No ordinal references survive validation (schema regex; clean)
- [x] `validate:explanations` is in `pnpm validate` and CI, and fails on a puzzle with no file
      (exercised live during development)
- [x] `barrelBoundary.test.ts` fails if the explanation loader is imported from a barrel path
- [x] Production build measured: zero explanation bytes anywhere in the build, not just outside
      pre-existing chunks (see Piece 4)
- [x] Zero changes to any file under `src/content/puzzles/` (confirmed via `git status`)
- [x] The 20-explanation sample file written and the read flagged as outstanding
- [~] `pnpm validate` green — typecheck, tests (2806 passed), `validate:content`,
  `validate:explanations` (99 OK), the production build, and `workers`' own
  typecheck/lint/test (83 passed) are all green. The root `eslint .` step currently fails, but
  only on 4 errors/2 warnings inside `.claude/worktrees/*` — untracked, gitignored leftover
  worktree directories from unrelated prior sessions (confirmed via `git check-ignore`), not
  part of the repo CI ever sees on a fresh checkout. Lint scoped to `src/content` (everything
  this session touched) is clean. Not cleaned up unilaterally, since deleting another
  session's worktree files without being asked is exactly the kind of action the standing
  git-safety guidance says to check before taking.
- [x] Amendment written (this section)

## Open decisions from spec §11 — still need Thomas, not a session

1. **Price** ($7/month or $49/year recommended). Not settled.
2. **Meter size** (3/week recommended). Not settled.
3. **Does the coach layer apply to Daily/Rush/Boss, or Practice only?** (Practice + Daily yes,
   Rush no, recommended). Not settled.
4. **Whether swipe-binary rides along in the first batch.** It did not — this session generated
   mcq + tap-line only, exactly as scoped. `generateExplanations.ts` already supports
   swipe-binary end-to-end (the schema, the prompt, and the target logic all handle it), so
   running it later is `pnpm generate:explanations --interaction=swipe-binary` and nothing more —
   but that run, and its own human-read sample, has not happened.

# Amendment — 2026-09-20: Phase 6.1 built — misconception vocabulary + coach surface

Executed against `docs/prompts/claude_code_prompt_v6_phase6_1_coach_surface.md` and
`docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md` (including its §3.2a
amendment, applied as part of this same session), on branch `feat/v6-phase6-1-coach-surface`
(from `main` at `aa2745f`, which already carries 6.0). All four pieces done.

## Piece 0 — misconception vocabulary consolidation

274 non-filler labels across 292 entries, 96% singletons, clustered into 39 canonical labels plus
`not-the-bug-site` (40 total) — one canonical label per puzzle, since 6.0's one-call-per-puzzle
generation means every non-filler entry within a puzzle already shares the same underlying bug.
Full method, final vocabulary with entry counts, and the raw→canonical mapping for all 292 entries:
`docs/v6-misconception-vocabulary-2026-09-20.md`.

- `src/content/misconceptions.ts` (new) — `MISCONCEPTION_SLUGS`, `MisconceptionSlug`,
  `MISCONCEPTION_LABELS`, modelled on `patterns.ts`.
- `src/content/explanationSchema.ts` — `misconception` changed from
  `z.string().regex(/^[a-z0-9-]{3,48}$/)` to `z.enum(MISCONCEPTION_SLUGS)`.
- All 745 entries across 99 files rewritten in place — 292 `misconception` fields changed, 453
  `not-the-bug-site` fillers untouched. **DoD's byte-identical proof, run against `f1a0b92` (6.0's
  ship commit):** every changed line in `git diff f1a0b92 -- src/content/explanations/` matches
  `"misconception":`; zero changed lines touch `why_wrong` or any other field.
- `src/content/tools/generateExplanations.ts` — the prompt's misconception rules now render the
  40-label closed list from `misconceptions.ts` (never hand-duplicated) with an explicit
  "pick the closest fit, never invent a new slug" instruction. `GENERATOR_VERSION` bumped 1 → 2.
- Largest canonical label: `break-doesnt-exit-as-expected` at 26/292 = 8.9% of the non-filler
  pool — comfortably under the 25% re-split threshold, so the clustering didn't collapse too far.

## Piece 1 — the coach panel

- `src/app/practice/CoachPanel.tsx` (new) — fetches via `coachExplanationCache.ts` (new,
  mirrors `puzzleBodyCache.ts`'s shared-promise-per-id cache exactly), which deep-imports
  `getExplanationSet` from `../../content/explanations`, never the barrel.
  `barrelBoundary.test.ts` still passes unmodified — this deep-import path is the one it already
  covers.
- `PuzzleCardShell.tsx` renders `<CoachPanel>` in both post-commit placements: desktop's
  normal-flow panel (below the free explanation, before `ReportPuzzleControl`) and mobile's sticky
  drawer. The drawer's previously-`<p>` scroll region (`overflow-y-auto`, capped by
  `drawerPanelClass`'s `max-h-[46dvh]`) became a `<div>` wrapping the free-explanation `<p>` plus
  the coach block, so the coach content scrolls inside the exact same region — no second scroll
  container, per spec §5.3.
- Three new optional `PuzzleCardShellProps` — `coachEligible`, `coachAvailable`,
  `onCoachExplanationShown` — all default to off/no-op, so every existing caller (Rush, Boss,
  and the 34 pre-existing `PuzzleCardShell.test.tsx` cases) is provably unaffected; that test file
  still passes unmodified, 34/34.

## Piece 2 — fetch timing and the meter

- `src/storage/schema.ts` — `CoachMeterSchema`/`CoachMeter` (`{ weekStart: string, used: number }`),
  added to `UserProfileSchema`/`UserProfile`. `CURRENT_SCHEMA_VERSION` 13 → 14.
  `createDefaultProfile()` seeds `{ weekStart: '', used: 0 }` — an empty `weekStart` never equals a
  real computed week boundary, so it always reads as "0 used" until the first real consume, the
  same "stale reads as reset" convention `dailyCompletion` already uses.
- `src/storage/migrations.ts` — `migrateV13ToV14` gives every existing profile the same neutral
  starting point. Both the full v1→v14 chain test and a new dedicated `MIGRATIONS[13]` unit test
  (mirroring every prior migration's own isolated test) pass.
- `src/sync/merge.ts` — new `'week-then-max'` merge rule: same `weekStart` on both sides →
  `Math.max(used)` (the same monotonic-counter convention as `bestRunStreak`); different
  `weekStart` → the more recent week wins wholesale (mirrors `dailyCompletion`'s date-mismatch
  branch). All three real sync fixtures (`fresh-install`/`long-lived`/`post-mission.json`) updated
  to v14 with `coachMeter`; the fast-check property tests over them (`merge(a,a)` stability,
  `merge(a,b) === merge(b,a)` commutativity, monotonic-never-decreases) all pass unmodified.
- `src/coach/entitlement.ts` (new) — `isEntitledToCoach()`, hardcoded `false`. The single
  injectable predicate the prompt asked for; no UI code branches on how it's implemented.
- `src/coach/coachMeter.ts` (new) — `currentUtcWeekStart`, `coachMeterRemaining`,
  `consumeCoachMeterUse`. Pure, unit-tested (`coachMeter.test.ts`, 11 cases: week-boundary math
  including a month rollover, remaining-floors-at-0, stale-week-reads-as-fresh, consume-rolls-a-
  stale-week-onto-the-current-one).
- `usePracticeSession.ts`/`useDailySession.ts` each grow `coachAvailable` (derived:
  `isEntitledToCoach() || coachMeterRemaining(profile.coachMeter, new Date()) > 0`) and
  `markCoachExplanationShown` (a no-op when entitled; otherwise consumes one use and
  `saveProfile`s it — same optimistic-update-then-persist shape as
  `usePracticeSession.ts`'s pre-existing `setSoundPreference`, deliberately not shared between
  the two hooks, matching `useDailySession.ts`'s existing "kept in sync deliberately rather than
  shared" posture for its other Practice-mirrored logic).
- `PracticePage.tsx`/`DailyPage.tsx` pass `coachEligible={true}` plus the two hook values through
  to `PuzzleCardShell`. `RushActivePlay.tsx`/`BossActivePlay.tsx` were not touched — omitting the
  prop defaults `coachEligible` to `false`, which is how "Rush shows no coach panel at all" is
  satisfied structurally rather than by a conditional.
- **Scope call on Boss/Missions, not asked, recorded here:** the build prompt's settled-decisions
  list says "Coach applies to Practice and Daily... Boss and Missions follow Practice's behavior
  where they reuse its surfaces." Boss's own `AttemptMode` is `'boss'`, distinct from `'practice'`
  — it is not literally in the "applies to" list, and Boss's health-bar/strike-limit pressure is
  the same "fights the clock" shape the spec explicitly excludes Rush for. Missions' quiz-shaped
  stages route exclusively through `BossStage`→`BossActivePlay` or `SpeedStage`→`RushActivePlay`
  (traced via `src/app/missions/*Stage.tsx`; there is no plain-mcq mission stage), so leaving Boss
  untouched means Missions shows no coach panel either, by the same structural mechanism — read as
  consistent with "follow Practice's behavior," not a contradiction of it. Not in this phase's DoD
  checklist either way. If Boss should get the coach layer, it's the same one-line
  `coachEligible={true}` + two hook fields `BossPage.tsx`'s own session hook would need — not
  attempted here, flagged for whoever decides it.
- **Live-verified, not just unit-tested:** built and ran the app (`pnpm dev`), answered real mcq
  puzzles wrong through the browser. Network tab: zero `/content/explanations/*` requests on
  puzzle load or a correct answer; exactly one such request, for the puzzle just answered, on a
  wrong answer (`nul-011.json`, confirmed by URL). Coach panel rendered the real fetched
  `why_wrong` text and misconception label below the free explanation; Next-puzzle/Continue stayed
  visible in both cases observed.

## Piece 3 — the free-tier treatment

**Deviation from the prompt's literal text, decided with Thomas mid-session, recorded here so it
isn't re-litigated:** Piece 2's DoD line ("zero explanation network requests for a spent-meter
viewer") and Piece 3's literal text ("show the misconception label... when the meter is spent")
are in direct conflict — the label only exists inside the same per-puzzle JSON chunk as
`why_wrong`, one fetch, no way to read one field without the other. Asked Thomas directly; chose
**zero-fetch wins**: a spent-meter viewer sees a plain honest line only ("You've used your 3 coach
explanations this week. More next week." — `WEEKLY_COACH_LIMIT` interpolated, not hardcoded) and
no misconception label, no fetch. `CoachPanel.test.tsx` asserts this directly:
`loadCoachExplanationSet` is never called when `coachAvailable` is `false`. **6.2 or a later
session revisiting this: the label-for-spent-viewers idea in the original spec is not implemented;
either accept the honest-line-only version as final, or build the "lightweight label-only index"
option that was explicitly not attempted here (separate build artifact, its own barrel-boundary
case) if the label is judged worth the added surface.**

## DoD

- [x] Piece 0's four DoD lines, including the byte-identical `why_wrong` proof (see above)
- [x] Coach panel renders below the free explanation, inside the existing scroll region (mobile
      drawer restructured to a wrapping `<div>`, one scroll container; desktop unaffected — it was
      never capped/scrolling to begin with)
- [x] Continue button stays visible — live-verified with real fetched content (a 3-sentence,
      ~330-character coach block plus the free explanation); the exact single longest `why_wrong`
      in the library (404 chars, `mut-022`) was not individually pixel-tested, but is protected by
      the same `max-h-[46dvh]` + inner-`overflow-y-auto` structural cap already proven for the free
      explanation, which the coach block now shares rather than duplicates
- [x] A free viewer's first `WEEKLY_COACH_LIMIT` (3) wrong answers of the week show the coach; the
      next shows the label-less honest line — proven by composition of two independently unit-
      tested pieces (`coachMeter.test.ts`'s remaining/consume arithmetic +
      `CoachPanel.test.tsx`'s fetch-gating on `coachAvailable`), not a 4-click manual playthrough
- [x] Zero explanation network requests for a spent-meter viewer — verified twice: `CoachPanel.test.tsx`
      asserts the mock is never called when `coachAvailable={false}`, and live in devtools (see
      Piece 2)
- [x] Rush shows no coach panel at all — structural (prop never passed, defaults to off), plus the
      full Rush/Boss/Missions suite (120 tests) passes unmodified
- [x] Play-path bundle size measured against a real build, before/after via a clean `main`
      worktree: `PuzzleCardShell-*.js` 164.04 KB → 181.61 KB raw (52.48 → 57.28 KB gzip, +4.80 KB
      gzip) — the new coach-layer code (CoachPanel + cache + coach/* + the 40-label
      misconceptions.ts data), not a content leak. `content-*.js` and `storage-*.js` grew <0.2 KB
      each. `index.html`'s `<link rel="modulepreload">` count is identical (3) in both builds —
      zero puzzle/explanation chunks eagerly preloaded either way. Grepped both the eager chunks
      and a real `why_wrong` sentence fragment across `dist/assets/`: present only in its own
      per-puzzle chunk, absent from `content-*.js`/`PuzzleCardShell-*.js`/`index-*.js` — F32 held.
- [x] The entitlement predicate is one injectable function (`isEntitledToCoach`), defaulting
      `false`, with no UI code depending on its implementation
- [~] `pnpm validate` green — typecheck, lint (0 errors on the real repo; the only lint failures
  were the same pre-existing `.claude/worktrees/*` noise 6.0's own amendment already
  documented and explicitly declined to clean up unilaterally), `validate:content`,
  `validate:explanations` (99 OK), the production build, and `workers`' own
  typecheck/lint/test (83 passed) are all green. `vitest run` (2823 tests) passed cleanly on a
  full standalone run; two tests in `PuzzleCardShell.test.tsx` flaked once under the full
  `pnpm validate` chain's thread contention (both pass 34/34 in isolation, and the full suite
  re-ran clean immediately after) — the same flake class `src/test/setup.ts`'s own header
  comment documents for this exact area, not a regression from this session's changes.
  Environment note: the full `pnpm validate` chain OOM'd on `eslint` twice in this session
  (default heap limit against a machine with ~5 GB free at the time, likely leftover Chrome/
  dev-server processes from this same session's live-verification step) — worked around with
  `NODE_OPTIONS=--max-old-space-size`, not a code issue.
- [x] Amendment written (this section), listing what 6.2 must swap in (below)

## What 6.2 must swap in

1. **`src/coach/entitlement.ts`'s `isEntitledToCoach()`** — replace the hardcoded `false` with a
   real check against the cached `GET /api/entitlement` result, 7-day fail-open grace window per
   spec F36. No other file in the coach layer changes: `CoachPanel`, `usePracticeSession.ts`,
   `useDailySession.ts` all call this function, none inline a check of their own.
2. **The Piece 3 deviation above** — decide whether the honest-line-only spent-meter treatment is
   final, or build the lightweight label-only index this session explicitly didn't attempt.
3. Everything already out of scope per the build prompt: Stripe, the entitlements table, the
   webhook, the 6.3 diagnostic, scrubber/drag-order explanations, swipe-binary generation — none
   of it was touched or assumed by this session's work.
