# Prompt for Claude Code — v2 Phase 7b (Mobile/PWA hardening)

Paste this into Claude Code in the codoro repo, **in plan mode**. `git fetch && git status` first.

The authoritative spec is `docs/v2-build-plan.md`, **"Phase 7b — Mobile/PWA hardening"**, plus the "Known open defects" table at the top of that doc (OD-1 and OD-5 rows and their full write-ups further down) and the standing rules at the top of `docs/prompts/claude_code_prompt_v2_phase5.md` (module boundaries, smallest-diff discipline, revert-check reviews, no new dependencies without a written reason). Read all of it before proposing a plan. Nothing in it is relitigated here.

**Precondition:** Phase 7 must be merged to `main` before you branch. Work on `v2-phase-7b` off the updated `origin/main`.

---

## Why plan mode, specifically

Two of this phase's three items (OD-1, OD-5) are governed by a standing rule this repo has already paid for twice: **no fix without a root cause read out of source, and no retuning a threshold without a written mechanism for why the current value is wrong.** Phase 0 guessed at the swipe bug twice, shipped two real fixes, and a third defect survived both anyway. That is exactly the failure mode plan mode exists to prevent: don't let a plan turn into a diff before the diagnosis is actually done.

So your plan is not "here's the fix" — it's "here's what's confirmed, here's what's still missing, here's the fix for each candidate hypothesis conditional on which one the missing evidence points to." If the plan you'd otherwise write is "try hypothesis 1, see if it works," that's not a plan, that's a guess with extra steps — say so and ask for the missing repro data instead of proposing it.

---

## Item 1 — Mobile Lighthouse performance, 84 → 90+

This one doesn't have the same diagnostic gate — it's build-only and independently verifiable. Desktop already clears (98/96/100/100); mobile is 84/95/100/100 under slow-4G/Moto-G-Power emulation (PageSpeed Insights, real production run, 2026-08-09). Accessibility and SEO both clear on both form factors — scope is performance only.

Flagged opportunities, in order of confirmed size:

1. **~9 KiB of legacy JS/polyfills.** Check `vite.config.ts`'s build target / browserslist against what the actual supported device matrix (recent iOS Safari, recent Android Chrome) needs — this repo has no IE/legacy-Android requirement, so a conservative target is likely buying nothing.
2. **~170ms of render-blocking requests.** Likely the same critical-CSS/preloaded-fonts path Phase 7's `_headers` work already touched — re-measure against the real Lighthouse report this time (Phase 7's own amendment already flagged that its `_headers` guess wasn't confirmed against a real report).
3. **~5 KiB, inefficient cache-lifetime policy** on some static assets not covered by the existing `/assets/*` or `/fonts/*` immutable rules. Smallest win, do last.

