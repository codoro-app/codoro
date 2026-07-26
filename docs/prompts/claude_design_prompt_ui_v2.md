# Prompt for Claude Design — Codoro UI v2

Paste everything below this line into Claude Design.

---

Redesign the UI for **Codoro**, a code-puzzle trainer ("chess.com puzzles, but for spotting bugs in code"). Users solve short code puzzles — spot the bug, pick the right explanation, swipe yes/no — earn an Elo-style rating, and keep a daily streak. Mobile-first PWA, but there's a desktop layout too.

## What exists today (keep the structure, replace the skin)

The information architecture is settled — do not redesign the structure, redesign the visual system on top of it:

- **Desktop (≥1024px):** three regions. Left nav rail (logo + Practice / Daily / Rush). Center play column (~640px): the puzzle — question, syntax-highlighted code snippet with line numbers, answer options, feedback card after answering. Right panel: rating, streak, session stats, and a per-pattern mastery list (13 bug patterns like "Off-by-one," "Null handling," "Concurrency").
- **Mobile (<1024px):** single column, same play flow, stats compressed into a top bar.
- **Three interaction types** the puzzle card must support: multiple-choice (tap an option), tap-the-buggy-line (tap a line inside the snippet), and swipe-binary (Tinder-style yes/no card swipe — mobile's signature interaction).
- **Answer feedback states:** correct (celebratory, shows rating gain) and incorrect (shows the explanation and rating loss), then a "next puzzle" action.

## What's wrong with the current design (v1 attached as screenshots — study, then discard)

- Flat near-black everywhere; surfaces barely separate from the background; no elevation or depth system.
- Iconography is literally emoji (🏆 🔥) inside yellow pills. Replace with a real icon treatment.
- The same rating/streak/solved stats render twice on desktop (top of play column AND right panel). Decide where stats live once.
- The mastery panel is 13 identical gray cards all saying "Not enough data (0/5)" with labels wrapping to 3 lines — a noise wall with zero glanceability. It needs a compact, scannable treatment (think: name, small progress affordance, accuracy once data exists) and a designed empty state that doesn't repeat itself 13 times.
- Accent colors were never chosen as a family: purple CTA button, link-blue text button, green/red feedback outlines, orange/yellow stat pills. No palette, no hierarchy.
- Dev clutter in the play column ("Browse patterns" as a bare text link, a version string under it). "Browse patterns" needs to become a real, designed affordance.

## Design direction

- **Register:** serious training tool for people leveling up a skill — chess.com / Linear / GitHub-dark energy. NOT Duolingo, NOT toy-bright, NOT gamification-candy. The gamification (rating, streak, combo) should feel like an athlete's stats, not a child's sticker chart.
- **Dark-first.** Desaturated dark surfaces (not pure #000), a real elevation ramp (background → card → raised card), one restrained signature accent, and semantic success/danger that read as feedback. A light theme derived from the same roles will be built later — design dark.
- **The code snippet is the hero.** It's the center of every puzzle; treat it like a first-class editor surface (monospace type scale, line numbers, syntax colors designed as part of the palette, a designed "tapped line" highlight state for tap-the-line puzzles).
- **Retention is a design goal.** The moments that bring users back need visual weight: rating delta on answer (+12 / −8 as a satisfying moment, not a corner number), streak flame/counter with states (alive today / at risk / broken), combo counter during a session, and per-pattern mastery visibly filling up over time. Design these as small systems, not one-off decorations.
- **Make the mastery panel interactive by design:** each pattern row is a tap target that jumps you into practicing that pattern. Show its pressed/hover state.

## Deliverables

1. **Design tokens** as CSS custom properties: full color roles (surfaces ×3 elevations, text ×3 weights, accent, success/danger/warning, borders, syntax-highlight set), a type scale (UI + monospace), a spacing scale, radii. Vanilla CSS — no Tailwind, no component library; everything must be expressible as tokens + plain CSS.
2. **Desktop screens (1440px):** Practice with puzzle idle, correct-answer state, wrong-answer state; the pattern-browse view; Daily (same card flow plus a completion/share card: "Codoro Daily #37 — ✅ first try — 🔥 12-day streak").
3. **Mobile screens (390px):** Practice idle + answered, and the swipe-binary card mid-swipe (showing the yes/no affordance).
4. **The mastery panel** in three data states: empty (new user), partial, and rich (weeks of use).

Screens should share one obvious visual system — if a screenshot of any screen couldn't be identified as the same product as the others, tighten it.
