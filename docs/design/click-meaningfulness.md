# Click-meaningfulness — definition session

**Status: this is the blocking prerequisite `docs/v3-build-plan.md`'s Phase 2 requires before any Missions code is written** ("Do not open this phase without the definition session" — never run in v2, carried into v3, run here as a live dialogue with Thomas rather than an offline write-up). Origin: v2 todo item 8 ("How to make every click feel meaningful?"), parked twice (`docs/v2-build-plan.md:698-704`, `docs/todo.md:27-29`) before this session.

This doc answers the four things Phase 2's spec requires at minimum: an operational definition, an audit of which existing surfaces fail it, the mission flow's state machine, and an explicit out-of-scope list — plus tooltips' disposition, parked here by the same v2 decision.

## 1. Operational definition

The floated lens — "does every tap advance something the player can feel?" — is a vibe, not a test. Sharpened into something checkable against real code: this app's taps split into two categories that need different tests, because a "gating" tap structurally _cannot_ reveal anything new (that's what makes it a gate, not a redundant answer-tap), so holding it to the revelatory tap's bar is why it always reads as "meaningless."

- **Revelatory tap** — submits or commits something (an answer choice, a checkpoint pick, a scrub position). **Passes iff**: within one frame of the tap, the player sees new state directly caused by _that_ tap (a feedback panel, a revealed cell, a variable changing). **Fails iff**: a tap is rendered as interactive but produces no visible or perceptible change at all — a true dead tap. No dead taps were found in this audit (§2).
- **Gating tap** — pure pacing/advancement (every mode's "Continue" button). It cannot itself reveal anything, by construction. **Passes iff**: before the tap, the destination is already legible (a label or icon says what's next), and the tap never requires a second tap afterward to discover what actually happened. **Fails iff**: the tap is a blind advance — nothing about it previews what's coming, so all the information arrives only after tapping.

A click is meaningful iff it passes the test for whichever category it is. This is checkable directly against a component's props/JSX, not a subjective read.

## 2. Existing-surface audit

**Passes cleanly — the model to match:**

- The Scrubber itself: every scrub position is a revelatory tap by construction — the strongest existing example of the definition working as intended.
- `CheckpointPanel`'s checkpoint commit (`useTraceSession.ts`'s `handleCheckpointAnswered` doc comment: "each checkpoint accepts exactly one answer") — one tap, immediate, irreversible reveal.
- Boss's health-bar hit reaction (`BossPage.tsx:67-81`) — `key={session.strikes}` forces a remount on every strike so the CSS hit-reaction animation restarts each time; the tap that caused the strike gets an immediate, legible, directly-attributable visual consequence.

**Fails the gating-tap test today — systemic, not mode-specific:**

Every mode's answer→"Continue" pattern shares the same shape: `PuzzleCardShell`'s `onContinue` (`PuzzleCardShell.tsx:35,246-248`) and `TraceRunnerPuzzle`'s identical `feedback-panel__continue` button (`TraceRunner.tsx:148,390-392`) are both plain, unlabeled "Continue" buttons — nothing about the button itself previews what's coming (next puzzle? end of run? a summary screen?). The tap is a blind advance: everything it "reveals" was invisible until after the tap resolved. This is a real, systemic gap across Practice/Daily/Rush/Boss/Trace alike.

**This gap is flagged, not fixed app-wide.** Rewriting every mode's Continue button is a full-UI-redesign question — explicitly out of scope per §4. What Missions must do instead: not repeat this failure at its own stage-transition boundary, where it would compound (a blind advance into an entirely different _mode_, not just the next puzzle, is a bigger miss than within one mode). The mission checkpoint screen (§3) previews the next stage's icon, name, and duration before the player taps into it — satisfying the gating-tap test exactly where a new failure would otherwise be introduced.

**Named but out of the lens's scope**, so the audit isn't mistaken for missing it: Rush's `forcedCommit` timeout strike (`useRushSession.ts:274-276`) is a strike with zero tap involved — the absence of a click, not a meaningless one.

