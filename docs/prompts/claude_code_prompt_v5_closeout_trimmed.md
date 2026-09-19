# Claude Code prompt: v5 trimmed close-out (session 1 of the v6 pivot)

## Read first, in order

1. `docs/v5-closeout-decision.md` — **the scope of this session.** It supersedes the older
   `docs/prompts/claude_code_prompt_v5_phase5.4_5.6.md`, which is now a historical record. Where
   the two disagree, the decision doc wins.
2. `docs/prompts/claude_code_prompt_v5_phase5.4_5.6.md` — still the best _detailed_ writeup of
   T11, T13 and T15. Use it for the how; use the decision doc for the what.
3. `docs/roadmap.md` — numbering changed again on 2026-09-19 (third time). v6 is now monetization,
   gamification/launch is v7, multiplayer is v8.
4. The merge rule at the top of
   `docs/superpowers/plans/2026-09-12-v5-phase-5.2-sync-implementation-plan.md`: a PR merges when
   CI is green, a fresh-context review has run, and either its manual click-through has run or the
   change is unreachable by users. Same rule here.

## Scope — three things, in this order

### Piece 1 — T15, the legal delta (do this first; it is the urgent one)

`src/app/legal/LegalPage.tsx` currently contains two statements that have been **false in
production since 2026-09-12**: _"Codoro has no accounts, and the app itself collects no personal
information"_ and _"Nothing is uploaded to a server."_

Rewrite the Privacy section per the T15 section of the 5.4/5.6 prompt — accurate about optional
accounts, Clerk's email collection, D1 sync of rating/streak/history, and what account deletion
actually does. Keep the existing plain developer voice and the "good-faith, not lawyer-reviewed"
framing. **Add nothing about leaderboards or marketing email** — neither is live and describing an
unbuilt feature is the same class of error as the current stale claims, just inverted. Bump the
Last updated date.

Then read the finished page back sentence by sentence and check each one against what is actually
shipped today. That read-back is the deliverable, not the diff.

### Piece 2 — T13, authz and security sweep

Full scope as written in the 5.4/5.6 prompt: table-driven authz matrix (every authenticated route
× {no token, bad token, another user's resource}) in one file so an unregistered route is
conspicuous; `pnpm audit` plus an actual read of Clerk/Hono transitive deps; secrets grep; the I4
PII grep; CSP pass extended narrowly for Clerk origins with no wildcard host.

**Deletion round-trip.** Thomas reported on 2026-09-19 that this was already run, but the evidence
was never recorded in the plan docs. Re-run it and paste the real output — D1 query showing
`users`/`profiles` gone via cascade, Clerk Admin API showing the user gone, and a second `DELETE`
returning 204 rather than 500. An undocumented verification is an unperformed one for close-out
purposes.

### Piece 3 — T11, per-puzzle OG

`/challenge` unfurls already shipped in PR #110. Only `/puzzle/:id` is left. Pages Functions
middleware using `HTMLRewriter` to rewrite `<title>`/`og:*`/`description` into the SPA shell,
sourced from the **existing** puzzle-metadata index from PR #82 — locate that module, do not
re-derive metadata. Per-puzzle OG images stay deferred; one static branded card, dynamic text only.
Verify with real debuggers (Slack/Discord/X) against dev and record screenshots.

## Explicitly out of scope — do not build, do not "while I'm here"

- **T14 load test / cost curve.** Deferred. Reopen trigger is in the decision doc.
- **5.3 usernames / public profile.** Deferred. `claude_code_prompt_v5_t9_usernames.md` stays on
  disk unmodified — do not delete it, do not start it.
- **5.5 email.** Deferred. Do not add Resend, a cron trigger, or an email preference anywhere.
- Anything in v6. That is the next session.

## Piece 4 — docs housekeeping (small, but do it)

Two stale items carried from the 5.0 review that were never fixed:

1. `docs/v5-build-plan.md` section C1 still says CodeRabbit Free is active review coverage.
   CodeRabbit was cut entirely (no free tier for private repos). Correct it.
2. The top-level "Phase 5.0 is done when" checklist in
   `docs/superpowers/plans/2026-08-31-v5-phase-5.0-coding-plan.md` was never checked off even
   though each task's amendment demonstrates its line is met. Check it off.

Also note in `docs/v5-build-plan.md`, near the 5.3/5.5 sections, that both are deferred per
`docs/v5-closeout-decision.md`. Do not delete those sections.

## DoD

- [ ] `LegalPage.tsx` contains no false statement about what the app does — verified by a
      sentence-by-sentence read-back, and say in the amendment that you did it
- [ ] Authz matrix green, zero unregistered routes
- [ ] Deletion round-trip re-run with real query output pasted into the amendment
- [ ] Second `DELETE` returns 204, not 500
- [ ] CSP diff reviewed line by line, no wildcard host
- [ ] `/puzzle/:id` unfurls verified with real debuggers, screenshots recorded
- [ ] C1 CodeRabbit text corrected; 5.0 checklist checked off; 5.3/5.5 marked deferred
- [ ] `pnpm validate` green
- [ ] Closing amendment written, stating plainly that v5 is closed at 5.4 + 5.6-lite and that the
      lawyer review remains outstanding and is Thomas's own action item

## Note on the working tree

The repo is currently on `fix/motion-duration-utilities`. Start from a fresh branch off `main`,
not from that one. Known device-VM limitations still apply: `git checkout`/`restore` can silently
fail to rewrite working-tree files, stale `.git/*.lock` files accumulate and need moving aside,
and pnpm's symlinked `node_modules` means prettier/eslint/vitest may not run locally — commit with
`--no-verify` and let CI be the gate.
