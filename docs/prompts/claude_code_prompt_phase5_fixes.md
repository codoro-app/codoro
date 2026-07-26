# Prompt for Claude Code — Phase 5 close-out (git repair + iOS layout/swipe bugs + update-flow test)

Paste this into Claude Code in the codoro repo.

---

## Step 0 — repair local git state first (blocking — do this before touching any code)

The local checkout may currently be sitting on branch `phase-5-pwa` (already merged into `main` as `f467b07`, PR #9) with a corrupted `.git/config` (truncated, null-byte padded) and stale `.git/ORIG_HEAD.lock` / `.git/index.lock` files left over from an interrupted pull done from outside this machine. Run `git status` first — if it errors with something like "bad config line" or a lock-file complaint, fix it before doing anything else:

1. `Copy-Item .git\config .git\config.corrupted.bak` (or `cp` — back it up, don't just delete it)
2. Rewrite `.git/config` clean. It should end up equivalent to:
   ```
   [core]
   	repositoryformatversion = 0
   	fileMode = false
   	bare = false
   	logallrefupdates = true
   	hooksPath = .husky/_
   [user]
   	name = Thomas
   	email = codoroapp@gmail.com
   [remote "origin"]
   	url = https://github.com/codoro-app/codoro.git
   	fetch = +refs/heads/*:refs/remotes/origin/*
   [branch "main"]
   	remote = origin
   	merge = refs/heads/main
   ```
   (drop the trailing NUL padding — that's the actual corruption; everything above the padding was valid)
3. Remove `.git/ORIG_HEAD.lock` and `.git/index.lock`.
4. `git checkout main && git pull --ff-only` — confirm `main` lands on `f467b07` or later and that `src/app/pwa/` exists on disk.
5. Delete the now-merged local branch `phase-5-pwa`.

Don't proceed past this point until `git status` is clean.

## Repo hygiene, still outstanding from last time

`.claude/worktrees/` still has directories for `phase-2-storage-layer`, `phase-3-content-pipeline`, `phase-4-practice-ui`, and `phase4-bugfixes` — all merged, all safe to `git worktree remove`. Delete the merged local branches too (`phase-1-rating-engine` through `phase4-bugfixes`, plus `phase-5-pwa` from step 0) and the merged remote branches `chore/match-node-pin` / `chore/remove-chesscom-mention`. Add `.claude/` to `.gitignore` if it's still missing.

## Context

Phase 5 shipped and mostly works: I installed it on my iPhone, it launches standalone, and it works fully in airplane mode. Two things looked off in that same real-device test, and the update-flow and week-long survival DoD items are still open. Fix the two issues below, execute the update-flow test yourself, and leave the survival check to me (it needs a week of real time — nothing to do there but wait).

## Issue 1 — layout/sizing looks off on iPhone, installed standalone (spacing/margins/alignment off, code snippet cramped/overflowing in places, some buttons/tap targets misaligned)

I don't have the device in front of me to inspect live, but I read the Phase 5 diff and have a specific, testable hypothesis — verify it against the actual symptom before you fix anything, don't just apply this blind:

- `index.html` sets `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`, which makes iOS draw the status bar transparently _over_ the page instead of pushing content down below it.
- The viewport meta tag is still just `width=device-width, initial-scale=1.0` — it was never updated to include `viewport-fit=cover`. Without that, `env(safe-area-inset-*)` resolves to `0px` everywhere, regardless of device.
- `src/app/pwa/pwa.css` already uses `env(safe-area-inset-bottom)` for the update-prompt/iOS-install-sheet overlays — which, per the point above, is likely a no-op right now and those overlays may be sitting flush against the home-indicator area instead of padded above it.
- Nothing in `src/index.css`, `src/app/practice/practice.css`, or `practicePage.css` references `safe-area-inset-top` at all — so the main app content (status bar row, top of the puzzle card) likely renders directly under the iOS status bar/notch in standalone mode, which is a plausible explanation for "buttons/tap targets misaligned" specifically.

If this checks out: add `viewport-fit=cover` to the viewport meta tag, add `env(safe-area-inset-top)` padding to whatever wraps the app's top-level layout, and confirm the existing `safe-area-inset-bottom` usage in `pwa.css` actually engages once `viewport-fit=cover` is present. Re-test on the real device after — don't mark this done from a simulator, standalone-mode safe-area behavior doesn't reliably reproduce there.

## Issue 2 — swipe-binary drag/tilt/fly-off animation feels janky/laggy/glitchy on iPhone

This one isn't functionally broken (it commits correctly) — it just doesn't feel smooth. Less clear-cut than issue 1, so investigate rather than assume:

- Check whether Issue 1's layout instability (content shifting under the status bar) is contributing to the perceived jank during a drag.
- Check that `SwipeBinary.tsx`'s drag transforms stay on compositor-only properties (`transform`/`x`/`rotate` via framer-motion's `useMotionValue`, no layout-triggering property changing mid-drag) — a simulator or a lower-power test device can hide reflow costs that show up as real jank on an actual phone.
- If you can't get conclusive evidence without a live Safari Web Inspector session over USB from a Mac (I don't have one to hand you tonight), say so rather than guessing at a fix and calling it done.

## Update-flow test — execute it, don't just describe it

I don't have push access to the GitHub org from where I'm working right now, so this one's on you end-to-end: make a small, clearly-labeled, purely cosmetic change (a version marker or a copy tweak — your call), commit it, push to `main`, confirm the deploy goes out. Tell me the moment it's live so I can reopen the installed app on my phone and confirm the "Update available" prompt appears and refresh actually pulls the new version — that last step still needs my hands, I can't delegate it further.

## Ground rules

- Branch this as `phase5-fixes` (same naming convention as `phase4-bugfixes`), PR into `main` when green.
- Loop per item: reproduce/verify the hypothesis, fix, verify (tests + real device where you actually have one), commit, move to the next. No batching everything into one commit.
- No Claude/Anthropic/AI attribution anywhere in commit messages — write them as if I authored them normally.
- Delegate the mechanical stuff (icon/asset tweaks if any come up, the cosmetic update-flow change) to a cheaper/faster model via subagent. Keep the safe-area diagnosis and the gesture-performance investigation on your strongest reasoning — that's where a wrong guess costs a full re-test cycle on a real device I have to hand you results from.

When done, give me a summary: whether the safe-area hypothesis was actually the cause of issue 1 (or what else it was), what you found (or didn't) on issue 2, confirmation the update-flow change is live, and exactly what's still open for me to verify on-device.
