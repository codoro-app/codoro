# Prompt for Claude Code — Bugfix: right-panel state doesn't update after attempts

Paste this into Claude Code in the codoro repo. `git fetch && git status` first, confirm `main` includes the Phase 6.5 shell merge. Small scoped fix — not a phase.

---

## The bug (reproduced on the deployed preview, desktop ≥1024px)

Answering a puzzle does **not** update the right panel: after a rated attempt, "Mastery by pattern" still shows 0 attempts on every pattern and the session counter still reads "0 solved this session." Reproduced on a plain Practice attempt, so it's not specific to the browse-by-pattern flow — the panel isn't re-reading after _any_ attempt. Thomas first noticed it via Browse patterns → practice → panel unchanged; verify that path too once the general fix is in.

Likely shape: the right panel reads mastery/session data once on mount (or from a stale snapshot) while the play column commits attempts through `usePracticeSession` — no shared reactive source between them. Find where the shell's right panel sources its data and make it subscribe to the same state the session hook writes, or lift the session state so both render from it. Don't introduce a state library — ask first if you think you need one (expected answer: no; React context or lifting state covers two siblings).

**Guard:** the fix is UI wiring only. No changes to `src/engine/` or `src/storage/` semantics — attempts are being _recorded_ correctly (rating moves on answer; storage is fine), only the panel's view of them is stale.

## Also in scope (small, related)

Make the mastery panel rows interactive: tapping a pattern row starts practicing that pattern — same behavior as picking it in the browse-patterns view, which already exists; reuse that path. Keyboard-focusable, ≥44px target. Visual design of the row is being redesigned separately in the Claude Design pass — don't restyle, just wire the behavior with the current look.

## Definition of done

- [ ] Answer a puzzle in Practice → mastery panel attempt count and "solved this session" update immediately, no refresh
- [ ] Same via Browse patterns → pick pattern → answer
- [ ] Component test: render shell, simulate an answered attempt, assert the panel reflects it (this is the regression test for the actual bug — a test that only checks the hook's return value doesn't count)
- [ ] Clicking a mastery row enters practice filtered to that pattern
- [ ] `pnpm validate` green; no new dependencies

## Orchestration

Branch `fix/mastery-panel-sync`, PR into `main`. Smallest diff that fixes it — if the fix balloons past ~a few files, stop and describe what you found instead of restructuring state management unilaterally. No AI attribution in commits.

When done: root cause in one paragraph, files touched, and confirmation the regression test fails on `main` and passes on the branch.
