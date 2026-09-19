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
