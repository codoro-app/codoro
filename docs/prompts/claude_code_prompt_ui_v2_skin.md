# Prompt for Claude Code — Apply the Codoro v2 "Arena" design system

Paste this into Claude Code in the codoro repo. `git fetch && git status` first; confirm `main` includes the Phase 6.5 shell **and** the `fix/mastery-panel-sync` merge (panel updates live + mastery rows clickable). If the sync fix isn't merged yet, stop and say so — restyling a panel whose behavior is about to change is wasted motion.

---

## Source of truth

`docs/design/codoro-v2-arena.html` — the finalized design, produced in Claude Design and committed to the repo. Open it in a browser and keep it side-by-side while you work. Screens are labeled with HTML comments: `2a` practice idle, `2b` correct, `2c` wrong, `2d` browse patterns, `2e` daily + share, `2f–2j` mobile variants (including `2h` swipe-binary mid-gesture), `2k–2m` mastery panel empty/partial/rich.

Two rules about that file:

1. **It's a spec, not source code.** It uses inline styles because it's a design canvas export. Do not copy its markup into components. Translate its visual decisions into the existing architecture: tokens in `src/index.css`, per-feature CSS files, existing component tree.
2. **Its content is placeholder.** The sample puzzle, numbers, and copy in the mock are fake — port the styling onto real component content only.

## Known issue — standing rule

The update-prompt in `src/app/pwa/` remains hands-off. Token renames inside `pwa.css` are fine; anything beyond that in `src/app/pwa/`, list explicitly in your summary.

## Step 1 — Fonts (own commit)

Design uses **Space Grotesk** (UI) and **JetBrains Mono** (code). Self-host, don't link Google Fonts at runtime — this is a PWA that must work offline, and no third-party request on load.

- Download latin-subset `.woff2` files into `public/fonts/`: Space Grotesk 400/500/700, JetBrains Mono 400/700 (add 500 only if the design demonstrably uses it). Keep the file count lean.
- `@font-face` rules in `src/index.css` with `font-display: swap`; `<link rel="preload">` in `index.html` for the two above-the-fold faces (UI 400, mono 400).
- **No npm font packages** — static assets only (house rule: no new dependencies).
- Check `vite.config.ts`: if the Workbox `globPatterns` doesn't cover `woff2`, add it so fonts precache — otherwise offline users get fallback fonts and the whole skin degrades.

## Step 2 — Token overhaul (own commit)

Replace the `:root` block in `src/index.css` with the v2 system. Exact values from the design:

```css
/* surfaces & structure */
--surface-0: #0e0f13;
--surface-1: #16181e;
--surface-2: #20232b;
--border: #2a2e38;
--border-strong: #3a3f4c;
/* text */
--text-0: #f3f2ee;
--text-1: #a3a6b0;
--text-2: #636773;
/* accent (electric lime) */
--accent: #c6f83c;
--accent-dim: #26310a;
--accent-dim-2: #171f06;
/* semantic */
--ok: #c6f83c;
--ok-dim: #1b2a0a;
--danger: #ff5470;
--danger-dim: #31121b;
--warn: #ffb020;
--warn-dim: #2e2408;
/* syntax highlighting */
--syn-kw: #ff9e64;
--syn-fn: #7dcfff;
--syn-str: #9ece6a;
--syn-num: #e0af68;
--syn-cm: #565f73;
/* type */
--font-ui: 'Space Grotesk', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

- Rename usages across all per-feature CSS files (Phase 6.5's zero-hex-outside-index.css rule means this is mechanical — verify with a grep, and grep the old Duolingo-era hexes to confirm extinction).
- Read spacing/radius values off the reference file and set those tokens to match (it leans on 8px radii for chips, larger for cards — take the actual values from the file, don't guess from this prompt).
- **Dark-only decision:** delete the `prefers-color-scheme: dark` split — v2 is designed dark-only and shipping an uncalibrated light theme is worse than none. Set `<meta name="color-scheme" content="dark">` / `color-scheme: dark` appropriately. Flag this loudly in the summary; light theme is a deliberate post-launch item now.
- **Theme hook for later:** declare the token block on `:root, [data-theme="dark"]` and set `data-theme="dark"` on `<html>`. A light theme + toggle is planned post-launch; this makes it a purely additive `[data-theme="light"]` block later. Do **not** build the toggle, a light palette, or any theme-switching logic now.
- `highlightSnippet` colors move onto the `--syn-*` tokens.

## Step 3 — Apply per screen (one commit each, in this order)

1. **Shell & nav** (desktop rail + mobile app bar/tabs per `2a`/`2f`): logo treatment, nav states, and the stats dedupe — per the design, rating/streak/session stats live in **one** place per layout (right panel on desktop, app bar on mobile). Kill the duplicated top-center pill row. Kill the emoji-in-pill iconography everywhere — the design shows the replacement treatment. Remove the version string and bare "Browse patterns" text link from the play column; browse gets its designed affordance.
2. **Puzzle card + code surface + answers + feedback** (`2a/2b/2c`, mobile `2f/2g`): the code block is the hero surface — line numbers, syntax tokens, tap-line highlight state. Correct/wrong feedback per design, including the rating-delta moment. Swipe-binary card per `2h` — restyle only; do not touch `gestureThreshold` logic or thresholds.
3. **Browse patterns** (`2d`/`2i`).
4. **Mastery panel** (`2k/2l/2m`): slim progress track + count/accuracy chip rows, all three data states, and the row hover/pressed states (rows are already interactive from the sync-fix PR).
5. **Daily + share card** (`2e`/`2j`). Style only — no changes to streak/share/OG logic.

States the static mock can't show — hover, pressed, `:focus-visible`, disabled — derive from the token system (accent-dim family exists for exactly this). Keep every existing behavior, test, and a11y affordance: 44px targets, safe-area insets, keyboard focus.

## Definition of done

- [ ] Side-by-side at 1440px and 390px: each implemented screen reads as the same design as its reference section — layout, hierarchy, color roles (pixel-perfection not required; "same product" is)
- [ ] Grep-proofs: old palette hexes gone; zero hex outside `src/index.css`; no emoji used as UI iconography
- [ ] Stats appear exactly once per layout
- [ ] Fonts load self-hosted, precached by the SW — verify via dev-tools offline reload showing correct fonts
- [ ] All three interactions (mcq, tap-line, swipe) function unchanged; existing tests green; `pnpm validate` green; zero new dependencies
- [ ] Screenshots of every screen at both widths in the PR description, ordered to match 2a–2m

## What you can verify yourself vs. what's on me

Own: everything above, including the offline font check and resize screenshots.

Mine: real-device pass (swipe feel with new card styling, safe areas on the actual phone), share-text/unfurl unchanged, and final "does it match the design" sign-off — if a screen can't match without a behavior change, build the closest style-only version and list the gap instead of changing behavior.

## Orchestration

- Branch `ui-v2-arena`, PR into `main` when green. Commit sequence as numbered above — fonts, tokens, then screen-by-screen. No batching; if the palette application goes wrong at step 3, earlier commits survive.
- Delegate mechanical work (font download/subsetting, token rename sweep, grep proofs) to a cheaper model via subagent. Keep your strongest reasoning on the code-surface styling (syntax token legibility, tap-line state) and on not regressing `SwipeBinary`/`PuzzleCardShell` gesture behavior — same risk zones as 6.5.
- No AI attribution in commits.

When done: summary with the dark-only confirmation, any deviations from the reference and why, `pwa/` files touched if any, and the screenshot set.
