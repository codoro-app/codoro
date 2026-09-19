# v5 close-out — trimmed scope and deferral record

**Decision date: 2026-09-19. Direct user decision.** This document supersedes the scope in
`docs/prompts/claude_code_prompt_v5_phase5.4_5.6.md` and the Phase 5.3/5.5/5.6 sections of
`docs/v5-build-plan.md`. Those documents stay in place as the historical record; this one is
what is true.

## The constraint that drives it

Thomas is giving Codoro **six months (to roughly March 2027)**. If it has made no money by then,
the project stops. That is now the governing constraint on every sequencing decision, and it
changes what "finishing v5" is worth.

Current position, honestly stated: accounts and sync are live and working on getcodoro.com,
~40 people have ever looked at the app, and there are zero challenge-link completions per week.
The bottleneck is not v5's remaining phases.

## v5 is declared closed at 5.4 + 5.6-lite

v5 does not run to the end of its original phase list. It closes when the three items below are
done. This is a decision, not an abandonment — every deferred item has a written reopen trigger
in the table further down, and the deferral is reversible the moment its trigger fires.

### Ships — T15, legal delta (urgent, independent of everything else)

`src/app/legal/LegalPage.tsx` currently states, verbatim, _"Codoro has no accounts, and the app
itself collects no personal information"_ and _"Nothing is uploaded to a server."_ Both have been
false in production since Phase 5.1 shipped on 2026-09-12: accounts collect a real email address
through Clerk, and a signed-in player's rating, streak and history sync to D1.

This is live and inaccurate right now. It is not a roadmap item and it is not gated on the
relaunch timeline. It also becomes a harder problem the moment money is involved — a payment
cannot be taken behind a privacy statement that denies the data collection it depends on.

Scope is exactly as written in the 5.4/5.6 prompt's T15 section: rewrite the Privacy section to
cover only what is actually live (optional accounts, Clerk email, D1 sync, what deletion does),
keep the existing plain developer-written voice and the "good-faith, not lawyer-reviewed"
framing, add nothing about leaderboards or marketing email, bump the Last updated date.

### Ships — T13, authz and security sweep

The 5.4/5.6 prompt's own words: "the one that matters most before you invite strangers in."
Strangers are about to be invited in _and_ charged. Full scope as written: table-driven authz
matrix, dependency audit, secrets grep, I4 PII grep, CSP pass for Clerk origins, and the
deletion round-trip with real query output pasted into the amendment.

Note: the deletion round-trip, the authenticated burst test and the lawyer engagement were
reported done on 2026-09-19 but the evidence was never recorded in the plan docs. Recording it
is part of this task. An undocumented verification is, for close-out purposes, an unperformed one.

### Ships — T11, per-puzzle OG, reframed

`/puzzle/:id` unfurl support is the only part of 5.4 left. It stays in scope, but **not as a
close-out checkbox — as distribution work.** Every puzzle link shared anywhere becomes a rich
card instead of a bare URL, which is pointed directly at the actual bottleneck. Per-puzzle OG
_images_ stay deferred; dynamic title and description only, one static branded card. That was
already decided and is not reopened here.

## Deferred, with reopen triggers

| Item                                 | Why deferred                                                                                                                                                                                                                                                                                                                                                                            | Reopen trigger                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **T14 — load test / cost curve**     | 40 visitors against a free tier that serves 100k requests/day. Burst-testing a rate limiter with four orders of magnitude of headroom measures a problem that does not exist. Downside of skipping is near zero: Cloudflare 429s rather than bills.                                                                                                                                     | Any single day above 5,000 requests, **or** before the first post that could plausibly drive four-figure traffic.      |
| **5.3 — usernames + public profile** | Usernames exist to serve leaderboards, and leaderboards were explicitly not selected (2026-09-19). Building the identity layer for a social feature that is not being built, for 40 users. `docs/prompts/claude_code_prompt_v5_t9_usernames.md` is good work and stays on disk unmodified, ready to run.                                                                                | ≥500 registered users, **or** the decision to build leaderboards, **or** v8 async duels starting — whichever is first. |
| **5.5 — email re-engagement**        | Re-engagement email multiplies an existing return rate. The return rate is unmeasured and the list is ~40 people who mostly played once. Multiplying an unmeasured number near zero returns zero. The active harm: firing a streak-at-risk nudge at someone who played once six weeks ago is how a fresh sending domain collects spam complaints before it has a list worth protecting. | ≥500 registered users **and** a measured day-7 return rate above 10%. Both, not either.                                |

The T9/5.3 prompt and the 5.5 build-plan section are **not deleted**. They are correct work
aimed at a future state. When a trigger fires, they are picked up as written.

## What this does not change

- Guest-first stays law. Nothing in the paid tier makes an account required to play.
- The lawyer review carried from v3 Phase 3 is still outstanding and is still Thomas's own
  calendar item, not a session's. T15 produces the delta list to hand over; it does not simulate
  the review.
- `scores` table pruning was specced to ride on the Workers Cron trigger that 5.5 introduces.
  With 5.5 deferred, **that table now simply grows with no pruner**. At current volume this is
  irrelevant for years, but it is a real loose end created by this deferral and is recorded here
  so it is not rediscovered as a surprise. Reopens with 5.5, or sooner if `scores` passes 100k rows.

## Successor

v6 is no longer gamification-and-launch. See `docs/v6-build-plan.md` (Coach and monetization)
and the resequence banner in `docs/roadmap.md`. Gamification/launch moved to v7, multiplayer to v8.