## 3. Mission flow state machine

**Entry point**: `/missions` route, reachable from a Home hub card and a nav-rail tab, mirroring Boss's own entry points exactly.

**The chain**: 🧠 Trace → ⚡ Speed Round (Rush) → 🏆 Boss → payoff. One fixed chain; no rotation/variants in this phase.

**Per-stage completion criteria**: every stage runs a uniform **60-second** clock (untuned by admission, matching Rush's own flat 15-second-per-puzzle clock precedent — its doc comment states its own untuned-ness the same honest way). A stage ends on **whichever comes first**: the 60s clock, or the mode's own native end condition where one exists (Speed Round: Rush's existing 3-strike limit; Boss: Boss's existing 3-strikes/depth-10 limit). **Cutoff is soft**: the puzzle on screen when the clock reaches 0 is allowed to finish; the clock is only checked _between_ puzzles, never mid-puzzle, so a tap is never interrupted. Trace has no native end at all — it's an endless single-puzzle loop by design — so for Trace's stage the 60s clock is the _only_ end condition; this asymmetry with Speed Round/Boss is real and is stated here rather than smoothed over.

In practice, because a real Boss run isn't sized to fit in 60 seconds, the Boss stage will almost always end via the clock, not via Boss's own strike/depth limit. **Accepted trade-off, not a bug.**

**Abandon/resume**: closing the app mid-mission and returning resumes **at the start of whichever stage the player was on**, with a fresh 60s clock — earlier completed stages' results are kept. No in-progress puzzle or paused countdown is ever serialized. This is achieved structurally, not by a separate detector: mission progress is written to storage **only at stage boundaries**, never mid-stage — so a bare tab close simply never reaches a write, and there is nothing to distinguish from an ordinary resumable state. "Abandoned" (for telemetry) is instead a **distinct, explicit action** — an "Exit mission" affordance inside the mission page — that clears progress and fires its own event. A tab close is silently resumable; only an explicit exit is recorded as an abandon.

**Payoff moment**: a celebration/summary screen recapping all three stages (icon + one stat per stage) plus a completions-based badge ("Mission #N complete"). **No new bonus-Elo/rating mechanic is invented.** Trace's stage rates exactly as standalone Trace does (unchanged, through its existing `practice`-pool rating); Rush and Boss stay unrated exactly as they are standalone. No invented number appears anywhere on this screen — a direct, deliberate rejection of `docs/todo.md`'s literal "+24 Elo" framing, because this app's standing rule is no fake/guessed numbers, and Boss's own Phase 1 already made the same call ("no Elo integration in this phase").

**Replayability**: unlimited, anytime — mirrors Boss's "Run it back."

## 4. Explicit out-of-scope

- No app-wide redesign of the answer→Continue pattern named in §2 — that gap is documented, not fixed, everywhere it appears outside Missions.
- No changes to `PuzzleCardShell`'s interaction model.
- No new global timer visual language beyond adapting Rush's existing countdown treatment to a stage-level clock.
- No retry/hint mechanics.
- No rating/Elo mechanic invented (§3).
- No accounts/leaderboard tie-in — that's v3 Phase 4, unrelated to this phase.
- No mission-chain variants/rotation — one fixed chain only, this phase.

## 5. Tooltips disposition (v2 todo item 12)

No tooltip component exists anywhere in this codebase today, and there is no real-user confusion data to design one against — the app has zero production users pre-launch. **Deferred explicitly**, the same disposition Phase 6 already applies to AI features ("stays parked until dashboard/feedback data shows where players get stuck," `docs/v3-build-plan.md:212`): tooltips wait for real post-launch signal about where players actually get confused, rather than being speculatively built now against an originally-undefined todo item. This is a written decision, not silence — consistent with this repo's own standing rule that "undecided" is a valid recorded state but silent is not.
