# Prompt for Claude Code — Phase 6.5 (Responsive shell + design-token overhaul)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first, confirm `main` is at the Phase 6 merge or later, same as always.

This phase was inserted between 6 and 7 deliberately: Rush (Phase 7) reuses the puzzle-card flow, so layout/structure has to be fixed _before_ a third mode multiplies the rework surface.

---

## Known issue — do not work on this, just watch for it

Same standing hazard as Phase 6: the "Update available" prompt (`src/app/pwa/`) has survived five fix attempts and is still unreliable. **Don't touch it.** If restyling forces you to edit anything in `src/app/pwa/` (e.g. `pwa.css` for token renames), keep it to token-name substitutions only and call out every touched file in that directory in your summary.

## The problem, bluntly

Two complaints from Thomas, both real:

1. **Desktop renders as a phone-width strip.** `practicePage.css` (and the daily equivalent) cap content at `max-width: 480px` and center it. There is no desktop layout at all — just mobile CSS stretched onto a monitor. Target: a chess.com-style shell that _uses_ the screen.
2. **It looks vibe-coded, and there's a specific reason why:** the palette in `src/index.css` is lifted straight from Duolingo — `#1cb0f6` (their blue), `#58cc02` (their green), `#ff9600`/`#ffc800` (their orange/yellow). Anyone who's seen Duolingo clocks it in two seconds. The colors must go — not get tweaked, go.

## Scope

**1. Responsive app shell (the structural fix — this is the important half).**

- `App.tsx` currently renders `<ModeSwitcher />` (top tabs) + the active page, nothing else. Replace with an `AppShell` component with two layouts:
  - **< 1024px:** current single-column behavior, essentially unchanged. Mobile is the primary product and already works — 44px tap targets, `env(safe-area-inset-*)` handling, swipe gestures must not regress. The phone experience should be visually restyled but structurally identical.
  - **≥ 1024px:** chess.com-style three-region shell: fixed left nav rail (logo, mode entries, room to grow), a centered play column (the puzzle card — can breathe wider than 480px, cap around 640–720px so code snippets get room), and a right panel surfacing what currently hides in cramped mobile chrome: rating, streak, per-pattern mastery (`MasteryView`), combo/session stats.
- Nav must accommodate a **third mode entry now** — Rush lands in Phase 7. Ship Practice/Daily wired plus a visible disabled "Rush — coming soon" slot so Phase 7 is an enablement, not a layout change.
- CSS grid + media queries. **No routing library, no UI framework, no Tailwind — no new dependencies at all** (house rule: ask first; the answer for this phase is no). Vanilla CSS with custom properties is the established pattern; stay in it.

**2. Design-token consolidation + new visual identity (the mechanical half).**

- All color/spacing/type decisions live in `src/index.css` `:root` as custom properties. Audit every per-feature CSS file (`app.css`, `practice.css`, `practicePage.css`, `dailyPage.css`, `pwa.css`) and hoist any hardcoded values into tokens. **Definition of done includes: zero hex colors outside `index.css`.** This is what makes the upcoming Claude Design iteration loop cheap — later restyles become token edits.
- Add spacing and type-scale tokens (one scale each), not just colors.
- New palette, designed **dark-first** (dark is the primary design target; keep the `prefers-color-scheme` light variant working, derived from the same token names). Direction: the "focused dark app for people who take a skill seriously" register — chess.com / Linear / GitHub-dark, _not_ the toy-bright gamified register. Desaturated dark surfaces (not pure black), one restrained accent that is not Duolingo blue or chess.com's exact green, and success/danger/warning that read as feedback, not candy. Syntax-highlight colors in the code snippet are part of the identity — make sure `highlightSnippet` colors are tokens too and legible on the new surfaces.
- The old CSS comments declare "no box-shadow anywhere." That rule is repealed for this redesign — decide deliberately (subtle elevation is fine; don't cargo-cult either direction), and update the comments to whatever the new system actually is.

**3. Explicitly out of scope.** No behavior changes: no engine/storage/content/telemetry edits, no new features, no copy rewrites beyond what layout demands, no touching rating/streak/share logic. If a structural fix seems to require a behavior change, stop and flag it instead.

## Iteration loop context (why structure-first matters)

This is **iteration 1 of a design loop**: after this lands, Thomas takes the running app through Claude Design, produces revised visual direction, and feeds deltas back to a future Claude Code session. Your job is to make that future session's work trivial — clean shell structure + everything tokenized means round 2 is mostly editing `:root`. Optimize for that, not for winning the design in one shot.

## Definition of done

- [ ] ≥1024px viewport: three-region shell renders; puzzle card centered and wider than 480px; rating/streak/mastery visible in the right panel without opening anything
- [ ] <1024px: single column, no structural regressions — swipe, tap-line, mcq, safe-area insets, 44px targets all intact
- [ ] Zero hardcoded hex colors outside `src/index.css`; spacing/type tokens exist and are used in the shell
- [ ] No Duolingo color survives anywhere (grep the old hexes to prove it)
- [ ] Dark and light both coherent; code snippets legible in both
- [ ] Rush nav slot present (disabled)
- [ ] `pnpm validate` green; no dependency added

## What you can verify yourself vs. what's on me

Own: resize-tested layouts at 375/768/1024/1440 via Playwright or manual dev-server checks with screenshots in the PR description; the grep proofs (old hexes gone, no hex outside index.css); all existing tests green.

Mine: the "does it feel like a real product" judgment on my actual phone and monitor; the Claude Design pass; approving the palette (if you're torn between two palette directions, ship one and list the alternative as token values I can swap in one edit).

## Orchestration

- Branch `phase-6.5-ui`, PR into `main` when green.
- Sequence: shell structure first (commit), then tokenization (commit), then new palette applied (commit). Three reviewable steps, no batching — if the palette is wrong, Thomas reverts one commit, not the shell.
- Delegate the mechanical token-hoisting audit (find hardcoded values across five CSS files, replace with vars) to a cheaper model via subagent. Keep your strongest reasoning on the shell layout and on not regressing the gesture/safe-area behavior in `SwipeBinary`/`PuzzleCardShell` — that's where a "just CSS" change can silently break the core interaction.
- No AI attribution in commits, as always.

When done: screenshots at all four widths (both themes), the final token list, every file touched in `src/app/pwa/` (see top), and anything you deliberately left for the Claude Design round.
