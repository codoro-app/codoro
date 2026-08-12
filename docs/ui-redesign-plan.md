# UI/UX redesign plan — Phase 2b

Sits between v3 Phase 2 (Missions, merged) and Phase 3 (Launch-readiness) in `docs/v3-build-plan.md`. **Gated on Phase 2 merging.** Not yet folded into that doc — kept here as its own file, same relationship `docs/todo.md` has to `docs/v2-build-plan.md`, until a session opens 2b.0 and folds it in properly.

**Origin**: `docs/design/click-meaningfulness.md` §2/§4 already named the systemic answer→Continue gap as "a full-UI-redesign question," explicitly out of scope for Missions. This phase is that deferred work, plus a working session with Thomas (2026-08-12) that surfaced the rest of the list below.

**Explicitly not touched here — already correctly resolved, do not re-open without new evidence:**

- Skeleton loaders — scoped correctly in Phase 7 (route-chunk `Suspense` boundary only; every other "loading" state resolves off IndexedDB in single-digit ms, confirmed by the async-boundary sweep in that phase's amendment).
- Optimistic rendering — deferred, in writing, to v3 Phase 4 (first real network round-trip). No server exists in the play loop yet; building it now hides latency that doesn't exist.
- Theme picker — direct user decision, 2026-08-12: **later**, not this phase. The token work below is built theme-ready (CSS custom properties, no hardcoded hex) so a picker is cheap to add afterward, but no picker UI or second/third palette ships in 2b.

---

## Phase 2b.0 — Tailwind migration (1 session, mechanical, zero visual change)

**Why first, isolated**: separates framework-swap risk from design risk. If something looks wrong after this session, it's the migration, not a design call — independently revertible.

**Build:**

1. Install Tailwind v4 + its Vite plugin.
2. Port existing values from `src/index.css` and `docs/design/codoro-v2-arena.html`'s token set (bg tiers, `--text-1`, `--accent`/`--danger`/`--warning`, code-syntax colors, Space Grotesk/JetBrains Mono) into `tailwind.config` as CSS-custom-property-backed theme values — not hardcoded Tailwind palette entries, so 2b.1's theme-readiness work doesn't have to redo this.
3. Convert each feature's CSS file to utility classes, one file at a time, verifying visual parity after each.
4. **Preserve the 5 test-asserted classnames verbatim** (grep-verified this session): `boss-strikes__fill--hit`, `boss-strikes__fill` (not asserted itself but sibling), `mastery-row`, `checkpoint-choice--wrong`, plus whatever else `--hit`/`--wrong`-style modifier classes the same files use. Keep these as literal classnames alongside the new utilities; do not rename.

**DoD:**

- [ ] Before/after screenshot pass on every screen — visually identical, no unintended layout shift.
- [ ] Full test suite green, unmodified except where a file's utility conversion is the only diff (no assertion changes beyond the 5 flagged classnames, and those are kept, not touched).
- [ ] Bundle size delta recorded (Tailwind purges unused, but record it anyway per this repo's own performance-tracking convention from Phase 7).

## Phase 2b.1 — Design tokens + layout shell (1 session)

**Build:**

1. Formalize `docs/design/codoro-v2-arena.html`'s palette as the canonical theme (direct user decision, 2026-08-12: still the intended direction) — dark surfaces, lime accent `#c6f83c`, danger/warning colors, code-syntax token set, Space Grotesk (UI) + JetBrains Mono (code). Every color as a CSS custom property, zero hardcoded hex outside this file — theme-ready for the deferred picker.
2. Define a shared viewport-fit layout primitive: `dvh`-based page shell, primary action (Continue/Start/etc.) anchored/sticky rather than requiring scroll to reach. This is the direct fix for two of Thomas's complaints that are actually one root cause — "scrolling to reach Continue" and "empty space on every page" are both symptoms of no screen currently having an intentional fit-to-viewport layout.
3. Apply the shell to at least one screen end-to-end as proof (candidate: Home, since it's getting redesigned in 2b.5 anyway).

**DoD:**

- [ ] Token file is the single source of truth — grep confirms no hardcoded hex/rgb color values remain in component CSS.
- [ ] Shell primitive in use on ≥1 real screen, no scroll needed to reach the primary action on a standard mobile viewport.

## Phase 2b.2 — Systemic click-meaningfulness + Boss game-feel (1–2 sessions)

**Build:**

1. Fix the answer→Continue gating-tap gap app-wide (Practice/Daily/Rush/Trace/Boss) — `PuzzleCardShell`'s and `TraceRunner`'s Continue button previews the destination before the tap, matching the pattern Missions' own `MissionCheckpoint` already proved out.
2. **Trace arrow mis-click fix**: reserve space for (or detach the nav control from) the growing checkpoint stack so the arrow doesn't shift position under an in-flight tap. Treat as an interaction-correctness fix, not a cosmetic one — same rigor as the OD-1/OD-5 gesture defects.
3. **Boss game-feel pass** — code-verified gaps this session (`BossActivePlay.tsx`, `bossPage.css`): the existing hit-reaction (`boss-strikes-hit`, 250ms/3px shake) only fires on wrong answers and reads as a flinch, not an impact; there is no feedback at all on correct answers; the progress readout is plain text (`Puzzle {position} of {totalPuzzles}`); there is no boss "presence" (name/avatar/portrait) anywhere. Build:
   - Escalate the wrong-answer hit reaction (bigger motion and/or a color flash, not just translateX).
   - Add a new correct-answer beat — the player should feel like they're landing hits too, not just taking them.
   - Replace the plain puzzle counter with a themed progress element (segmented/pip-style, or "hits landed" framing).
   - **Open design question, settle in the build prompt**: does Boss get an actual character (name + simple icon/portrait that visibly reacts — no commissioned art required) or stay abstract with a punchier feedback loop only? Bigger scope either way is the character path (needs a visual per boss/theme); default to abstract-but-punchier unless Thomas says otherwise when this session opens.

**DoD:**

- [ ] Every mode's Continue action previews what's next before the tap.
- [ ] Trace's checkpoint arrow never moves under an already-in-flight tap.
- [ ] Boss shows a distinct, escalated reaction on wrong answers and a new, visible reaction on correct answers.
- [ ] Existing test suite green; Boss's `role="status"`/`aria-label` strikes announcement preserved.

## Phase 2b.3 — Missions staging + clarity pass (1 session)

**Build:**

1. Persistent stage tracker (🧠 Trace → ⚡ Speed → 🏆 Boss → payoff) visible throughout a mission run, not just at checkpoints — `MissionCheckpoint` today only lists _completed_ stages, and only when resuming mid-arc. Desktop: rail placement to the right (direct user request). **Open design question, settle in the build prompt**: mobile treatment — top stepper bar, bottom pip row, or a collapsible dots indicator. Thomas hasn't picked one yet; default to a top stepper bar (cheapest, most conventional) unless he specifies otherwise when this session opens.
2. Expand `MissionCheckpoint`'s copy — today it's icon + label + duration only; Thomas's read is "not super clear." Add explicit framing of what's about to happen at each stage, not just its name.

**DoD:**

- [ ] Current stage position is visible at all times during a run, not only at transition screens.
- [ ] A first-time player can state what's about to happen next without guessing, per a quick Thomas walkthrough.

## Phase 2b.4 — Sharing consolidation (1 session)

**Build:** one `ShareMenu` component (Web Share API on mobile → native share sheet; clipboard-copy fallback on desktop) replacing today's oversized challenge-link UI and the share-text block repeated under every mode. Exposes two actions: share puzzle, share challenge.

**DoD:**

- [ ] Verified on ≥1 real mobile browser (real share sheet opens) and desktop (clipboard fallback works).
- [ ] Old inline share-text markup removed everywhere it was duplicated.

## Phase 2b.5 — Home redesign (1 session)

**Build:** apply 2b.1's shell + tokens to Home. Address "empty space" via information density (recent activity, a mission entry point, stats teaser) rather than purely decorative filler — ties into 2b.7 if the stats page lands first.

## Phase 2b.6 — Drag handle affordance (small; fold into 2b.2 or run standalone)

**Build:** hit target stays at 44px (already at Apple HIG minimum — confirmed functionally sound via the OD-5 investigation, closed "works as designed"). Fix the _visual_ affordance instead: the rendered grip icon should visually read as large as the actual tappable zone, so the size complaint is a perception fix, not a hitbox inflation.

## Phase 2b.7 — Mastery/stats page (not sized — scope decision needed first)

Fully buildable off existing local IndexedDB history, not blocked on the Phase 4 backend. **Blocking question before this gets a session**: permanent nav slot (core-loop surface) or a secondary view nested under Settings? Starter directions once scope is picked: per-pattern accuracy heatmap, rating/streak history graph, a "weakest pattern" callout.

## Phase 2b.8 — QA pass (1 session)

Batched screenshot review across all touched screens + a Lighthouse re-check (Phase 3 already gates on Lighthouse 90+, and a redesign is exactly the kind of change that regresses it).

---

## Open design questions to settle in build prompts, not here

- Boss: character (name + reactive portrait) vs. abstract-but-punchier feedback only (2b.2).
- Mission staging rail's mobile treatment: top stepper vs. bottom pips vs. collapsible dots (2b.3).
- Mastery/stats page: nav-level surface vs. Settings-nested (2b.7) — blocks sizing that phase at all.
