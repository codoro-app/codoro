# Practice feedback loop — definition

**Status: written before any implementation code (this repo's "no build without the definition on paper" convention).** Origin: the practice-feedback-loop build prompt (2026-09-04) — Practice reads as a flashcard app, not a puzzle game; every solve produces the same reaction regardless of streak length, there is no audio anywhere, correct/wrong haptics are byte-identical, and the one escalating moment (the flat every-5-streak `StreakPause` modal) is a blocking interrupt that fights the momentum it's meant to reward.

Scope: Practice only. Rush, Boss, Daily, Trace, Challenge, and the first-run sequence are unaffected — `StreakPause.tsx`/`streakPauseLogic.ts` stay exactly as they are for Trace. No clock/timer is added to Practice (Rush already owns time pressure; Practice's Elo is the rated ladder future async duels build on). The rating is never protected — shields protect the streak, `src/engine/rating.ts` is untouched.

## 1. Tier model

Four tiers, keyed off the player's current rating (`profile.rating` at answer time, not post-answer — the tier a player is _in_ when they act, not the tier the answer moves them toward):

| Tier   | Rating    | Combo step (surge every N) | Shield cap |
| ------ | --------- | -------------------------- | ---------- |
| novice | < 1300    | 3                          | 2          |
| steady | 1300-1499 | 4                          | 2          |
| sharp  | 1500-1699 | 5                          | 1          |
| elite  | >= 1700   | 6                          | 1          |

`INITIAL_RATING` is 1200, so every new player starts `novice` — deliberate, the entry tier is the most generous. The step _rises_ with tier: a new player needs to discover the streak system within 3 answers; an elite player needs the moment to stay rare enough to matter. Shield cap _falls_ with tier — higher tiers carry less insurance, the penalty-weight half of the same pacing shift.

## 2. Combo/shield economy

- `combo`: in-session correct-answer streak, session-only (matches today's `usePracticeSession` `combo` state — never persisted beyond `bestRunStreak`).
- `shields`: session-only, same lifetime as `combo`. Banked one at a time on each "surge" crossing (`newCombo > 0 && newCombo % comboStep(tier) === 0`), clamped to the tier's cap.
- A **wrong answer with a banked shield** ("shielded"): the shield is consumed (`shields - 1`), the combo _holds_ (does not reset, does not increment) — it reads as "that was caught," not a failure.
- A **wrong answer with no shield banked** ("wrong"): combo and shields both reset to 0, same as today.
- A **correct answer**: combo increments; if the new combo is a surge crossing, one shield is banked (capped).

## 3. Impact levels

`impactLevel(combo, tier) = min(3, floor(combo / comboStep(tier)))` — 0 through 3, only meaningful for correct answers. Drives:

- **Auto-advance duration**: 0->1400ms, 1->1800ms, 2->2200ms, 3->2600ms — bigger moments get to breathe.
- **Haptic pattern**: 0-1 share the unchanged 15ms tick; 2 and 3 get distinct escalating patterns (§5).
- **Audio pitch**: semitone offsets `[0, +2, +4, +7]` off a fixed root, levels 0-3 all distinct (§6) — a rising arpeggio across a streak.
- **Motion `data-impact` attribute**: `'correct-1' | 'correct-2' | 'correct-3' | 'shielded' | 'wrong'` — level 0 collapses into `'correct-1'` for CSS purposes only (`impactVariant()` in `feel.ts` does `Math.max(1, level)`). Visually there is no meaningfully distinct "level 0" pulse; the haptic/audio layers still treat level 0 as its own value where the spec calls for it. This collapsing is a decision this prompt didn't specify explicitly — recorded here rather than silently.

## 4. Auto-advance

Correct commits only — a wrong answer never auto-advances (the player needs the explanation, and taking the decision away right after a failure is the wrong moment). Duration per §3. Must be visibly interruptible (a draining fill on the Continue button) or it reads as the app stealing the tap. Cancelled by: any `pointerdown`/`keydown` inside the card or feedback panel except on the Continue button itself, or `document.hidden`. Cancellation is permanent for that puzzle (no restart). Tapping Continue during the countdown advances immediately. Skipped entirely when `preferences.autoAdvance` is `false`.

## 5. Haptics

| Outcome            | Pattern (ms)                      |
| ------------------ | --------------------------------- |
| correct, level 0-1 | `15` (unchanged `HAPTIC_TICK_MS`) |
| correct, level 2   | `[12, 40, 18]`                    |
| correct, level 3   | `[12, 30, 18, 30, 26]`            |
| shielded           | `[10, 60, 10]`                    |
| wrong              | `40`                              |

Same feature-detect (`'vibrate' in navigator`) + try/catch posture as today's `hapticTick` — a missing/blocked haptic must never break the commit path.

## 6. Audio

New Web Audio subsystem, zero asset files. `AudioContext` constructed lazily on the **first commit** (a genuine user gesture — satisfies autoplay policy), cached module-wide, `resume()`d if suspended. Master gain <= 0.15 (someone's work laptop). Every call wrapped in try/catch, silent on failure — audio is never load-bearing, same posture as haptics. Gated on `preferences.sound` (default `true` — see §8 for the mute escape hatch this requires).

- **Correct**: two-oscillator blip (sine + triangle), ~90ms, root 660Hz stepped by semitone offset `[0, +2, +4, +7]` per impact level.
- **Shielded**: filtered square wave (lowpass ~800Hz), single ~120ms tone at 220Hz — a "block" thunk, not a reward.
- **Wrong**: lowpassed sawtooth (~400Hz cutoff) at 110Hz, ~180ms, no pitch bend.

## 7. Motion

`data-impact` set on `.puzzle-card` at commit, cleared for free when the shell remounts on the next puzzle (`key={puzzle.id}` at the `PracticePage` call site — no explicit cleanup needed).

- Correct: scale pulse (max ~1.02, never a slot machine) + accent-tinted border glow, escalating 1->3.
- Wrong: 2-cycle horizontal shake, max 4px, 200ms total, danger border.
- Shielded: border flashes accent-dim with a brief inward pulse, **no shake** — reads as "caught," not "failed."

Both `[data-reduced-motion='true']` (app preference) and `@media (prefers-reduced-motion: reduce)` (OS) drop every transform, keeping colour-only feedback.

Two more motion pieces, unrelated to `data-impact`: the feedback panel's rating delta becomes the visual anchor (larger, scale-in, counts up from 0 — `feedback-panel__delta` classname preserved, `PuzzlePage.test.tsx` asserts on it), and `StatusBar`'s rating pill tweens from its old value to its new one over ~600ms whenever it changes (not on first mount).

## 8. Preferences

`CURRENT_SCHEMA_VERSION` 12 -> 13, one migration, two new keys under the existing nested `preferences` object (the first migration in this chain to merge into a nested object rather than add a top-level key):

- `sound: boolean`, default `true`.
- `autoAdvance: boolean`, default `true`.

Defaulting `sound` to on for every existing profile is a deliberate call — it needs a real, always-visible escape hatch: a mute toggle in `StatusBar` (not settings-only — something that makes noise unprompted needs a one-tap kill switch in the moment), plus both preferences as ordinary rows in `SettingsPage`'s Preferences section. Banked shields render as small pips next to the combo badge — a shield the player can't see isn't a mechanic, it's a surprise.

## 9. Replacing the milestone modal

`StreakPause.tsx`/`streakPauseLogic.ts` are untouched — Trace keeps both, unmodified, exactly as today. Practice gets `ComboSurge.tsx`: non-blocking, `role="status"`, overlaid above the card, auto-dismissing ~1600ms, no buttons. Shows the combo count, "+1 shield" when one was banked this surge, "New best" when the surge also set a new `bestRunStreak`. `bestRunStreak` persistence is re-expressed against the tier-aware surge check (`outcome.surge && outcome.newCombo > profile.bestRunStreak`) rather than the old flat-5 `resolveStreakPause` — same gating behavior (only updates on a surge crossing), new threshold.

## 10. Telemetry additions

- `attempt` event: add `combo` (post-answer combo), `impact_level` (0 for wrong/shielded — the escalation concept only applies to correct answers), `rating_tier`.
- `streak_pause` event: kept firing (PostHog continuity) — now triggered by `outcome.kind === 'correct' && outcome.surge` (the tier-aware cadence) instead of the old flat-5 `resolveStreakPause` check. Adds `tier`, `shields_banked` (shields banked _after_ this surge).
- New `combo_shield_used`: `{ tier, combo, shields_remaining }` — fired on every `'shielded'` outcome.
- New `auto_advance`: `{ impact_level, cancelled }` — fired once the auto-advance countdown resolves (timed out or was cancelled), never for a manual Continue tap that happens before any countdown started.

## 11. Non-goals

- No clock/timer on Practice (decision 1, locked).
- No change to `src/engine/rating.ts` or how/when Elo updates (decision 3, locked).
- No change to Rush, Boss, Daily, Trace, Challenge, or the first-run sequence (decision 4, locked).
- No change to `StreakPause.tsx`/`streakPauseLogic.ts` — Trace's milestone moment is untouched.
- No new puzzle interaction types.
- No audio/haptic/motion changes outside the outcomes enumerated above.
- No `.mp3`/`.wav` assets.
