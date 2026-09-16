# Claude Code prompt: record the 2026-09-15 relaunch resequencing

## What this is

A docs-only session. Record a set of direct-user decisions from a 2026-09-15 planning conversation, in the same convention every prior resequencing/go-decision has used in this repo (see `docs/superpowers/plans/2026-09-08-*` and the amendment sections at the bottom of `docs/v5-build-plan.md` for the exact style: dated, states the decision, states why, cross-references the affected docs). Don't build anything in this session — the build prompts are separate (`docs/prompts/claude_code_prompt_v5_phase5.4_5.6.md`, `docs/prompts/claude_code_prompt_multiplayer_computer.md`).

## Decisions to record (Thomas, 2026-09-15)

1. **Phase 5.3 (usernames + leaderboards, T9/T10) and Phase 5.5 (email re-engagement, T12) are paused, not cancelled.** Reason: both need a real userbase to pay off — a leaderboard with no other players, or an email digest with no engagement history, is worse than not having it. Traffic reality as of this date: ~40 lifetime visitors, near-zero challenge completions per week. Revisit once relaunch traffic gives real numbers to build against, not on a fixed date.

2. **Phase 5.4 (finish per-puzzle OG unfurls) and Phase 5.6 (authz sweep, right-sized load test, legal delta) are pulled ahead of 5.3/5.5**, scoped down from their original spec — see `docs/prompts/claude_code_prompt_v5_phase5.4_5.6.md` for the exact right-sizing (leaderboard-related load-test/legal items dropped since 5.3 is paused; 5.6's load test scaled to a realistic relaunch bump, not a full 1×/10×/100× DAU model). Reason: both are prerequisites for actively promoting the app to strangers — OG unfurls matter the moment a link gets shared publicly, and an authz sweep + accurate privacy disclosure matter more once real strangers (not ~40 known-ish visitors) start creating real accounts with real email addresses.

3. **A live discrepancy found this session, not something newly introduced:** `src/app/legal/LegalPage.tsx`, last updated 2026-08-31, states "Codoro has no accounts, and the app itself collects no personal information" and "Nothing is uploaded to a server" — both false since Phase 5.1 shipped accounts on 2026-09-12. This is the specific, concrete reason 5.6's legal item jumped the queue ahead of 5.3/5.5 rather than waiting for a full version close-out. Record this as the finding that triggered the resequencing, not just "legal is due eventually."

4. **A new feature, not on the original v1–v7 version-numbered roadmap: a "Play Computer" / "Play Human" multiplayer entry point**, scoped and prompted this session (`docs/prompts/claude_code_prompt_multiplayer_computer.md`). Record explicitly:
   - It is **not** v7 (real async/live multiplayer) — v7's actual scope (per `docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md`'s multiplayer sequencing notes, if present, or the codoro-multiplayer-sequencing context this conversation drew on) is making `/challenge` server-authoritative and rated, which depends on v5's Worker API and hasn't started. This new feature is unrated, storage-free, purely client-side, and depends on nothing from v5/v6/v7 — it's a new front door onto the ghost-race mechanism that shipped in PR #112, not new competitive infrastructure.
   - It reuses `ChallengePayload`/`ChallengeComparison`/`GhostBar`/`useGhostRace` wholesale — a synthetic opponent is just a `ChallengePayload` generated in memory instead of decoded from a URL.
   - Locked scope decisions: levels are live Elo-band draws (no curated per-level content authoring); 5 puzzles per run (matches `MAX_CHALLENGE_PUZZLES`); purely additive to existing nav (today's post-puzzle share/challenge CTAs are unchanged).
   - Where it lives in the roadmap: note it in `docs/roadmap.md` (or wherever the version table lives) as a small, dependency-free addition that ran in parallel with the 5.4/5.6 relaunch prep — cross-reference its prompt file, don't duplicate the spec into the roadmap doc itself.

5. **Sequencing for the relaunch, in order:** Phase 5.4 finish → Phase 5.6 (right-sized) → the Computer/Human multiplayer feature → relaunch (a public/social push). 5.3 and 5.5 pick back up only once relaunch traffic data justifies them.

## Where to write this

Follow this repo's existing convention rather than inventing a new one:

- A new dated file under `docs/superpowers/plans/` (e.g. `2026-09-15-v5-relaunch-resequencing.md`), styled like `2026-09-08-v5-go-decision`-type entries — decision, reasoning, cross-references, nothing left implicit.
- An amendment note in `docs/v5-build-plan.md`'s Phase 5.3 and 5.5 sections marking them **paused** (not deleting their content — the plan they describe still stands, just not being built right now) with a one-line pointer to the new dated file for the full reasoning.
- Whatever `docs/roadmap.md` (the numbering source of truth per `docs/v5-build-plan.md`'s own references) needs to gain a line for the new multiplayer feature, per point 4 above.
- If `docs/todo.md` is where Thomas tracks near-term work day to day (it's noted elsewhere as a local, gitignored scratchpad — check whether it exists and is still in use before touching it), add the relaunch sequence there too; skip this if the file's already stale/unused.

## DoD

- [ ] A reader who opens `docs/v5-build-plan.md` cold sees, at Phase 5.3 and 5.5, that they're paused and why, without needing this conversation's context
- [ ] The new dated plan file stands alone — captures the decision, the reasoning, the legal-page finding, and the relaunch sequence, cross-referencing both build prompts by their actual file paths
- [ ] `docs/roadmap.md` (or the actual numbering source of truth, if the name has changed) has a line for the multiplayer feature that doesn't misrepresent it as v7
- [ ] No prose is deleted from 5.3/5.5's original scope — paused means paused, not rewritten away