Plan should name the specific files/config each change touches, and how each will be re-verified (real Lighthouse run against production after deploy, not local `pnpm build` — Phase 7's amendment already learned that a local build confirms structure, not the actual flagged-resource fix).

---

## Item 2 — OD-1: swipe gesture unreliable on phone

Full history is in the build plan's OD-1 section — two root causes already found and fixed in Phase 0 (32ms kinematics staleness, zero touch `axisThreshold`), a third defect survived both, confirmed on a real device against a build carrying both fixes. **Do not re-attempt either of those two fixes or retune `DEFAULT_SWIPE_THRESHOLD`** — both are closed questions with mechanisms already on record.

**What must be captured before you propose a fix** (from the build plan's OD-1 write-up — none of this is known yet):

- Device, OS version, browser, and whether it was the installed PWA or a browser tab
- Which failure it is, precisely: swipe does nothing (no commit), commits the wrong direction, commits when it shouldn't, fights vertical scroll, or animates and snaps back
- Whether it reproduces on a fresh page load vs. only after several puzzles
- Whether the tap fallback buttons still work when the gesture fails

**None of this is capturable by reading source or running the test suite.** If it isn't already in the conversation by the time you plan this item, your plan's output for OD-1 is the repro checklist above, handed back for Thomas to run on the real device that originally reproduced it — not a guessed fix. The build plan's own candidate hypotheses (touch-action vs. iOS Safari, axis-threshold now too generous, framer-motion spring fighting the drag transform) are listed there so you don't re-derive them, not as a shortlist to try blind.

---

## Item 3 — OD-5: drag-order touch drag never starts

New defect, found 2026-08-09. Full write-up is in the build plan's OD-5 section. Confirmed: iPhone Safari, reproduces identically in both a browser tab and the installed PWA (rules out anything standalone-display-mode-specific). Symptom: touching and moving the drag handle does nothing — no visual feedback, no drag, block stays put.

A source read of `DragOrder.tsx` and `practice.css` already happened as part of writing that defect row — the obvious candidates check out clean on paper: `pointerDownIsOnHandle` correctly gates touch to the handle, the handle's `touch-action: none` is static (never toggled at runtime, per the component's own doc comment on why that matters), and `--tap-target-min` resolves to a real 44px, not a dangling reference. **Do not re-read the component looking for a logic bug as your first move — that pass already happened and came back clean.**

What's still missing, per the build plan's OD-5 checklist:

- iOS version and Safari version
- Whether **any** pointer event fires at all — does `pointerdown` register (a temporary console flag, or remote Safari Web Inspector over USB if available)
- Whether the row still highlights (`selected` state — a plain tap/focus effect independent of drag) when the handle is touched. This is the single most useful diagnostic available: it isolates "pointerdown never reaches JS" from "pointerdown fires but the drag gesture itself never engages."
- Whether the keyboard fallback (focus a row, arrow up/down) works on the same device
- Whether this reproduces on Android Chrome too, or is iOS/WebKit-specific like OD-1's confirmed device

The leading hypothesis worth investigating first (not fixing blind, _investigating_): WebKit's handling of a `touch-action: none` child nested inside a `touch-action: pan-y` parent has had inconsistent enforcement across versions — if the parent's `pan-y` wins the hit-test before the child's `none` is considered, every touch on the handle reads from the outside exactly like this bug. That's a real, checkable thing (does the `selected` highlight fire on touch, per the bullet above) before it's a fix.

---

## Ask questions.

**Stop and ask rather than proceeding on your own authority if:**

- OD-1's or OD-5's repro checklist isn't fully answered by the time you'd otherwise start writing a fix. Hand back the specific missing items, not a best-guess fix.
- The mobile-Lighthouse legacy-JS reduction would drop support for a browser this app is actually expected to run on (recent iOS Safari / recent Android Chrome are the only two that matter here — check the OD-1/OD-5 repro devices' OS versions against whatever target you're about to narrow to).
- Any candidate fix for OD-1 or OD-5 would touch `SwipeBinary.tsx`'s or `DragOrder.tsx`'s two-layer hit-target model in a way not already named as a candidate hypothesis in the build plan — that's a bigger change than either defect's row currently scopes, and needs a written reason.

---

## Explicitly out of scope

OD-4 (containment leak) — owned by Phase 8, requires a full-pool sweep first per its own row. Any content generation or authoring. Phase 6b/6c. Any backend, any dependency addition. Any redesign of the swipe or drag interaction — both defect rows are explicit that a retune/fix needs a stated mechanism, not a rebuild.

---

## Definition of done

Build-plan Phase 7b's DoD in full:

- [ ] Lighthouse performance ≥90 on production, mobile, re-verified after the fix (not estimated from the opportunity list)
- [ ] OD-1 closed by a commit with a stated root cause, or converted to a written waiver
- [ ] OD-5 closed by a commit with a stated root cause, or converted to a written waiver
- [ ] Both fixes verified on the real device(s) that reproduced the bug — iPhone Safari at minimum (both a browser tab and the installed PWA, since OD-5 reproduces in both), Android Chrome if OD-1's original repro device was Android
- [ ] "Known open defects" table updated: OD-1 and OD-5 rows either closed (mirroring OD-2/OD-3's "Closed, Phase N" pattern) or carry an explicit waiver
- [ ] `pnpm validate` green; zero new dependencies; one PR: `v2-phase-7b` → `main`
