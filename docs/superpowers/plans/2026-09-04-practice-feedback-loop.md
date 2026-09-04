# Practice feedback loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Practice's flat, undifferentiated answer→Continue loop with a tier-aware combo/shield economy, escalating solve/fail feedback (motion + haptics + synthesized audio), an interruptible auto-advance, and a non-blocking combo-surge moment — so a 1200-rated player and a 1700-rated player have visibly different reward cadences.

**Architecture:** One new pure module (`src/app/practice/feel.ts`) owns every tier/combo/shield/impact rule and is the single source `usePracticeSession.ts` consults when resolving an answer. `PuzzleCardShell.tsx` gains an opt-in `autoAdvanceMs` prop (existing callers unaffected) and an `impact` prop that drives a `data-impact` attribute for CSS-only motion. Haptics and synthesized Web Audio are unified behind one `playImpact()` call. `StreakPause`/`streakPauseLogic.ts` are left untouched for Trace; Practice gets its own non-blocking `ComboSurge.tsx`. Preferences (`sound`, `autoAdvance`) ride a new v12→v13 migration.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, Zod (schema), Web Audio API (no audio assets), Tailwind utility classes + a small hand-written `practice.css` keyframe block, `navigator.vibrate`.

**Spec:** `Projects/codoro/Claude outputs/practice-feedback-loop-prompt.md` (the original build prompt — decisions 1-4 there are locked and must not be relitigated). Companion definition doc this plan's Task 1 produces: `docs/design/practice-feedback-loop.md`.

## Global Constraints

- `INITIAL_RATING` is 1200 (`src/engine/rating.ts`) — every new player starts in `novice`.
- Tier boundaries: `elite` ≥1700, `sharp` ≥1500, `steady` ≥1300, else `novice`.
- Combo step (surge threshold) by tier: novice 3, steady 4, sharp 5, elite 6.
- Shield cap by tier: novice 2, steady 2, sharp 1, elite 1.
- Never touch `src/engine/rating.ts` — Elo always updates on every attempt; shields protect the streak, not the rating.
- Never touch `src/app/StreakPause.tsx` or `src/app/streakPauseLogic.ts` — Trace keeps using both unmodified.
- Never touch `.swipe-fallback__*` / `.drag-order__*` blocks in `practice.css`.
- No `.mp3`/`.wav` assets — audio is synthesized via Web Audio API, `AudioContext` constructed lazily on first commit only.
- Master audio gain ≤ 0.15.
- Auto-advance fires only on correct commits, never on wrong.
- Auto-advance durations by impact level: 0→1400ms, 1→1800ms, 2→2200ms, 3→2600ms.
- Haptic patterns: correct 0–1 → `15` (ms, unchanged `HAPTIC_TICK_MS`); correct 2 → `[12, 40, 18]`; correct 3 → `[12, 30, 18, 30, 26]`; shielded → `[10, 60, 10]`; wrong → `40`.
- `CURRENT_SCHEMA_VERSION` moves 12 → 13 in one migration adding `preferences.sound` (default `true`) and `preferences.autoAdvance` (default `true`).
- Every new tunable constant gets a one-line rationale comment (Thomas hand-tunes these after play-testing).
- `pnpm validate` (`typecheck && lint && test && validate:content && build`) must be green before calling this done.
- Work happens on branch `practice-feedback-loop` (already created off `origin/main`), never on `main`.

---

## File structure

| File                                                                                                       | Responsibility                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/design/practice-feedback-loop.md`                                                                    | The definition doc — tier model, combo/shield economy, impact spec, auto-advance rules, audio spec, telemetry, non-goals. Written first, blocking. |
| `src/app/practice/feel.ts` (new)                                                                           | Pure tier/combo/shield/impact engine. No React, no I/O.                                                                                            |
| `src/app/practice/feel.test.ts` (new)                                                                      | Unit tests for every exported function.                                                                                                            |
| `src/app/practice/usePracticeSession.ts` (edit)                                                            | Routes answers through `resolveOutcome`; adds `shields`/`lastOutcome`; fixes `streakAttempts` to follow the streak; calls `playImpact`.            |
| `src/app/practice/usePracticeSession.test.ts` (edit)                                                       | Replace the `streak-pause` describe block with a `combo/shield economy` block; add shielded-miss cases.                                            |
| `src/app/practice/PuzzleCardShell.tsx` (edit)                                                              | Adds `autoAdvanceMs`, `onAutoAdvanceResolved`, and `impact` props; draining-fill Continue button; cancel-on-interaction.                           |
| `src/app/practice/PuzzleCardShell.test.tsx` (edit)                                                         | New `describe('auto-advance ...')` block; existing cases must pass unchanged.                                                                      |
| `src/app/practice/practice.css` (edit)                                                                     | New `[data-impact]` keyframes; Continue-button drain fill.                                                                                         |
| `src/app/practice/haptics.ts` (edit)                                                                       | Adds `hapticImpact(outcome)` alongside the untouched `hapticTick`/`HAPTIC_TICK_MS` (TraceRunner still calls `hapticTick` directly).                |
| `src/app/practice/haptics.test.ts` (edit)                                                                  | New cases for the pattern table.                                                                                                                   |
| `src/app/practice/feedbackSound.ts` (new)                                                                  | Web Audio synthesis, lazy `AudioContext`, gated on `preferences.sound`.                                                                            |
| `src/app/practice/feedbackSound.test.ts` (new)                                                             | Stubbed `AudioContext`; gating, laziness, throw-safety.                                                                                            |
| `src/app/practice/playImpact.ts` (new)                                                                     | Combines haptics + audio behind one call.                                                                                                          |
| `src/app/practice/playImpact.test.ts` (new)                                                                | Verifies both are invoked with the right args, and preference gating.                                                                              |
| `src/app/practice/useNumberTween.ts` (new)                                                                 | Shared rAF count-up/tween hook — 0→target on mount (FeedbackHeader's delta), or previous→target on change (StatusBar's rating pill).               |
| `src/app/practice/useNumberTween.test.ts` (new)                                                            | Fake-timer tests for both usage shapes.                                                                                                            |
| `src/app/practice/StatusBar.tsx` (edit)                                                                    | Mute toggle, shield pips, tweened rating pill.                                                                                                     |
| `src/app/practice/StatusBar.test.tsx` (edit)                                                               | New cases; existing cases keep passing.                                                                                                            |
| `src/app/practice/ComboSurge.tsx` (new)                                                                    | Non-blocking `role="status"` surge toast, auto-dismisses ~1600ms.                                                                                  |
| `src/app/practice/ComboSurge.test.tsx` (new)                                                               | Render/dismiss/content assertions.                                                                                                                 |
| `src/app/practice/PracticePage.tsx` (edit)                                                                 | Wires `ComboSurge`, `autoAdvanceMs`/`impact` props, drops `StreakPause` usage for Practice.                                                        |
| `src/app/practice/PracticePage.test.tsx` (edit)                                                            | New cases for `ComboSurge` rendering + dismissal.                                                                                                  |
| `src/storage/schema.ts` (edit)                                                                             | `PreferencesSchema`/`Preferences`/`DEFAULT_PREFERENCES` gain `sound`, `autoAdvance`; doc-comment rewrite.                                          |
| `src/storage/migrations.ts` (edit)                                                                         | `migrateV12ToV13`, registered under key `12`.                                                                                                      |
| `src/storage/migrations.test.ts` (edit)                                                                    | New `MIGRATIONS[12]` describe block, including "existing preference values survive the nested merge".                                              |
| `src/storage/schema.test.ts` (edit, if it asserts `DEFAULT_PREFERENCES`/`CURRENT_SCHEMA_VERSION` literals) | Update to v13 + two new keys.                                                                                                                      |
| `src/app/settings/SettingsPage.tsx` (edit)                                                                 | Two new preference toggle rows (`updatePreference` pattern).                                                                                       |
| `src/app/settings/SettingsPage.test.tsx` (edit)                                                            | New rows' assertions.                                                                                                                              |
| `src/telemetry/events.ts` (edit)                                                                           | Extend `AttemptEventPayload`/`StreakPausePayload`; add `ComboShieldUsedPayload`/`trackComboShieldUsed`, `AutoAdvancePayload`/`trackAutoAdvance`.   |
| `src/telemetry/index.ts` (edit)                                                                            | Barrel-export the two new functions/types.                                                                                                         |

---

### Task 1: Definition doc (blocking)

**Files:**

- Create: `docs/design/practice-feedback-loop.md`

**Interfaces:** None — prose only, but every constant named here must match Task 2's `feel.ts` exactly (this doc is written first; Task 2 must not silently diverge from it).

- [ ] **Step 1: Write the doc**

```markdown
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
- **Haptic pattern**: 0-1 share the unchanged 15ms tick; 2 and 3 get distinct escalating patterns (SS5).
- **Audio pitch**: semitone offsets `[0, +2, +4, +7]` off a fixed root, levels 0-3 all distinct (SS6) — a rising arpeggio across a streak.
- **Motion `data-impact` attribute**: `'correct-1' | 'correct-2' | 'correct-3' | 'shielded' | 'wrong'` — level 0 collapses into `'correct-1'` for CSS purposes only (`impactVariant()` in `feel.ts` does `Math.max(1, level)`). Visually there is no meaningfully distinct "level 0" pulse; the haptic/audio layers still treat level 0 as its own value where the spec calls for it. This collapsing is a decision this prompt didn't specify explicitly — recorded here rather than silently.

## 4. Auto-advance

Correct commits only — a wrong answer never auto-advances (the player needs the explanation, and taking the decision away right after a failure is the wrong moment). Duration per SS3. Must be visibly interruptible (a draining fill on the Continue button) or it reads as the app stealing the tap. Cancelled by: any `pointerdown`/`keydown` inside the card or feedback panel except on the Continue button itself, or `document.hidden`. Cancellation is permanent for that puzzle (no restart). Tapping Continue during the countdown advances immediately. Skipped entirely when `preferences.autoAdvance` is `false`.

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

New Web Audio subsystem, zero asset files. `AudioContext` constructed lazily on the **first commit** (a genuine user gesture — satisfies autoplay policy), cached module-wide, `resume()`d if suspended. Master gain <= 0.15 (someone's work laptop). Every call wrapped in try/catch, silent on failure — audio is never load-bearing, same posture as haptics. Gated on `preferences.sound` (default `true` — see SS8 for the mute escape hatch this requires).

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
```

- [ ] **Step 2: Commit**

```bash
git add docs/design/practice-feedback-loop.md
git commit -m "docs: practice feedback loop definition"
```

---

### Task 2: `feel.ts` — the tier/impact engine

**Files:**

- Create: `src/app/practice/feel.ts`
- Test: `src/app/practice/feel.test.ts`

**Interfaces:**

- Produces: `RatingTier` (`'novice' | 'steady' | 'sharp' | 'elite'`), `ratingTier(rating: number): RatingTier`, `comboStep(tier: RatingTier): number`, `shieldCap(tier: RatingTier): number`, `isSurge(newCombo: number, tier: RatingTier): boolean`, `impactLevel(combo: number, tier: RatingTier): 0 | 1 | 2 | 3`, `Outcome` (discriminated union, see below), `resolveOutcome(input: { correct: boolean; combo: number; shields: number; rating: number }): Outcome`, `ImpactVariant` (`'correct-1' | 'correct-2' | 'correct-3' | 'shielded' | 'wrong'`), `impactVariant(outcome: Outcome): ImpactVariant`.
- Consumes: nothing (pure, zero imports beyond types).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/practice/feel.test.ts
import { describe, expect, it } from 'vitest'
import {
  comboStep,
  impactLevel,
  impactVariant,
  isSurge,
  ratingTier,
  resolveOutcome,
  shieldCap,
} from './feel'

describe('ratingTier', () => {
  it('classifies the tier boundaries exactly', () => {
    expect(ratingTier(1299)).toBe('novice')
    expect(ratingTier(1300)).toBe('steady')
    expect(ratingTier(1499)).toBe('steady')
    expect(ratingTier(1500)).toBe('sharp')
    expect(ratingTier(1699)).toBe('sharp')
    expect(ratingTier(1700)).toBe('elite')
  })

  it('puts a brand-new profile (INITIAL_RATING 1200) in novice', () => {
    expect(ratingTier(1200)).toBe('novice')
  })
})

describe('comboStep / shieldCap', () => {
  it('rises with tier for comboStep, falls with tier for shieldCap', () => {
    expect(comboStep('novice')).toBe(3)
    expect(comboStep('steady')).toBe(4)
    expect(comboStep('sharp')).toBe(5)
    expect(comboStep('elite')).toBe(6)
    expect(shieldCap('novice')).toBe(2)
    expect(shieldCap('steady')).toBe(2)
    expect(shieldCap('sharp')).toBe(1)
    expect(shieldCap('elite')).toBe(1)
  })
})

describe('isSurge', () => {
  it('is true only on positive multiples of the tier step', () => {
    expect(isSurge(0, 'novice')).toBe(false)
    expect(isSurge(1, 'novice')).toBe(false)
    expect(isSurge(3, 'novice')).toBe(true)
    expect(isSurge(6, 'novice')).toBe(true)
    expect(isSurge(4, 'novice')).toBe(false)
    expect(isSurge(5, 'sharp')).toBe(true)
  })
})

describe('impactLevel', () => {
  it('saturates at 3 and floors between steps', () => {
    expect(impactLevel(0, 'novice')).toBe(0)
    expect(impactLevel(2, 'novice')).toBe(0)
    expect(impactLevel(3, 'novice')).toBe(1)
    expect(impactLevel(5, 'novice')).toBe(1)
    expect(impactLevel(6, 'novice')).toBe(2)
    expect(impactLevel(9, 'novice')).toBe(3)
    expect(impactLevel(30, 'novice')).toBe(3) // saturates
  })
})

describe('resolveOutcome', () => {
  it('a correct answer increments combo and reports the impact level', () => {
    const outcome = resolveOutcome({ correct: true, combo: 1, shields: 0, rating: 1200 })
    expect(outcome).toEqual({
      kind: 'correct',
      level: 0,
      newCombo: 2,
      newShields: 0,
      surge: false,
      tier: 'novice',
    })
  })

  it('a correct answer that crosses a surge threshold banks a shield', () => {
    const outcome = resolveOutcome({ correct: true, combo: 2, shields: 0, rating: 1200 })
    expect(outcome).toEqual({
      kind: 'correct',
      level: 1,
      newCombo: 3,
      newShields: 1,
      surge: true,
      tier: 'novice',
    })
  })

  it('banking clamps to the tier shield cap', () => {
    const outcome = resolveOutcome({ correct: true, combo: 5, shields: 2, rating: 1200 })
    // novice cap is 2 — combo 5->6 is a surge (step 3) but shields stay at 2
    expect(outcome.kind).toBe('correct')
    expect(outcome).toMatchObject({ newShields: 2, surge: true })
  })

  it('a wrong answer with a banked shield is shielded: combo holds, one shield is consumed', () => {
    const outcome = resolveOutcome({ correct: false, combo: 4, shields: 2, rating: 1200 })
    expect(outcome).toEqual({ kind: 'shielded', newCombo: 4, newShields: 1, tier: 'novice' })
  })

  it('a wrong answer with no shield resets both combo and shields', () => {
    const outcome = resolveOutcome({ correct: false, combo: 4, shields: 0, rating: 1200 })
    expect(outcome).toEqual({ kind: 'wrong', newCombo: 0, newShields: 0, tier: 'novice' })
  })

  it('tier is derived from the rating passed in, independent of combo/shields', () => {
    const outcome = resolveOutcome({ correct: true, combo: 0, shields: 0, rating: 1650 })
    expect(outcome.tier).toBe('sharp')
  })
})

describe('impactVariant', () => {
  it('maps correct levels 0 and 1 to the same "correct-1" CSS variant', () => {
    expect(
      impactVariant(resolveOutcome({ correct: true, combo: 0, shields: 0, rating: 1200 })),
    ).toBe('correct-1')
    expect(
      impactVariant(resolveOutcome({ correct: true, combo: 2, shields: 0, rating: 1200 })),
    ).toBe('correct-1')
  })

  it('maps correct levels 2 and 3 to their own variants', () => {
    expect(
      impactVariant(resolveOutcome({ correct: true, combo: 5, shields: 0, rating: 1200 })),
    ).toBe('correct-2')
    expect(
      impactVariant(resolveOutcome({ correct: true, combo: 8, shields: 0, rating: 1200 })),
    ).toBe('correct-3')
  })

  it('maps shielded and wrong to their own variants', () => {
    expect(
      impactVariant(resolveOutcome({ correct: false, combo: 4, shields: 1, rating: 1200 })),
    ).toBe('shielded')
    expect(
      impactVariant(resolveOutcome({ correct: false, combo: 4, shields: 0, rating: 1200 })),
    ).toBe('wrong')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/practice/feel.test.ts`
Expected: FAIL — `./feel` has no exports yet (module not found).

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/practice/feel.ts
/**
 * Practice's tier/combo/shield/impact engine — pure, no React, no I/O.
 * Mirrors src/engine/'s Rng-injection/pure-function style, but deliberately
 * lives here rather than in src/engine/: this is Practice-only feel/pacing,
 * not rating/selection/streak/requeue domain logic, and src/engine/ is a
 * barrel of the latter (see docs/design/practice-feedback-loop.md).
 *
 * The whole point of the tier model (docs/design/practice-feedback-loop.md
 * SS1): pacing shifts by rating tier, not just puzzle difficulty. A 1200 and
 * a 1700 player must not experience the same reward cadence.
 */

export type RatingTier = 'novice' | 'steady' | 'sharp' | 'elite'

/** INITIAL_RATING (src/engine/rating.ts) is 1200 — every new player starts here, deliberately the most generous tier. */
export function ratingTier(rating: number): RatingTier {
  if (rating >= 1700) return 'elite'
  if (rating >= 1500) return 'sharp'
  if (rating >= 1300) return 'steady'
  return 'novice'
}

/** Surge threshold per tier — rises with tier so a new player discovers the streak system fast (novice: 3) while an elite player's moment stays rare enough to matter (elite: 6). */
const COMBO_STEP: Record<RatingTier, number> = {
  novice: 3,
  steady: 4,
  sharp: 5,
  elite: 6,
}

/** Shield cap per tier — falls with tier: higher tiers carry less insurance, the penalty-weight half of the same pacing shift. */
const SHIELD_CAP: Record<RatingTier, number> = {
  novice: 2,
  steady: 2,
  sharp: 1,
  elite: 1,
}

export function comboStep(tier: RatingTier): number {
  return COMBO_STEP[tier]
}

export function shieldCap(tier: RatingTier): number {
  return SHIELD_CAP[tier]
}

/** True on every positive multiple of the tier's combo step (3, 6, 9, ... for novice) — a player who keeps the streak alive keeps earning surges, not just once. */
export function isSurge(newCombo: number, tier: RatingTier): boolean {
  return newCombo > 0 && newCombo % comboStep(tier) === 0
}

/** 0-3, saturating: how many full combo-step cycles the current combo has completed, capped at 3 so escalation has a ceiling. */
export function impactLevel(combo: number, tier: RatingTier): 0 | 1 | 2 | 3 {
  return Math.min(3, Math.floor(combo / comboStep(tier))) as 0 | 1 | 2 | 3
}

export type Outcome =
  | {
      kind: 'correct'
      level: 0 | 1 | 2 | 3
      newCombo: number
      newShields: number
      surge: boolean
      tier: RatingTier
    }
  | { kind: 'shielded'; newCombo: number; newShields: number; tier: RatingTier }
  | { kind: 'wrong'; newCombo: 0; newShields: 0; tier: RatingTier }

/**
 * The single entry point every caller (usePracticeSession) resolves an
 * answer through. `combo`/`shields` are the CURRENT (pre-answer) session
 * state; `rating` is the player's rating at answer time (pre-answer —
 * which tier the player is IN when they act, not the tier the answer moves
 * them toward).
 */
export function resolveOutcome({
  correct,
  combo,
  shields,
  rating,
}: {
  correct: boolean
  combo: number
  shields: number
  rating: number
}): Outcome {
  const tier = ratingTier(rating)

  if (!correct) {
    if (shields > 0) {
      // Shielded: the streak survived, so combo HOLDS (neither resets nor
      // increments) — one banked shield is spent to absorb this miss.
      return { kind: 'shielded', newCombo: combo, newShields: shields - 1, tier }
    }
    return { kind: 'wrong', newCombo: 0, newShields: 0, tier }
  }

  const newCombo = combo + 1
  const surge = isSurge(newCombo, tier)
  const newShields = surge ? Math.min(shieldCap(tier), shields + 1) : shields
  const level = impactLevel(newCombo, tier)
  return { kind: 'correct', level, newCombo, newShields, surge, tier }
}

export type ImpactVariant = 'correct-1' | 'correct-2' | 'correct-3' | 'shielded' | 'wrong'

/**
 * Maps an Outcome to the `data-impact` CSS variant (practice.css). Level 0
 * collapses into 'correct-1': there is no meaningfully distinct "level 0"
 * pulse worth its own keyframe set — the haptic/audio layers still treat
 * level 0 as its own value where the spec calls for it (see
 * docs/design/practice-feedback-loop.md SS3).
 */
export function impactVariant(outcome: Outcome): ImpactVariant {
  if (outcome.kind === 'wrong') return 'wrong'
  if (outcome.kind === 'shielded') return 'shielded'
  return `correct-${String(Math.max(1, outcome.level))}` as ImpactVariant
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/app/practice/feel.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck + lint this file alone**

Run: `pnpm typecheck && pnpm eslint src/app/practice/feel.ts src/app/practice/feel.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/practice/feel.ts src/app/practice/feel.test.ts
git commit -m "feat(practice): tier-aware combo/shield/impact engine (feel.ts)"
```

---

### Task 3: Haptics extension

**Files:**

- Modify: `src/app/practice/haptics.ts`
- Test: `src/app/practice/haptics.test.ts`

**Interfaces:**

- Consumes: `Outcome` from `./feel` (Task 2).
- Produces: `hapticImpact(outcome: Outcome): void` (new), alongside the untouched `hapticTick(): void` / `HAPTIC_TICK_MS` (still imported verbatim by `TraceRunner.tsx` — do not rename or remove either).

- [ ] **Step 1: Write the failing tests**

```typescript
// Append to src/app/practice/haptics.test.ts, inside a new describe block
// after the existing `describe('hapticTick', ...)` block. Add this import
// at the top alongside the existing one:
//   import { HAPTIC_TICK_MS, hapticImpact, hapticTick } from './haptics'
//   import type { Outcome } from './feel'

describe('hapticImpact', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'vibrate')

  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate
    if (originalDescriptor) {
      Object.defineProperty(Navigator.prototype, 'vibrate', originalDescriptor)
    }
  })

  function stubVibrate() {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
      writable: true,
    })
    return vibrate
  }

  it('correct level 0-1 uses the unchanged 15ms tick', () => {
    const vibrate = stubVibrate()
    hapticImpact({
      kind: 'correct',
      level: 0,
      newCombo: 1,
      newShields: 0,
      surge: false,
      tier: 'novice',
    })
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_TICK_MS)
    hapticImpact({
      kind: 'correct',
      level: 1,
      newCombo: 3,
      newShields: 1,
      surge: true,
      tier: 'novice',
    })
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_TICK_MS)
  })

  it('correct level 2 uses the three-beat pattern', () => {
    const vibrate = stubVibrate()
    hapticImpact({
      kind: 'correct',
      level: 2,
      newCombo: 6,
      newShields: 1,
      surge: true,
      tier: 'novice',
    })
    expect(vibrate).toHaveBeenCalledWith([12, 40, 18])
  })

  it('correct level 3 uses the five-beat pattern', () => {
    const vibrate = stubVibrate()
    hapticImpact({
      kind: 'correct',
      level: 3,
      newCombo: 9,
      newShields: 2,
      surge: true,
      tier: 'novice',
    })
    expect(vibrate).toHaveBeenCalledWith([12, 30, 18, 30, 26])
  })

  it('shielded uses its own three-beat pattern', () => {
    const vibrate = stubVibrate()
    hapticImpact({ kind: 'shielded', newCombo: 4, newShields: 1, tier: 'novice' })
    expect(vibrate).toHaveBeenCalledWith([10, 60, 10])
  })

  it('wrong uses a single 40ms buzz', () => {
    const vibrate = stubVibrate()
    hapticImpact({ kind: 'wrong', newCombo: 0, newShields: 0, tier: 'novice' })
    expect(vibrate).toHaveBeenCalledWith(40)
  })

  it('does not throw when navigator.vibrate is absent', () => {
    delete (navigator as { vibrate?: unknown }).vibrate
    expect(() => {
      hapticImpact({ kind: 'wrong', newCombo: 0, newShields: 0, tier: 'novice' })
    }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/practice/haptics.test.ts`
Expected: FAIL — `hapticImpact` is not exported.

- [ ] **Step 3: Implement**

```typescript
// Append to src/app/practice/haptics.ts (keep the existing hapticTick/
// HAPTIC_TICK_MS exports exactly as they are — TraceRunner.tsx calls
// hapticTick() directly and must be unaffected).
import type { Outcome } from './feel'

/** One vibration pattern per outcome — see docs/design/practice-feedback-loop.md SS5 for the full rationale (escalating with impact level, a distinct "caught" pattern for shielded). */
function patternFor(outcome: Outcome): number | number[] {
  if (outcome.kind === 'wrong') return 40
  if (outcome.kind === 'shielded') return [10, 60, 10]
  if (outcome.level >= 3) return [12, 30, 18, 30, 26]
  if (outcome.level === 2) return [12, 40, 18]
  return HAPTIC_TICK_MS
}

/** Same feature-detect + try/catch posture as hapticTick above — a missing/blocked haptic must never break the commit path. */
export function hapticImpact(outcome: Outcome): void {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(patternFor(outcome))
    } catch {
      // Degrade silently — haptic feedback is a nice-to-have, never load-bearing.
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/app/practice/haptics.test.ts`
Expected: PASS, all cases (old and new) green.

- [ ] **Step 5: Commit**

```bash
git add src/app/practice/haptics.ts src/app/practice/haptics.test.ts
git commit -m "feat(practice): escalating haptic patterns per impact outcome"
```

---

### Task 4: `feedbackSound.ts` — synthesized audio

**Files:**

- Create: `src/app/practice/feedbackSound.ts`
- Test: `src/app/practice/feedbackSound.test.ts`

**Interfaces:**

- Consumes: `Outcome` from `./feel`.
- Produces: `playFeedbackSound(outcome: Outcome, soundEnabled: boolean): void`, `resetFeedbackSoundForTests(): void` (mirrors `puzzleBodyCache.ts`'s `resetPuzzleBodyCacheForTests` convention for module-singleton test isolation).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/practice/feedbackSound.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { playFeedbackSound, resetFeedbackSoundForTests } from './feedbackSound'
import type { Outcome } from './feel'

const CORRECT: Outcome = {
  kind: 'correct',
  level: 1,
  newCombo: 3,
  newShields: 1,
  surge: true,
  tier: 'novice',
}

function stubAudioContext() {
  const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
  const gainNode = {
    gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
  }
  const filterNode = { type: '', frequency: { value: 0 }, connect: vi.fn().mockReturnThis() }
  const oscillatorNode = () => {
    const osc = {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn().mockReturnThis(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    oscillators.push(osc)
    return osc
  }
  const ctor = vi.fn().mockImplementation(() => ({
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    createGain: vi.fn().mockReturnValue(gainNode),
    createBiquadFilter: vi.fn().mockReturnValue(filterNode),
    createOscillator: vi.fn().mockImplementation(oscillatorNode),
  }))
  vi.stubGlobal('AudioContext', ctor)
  return { ctor, oscillators }
}

describe('playFeedbackSound', () => {
  afterEach(() => {
    resetFeedbackSoundForTests()
    vi.unstubAllGlobals()
  })

  it('does nothing when sound is disabled — no AudioContext is even constructed', () => {
    const { ctor } = stubAudioContext()
    playFeedbackSound(CORRECT, false)
    expect(ctor).not.toHaveBeenCalled()
  })

  it('constructs AudioContext lazily, once, and reuses it across calls', () => {
    const { ctor } = stubAudioContext()
    playFeedbackSound(CORRECT, true)
    playFeedbackSound(CORRECT, true)
    expect(ctor).toHaveBeenCalledTimes(1)
  })

  it('plays something (creates an oscillator) for correct/shielded/wrong outcomes', () => {
    const { oscillators } = stubAudioContext()
    playFeedbackSound(CORRECT, true)
    expect(oscillators.length).toBeGreaterThan(0)
    for (const osc of oscillators) {
      expect(osc.start).toHaveBeenCalled()
    }
  })

  it('does not throw when AudioContext is entirely unavailable', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => {
      playFeedbackSound(CORRECT, true)
    }).not.toThrow()
  })

  it('does not throw when the AudioContext constructor itself throws', () => {
    vi.stubGlobal(
      'AudioContext',
      vi.fn().mockImplementation(() => {
        throw new Error('blocked by permission policy')
      }),
    )
    expect(() => {
      playFeedbackSound(CORRECT, true)
    }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/practice/feedbackSound.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/app/practice/feedbackSound.ts
/**
 * Synthesizes Practice's impact audio via the Web Audio API — no `.mp3`/
 * `.wav` assets (bundle size + a network request on a route with a known
 * Lighthouse boot-cost flag, see docs/design/practice-feedback-loop.md SS6).
 *
 * AudioContext is constructed lazily, on the first actual call (a commit —
 * a genuine user gesture, satisfying autoplay policy), cached module-wide,
 * and resumed if the browser suspended it. Every call is wrapped in
 * try/catch and silent on failure — audio is a nice-to-have, same posture
 * as haptics.ts, never load-bearing for the commit flow.
 */
import type { Outcome } from './feel'

/** Someone's work laptop — keep this quiet even at full volume. */
const MASTER_GAIN = 0.15

let cachedContext: AudioContext | null = null

/** Exported so tests can reset the module-singleton AudioContext between cases — mirrors puzzleBodyCache.ts's resetPuzzleBodyCacheForTests convention. */
export function resetFeedbackSoundForTests(): void {
  cachedContext = null
}

function getAudioContext(): AudioContext | null {
  try {
    if (!cachedContext) {
      const Ctor = window.AudioContext
      if (!Ctor) return null
      cachedContext = new Ctor()
    }
    if (cachedContext.state === 'suspended') {
      void cachedContext.resume()
    }
    return cachedContext
  } catch {
    return null
  }
}

/** Root pitch (Hz) for the correct blip, before the per-level semitone offset. */
const CORRECT_ROOT_HZ = 660
/** Rising arpeggio across a streak — see docs/design/practice-feedback-loop.md SS6. */
const CORRECT_SEMITONE_OFFSETS: readonly [number, number, number, number] = [0, 2, 4, 7]

function semitoneToHz(rootHz: number, semitones: number): number {
  return rootHz * 2 ** (semitones / 12)
}

function playCorrect(ctx: AudioContext, level: 0 | 1 | 2 | 3): void {
  const now = ctx.currentTime
  const freq = semitoneToHz(CORRECT_ROOT_HZ, CORRECT_SEMITONE_OFFSETS[level])
  const master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(ctx.destination)

  const sine = ctx.createOscillator()
  sine.type = 'sine'
  sine.frequency.value = freq
  const sineGain = ctx.createGain()
  sineGain.gain.setValueAtTime(1, now)
  sineGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
  sine.connect(sineGain).connect(master)

  const triangle = ctx.createOscillator()
  triangle.type = 'triangle'
  triangle.frequency.value = freq * 2
  const triangleGain = ctx.createGain()
  triangleGain.gain.setValueAtTime(0.6, now)
  triangleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
  triangle.connect(triangleGain).connect(master)

  sine.start(now)
  triangle.start(now)
  sine.stop(now + 0.1)
  triangle.stop(now + 0.1)
}

function playShielded(ctx: AudioContext): void {
  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(ctx.destination)

  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = 220
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 800
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.8, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)
  osc.connect(filter).connect(gain).connect(master)
  osc.start(now)
  osc.stop(now + 0.13)
}

function playWrong(ctx: AudioContext): void {
  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(ctx.destination)

  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = 110
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 400
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.8, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
  osc.connect(filter).connect(gain).connect(master)
  osc.start(now)
  osc.stop(now + 0.19)
}

/** Gated on `preferences.sound` — when false, no AudioContext is even constructed (never mind played). */
export function playFeedbackSound(outcome: Outcome, soundEnabled: boolean): void {
  if (!soundEnabled) return
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    if (outcome.kind === 'wrong') {
      playWrong(ctx)
    } else if (outcome.kind === 'shielded') {
      playShielded(ctx)
    } else {
      playCorrect(ctx, outcome.level)
    }
  } catch {
    // Degrade silently — audio is a nice-to-have, never load-bearing.
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/app/practice/feedbackSound.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/practice/feedbackSound.ts src/app/practice/feedbackSound.test.ts
git commit -m "feat(practice): synthesize impact audio via Web Audio API"
```

---

### Task 5: `playImpact.ts` — combine haptics + audio behind one call

**Files:**

- Create: `src/app/practice/playImpact.ts`
- Test: `src/app/practice/playImpact.test.ts`

**Interfaces:**

- Consumes: `Outcome` from `./feel`, `hapticImpact` from `./haptics`, `playFeedbackSound` from `./feedbackSound`, `Preferences` from `../../storage`.
- Produces: `playImpact(outcome: Outcome, preferences: Preferences): void` — the one call `usePracticeSession.ts` (Task 6) makes in place of the current bare `hapticTick()`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/practice/playImpact.test.ts
import { describe, expect, it, vi } from 'vitest'
import { playImpact } from './playImpact'
import * as haptics from './haptics'
import * as feedbackSound from './feedbackSound'
import type { Outcome } from './feel'
import { DEFAULT_PREFERENCES } from '../../storage'

const WRONG: Outcome = { kind: 'wrong', newCombo: 0, newShields: 0, tier: 'novice' }

describe('playImpact', () => {
  it('calls hapticImpact unconditionally (haptics have no preference gate)', () => {
    const hapticSpy = vi.spyOn(haptics, 'hapticImpact').mockImplementation(() => undefined)
    vi.spyOn(feedbackSound, 'playFeedbackSound').mockImplementation(() => undefined)
    playImpact(WRONG, DEFAULT_PREFERENCES)
    expect(hapticSpy).toHaveBeenCalledWith(WRONG)
  })

  it('calls playFeedbackSound with the sound preference', () => {
    vi.spyOn(haptics, 'hapticImpact').mockImplementation(() => undefined)
    const soundSpy = vi
      .spyOn(feedbackSound, 'playFeedbackSound')
      .mockImplementation(() => undefined)
    playImpact(WRONG, { ...DEFAULT_PREFERENCES, sound: false })
    expect(soundSpy).toHaveBeenCalledWith(WRONG, false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/practice/playImpact.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/app/practice/playImpact.ts
/**
 * Single entry point usePracticeSession fires per answer — replaces the old
 * bare hapticTick() call. Combines haptics (Step 4b, ungated — a haptic
 * carries no separate on/off preference in this design) and synthesized
 * audio (Step 4c, gated on preferences.sound). Motion (Step 4a) is NOT part
 * of this call: it's driven declaratively by PuzzleCardShell's `impact`
 * prop / `data-impact` attribute + CSS, not an imperative side effect.
 */
import type { Outcome } from './feel'
import { hapticImpact } from './haptics'
import { playFeedbackSound } from './feedbackSound'
import type { Preferences } from '../../storage'

export function playImpact(outcome: Outcome, preferences: Preferences): void {
  hapticImpact(outcome)
  playFeedbackSound(outcome, preferences.sound)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/app/practice/playImpact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/practice/playImpact.ts src/app/practice/playImpact.test.ts
git commit -m "feat(practice): playImpact combines haptics + audio behind one call"
```

---

### Task 6: Preferences schema v13 (`sound`, `autoAdvance`)

**Files:**

- Modify: `src/storage/schema.ts`
- Modify: `src/storage/migrations.ts`
- Test: `src/storage/migrations.test.ts`
- Test (check, edit if needed): `src/storage/schema.test.ts`

**Interfaces:**

- Produces: `Preferences.sound: boolean`, `Preferences.autoAdvance: boolean`, `DEFAULT_PREFERENCES` with both `true`, `CURRENT_SCHEMA_VERSION = 13`, `MIGRATIONS[12]`.

- [ ] **Step 1: Check whether `schema.test.ts` pins the old version/defaults literally**

Run: `grep -n "CURRENT_SCHEMA_VERSION\|DEFAULT_PREFERENCES" src/storage/schema.test.ts`

If it asserts `CURRENT_SCHEMA_VERSION === 12` or `DEFAULT_PREFERENCES` without `sound`/`autoAdvance`, update those literals in this task (not a separate one — same deliverable).

- [ ] **Step 2: Write the failing migration test**

```typescript
// Add to src/storage/migrations.test.ts, alongside the other
// MIGRATIONS[N] describe blocks. Uses the same shape as the existing
// MIGRATIONS[9] (v9->v10, adds preferences) test above it in the file.

describe('MIGRATIONS[12]: v12 -> v13 (practice feedback loop: adds sound + autoAdvance)', () => {
  it('stamps schema_version 13, adds sound+autoAdvance defaulted true, and preserves every existing preference value inside the nested object', () => {
    const v12Profile = {
      schema_version: 12,
      rating: 1702.0,
      ratedAttemptCount: 61,
      streak: { currentStreak: 9, longestStreak: 30, lastActiveDate: '2026-09-01' },
      requeueState: [{ puzzleId: 'p9', stage: 2, served: 4 }],
      storagePersisted: true,
      dailyCompletion: { date: '2026-09-01', attemptId: 'a30', correct: true },
      rushStats: { bestScore: 70, bestStreak: 40, runs: 20, lastRunAt: '2026-08-30T09:00:00.000Z' },
      bestRunStreak: 22,
      bossStats: {
        bestDepth: 10,
        clears: 4,
        runs: 10,
        lastRunAt: '2026-08-31T12:00:00.000Z',
        bestRunSplits: [800, 1700, 2600],
      },
      missionProgress: null,
      missionStats: {
        completions: 3,
        lastRunAt: '2026-08-29T10:00:00.000Z',
        lastCompletedAt: '2026-08-29T10:05:00.000Z',
      },
      // Deliberately non-default values on every existing preference key —
      // the assertion below must prove these survive the nested merge, not
      // just that the object still exists.
      preferences: { timerOnTrace: true, reducedMotion: true, codeFontSize: 'lg', theme: 'blue' },
      anonId: 'anon-feel-1',
      challengerName: 'Alex',
      firstRunCompleted: true,
    }

    const v12Migration = MIGRATIONS[12]
    if (!v12Migration) throw new Error('MIGRATIONS[12] is not registered')
    const migrated = v12Migration(v12Profile)

    expect(migrated).toEqual({
      ...v12Profile,
      schema_version: 13,
      preferences: {
        timerOnTrace: true,
        reducedMotion: true,
        codeFontSize: 'lg',
        theme: 'blue',
        sound: true,
        autoAdvance: true,
      },
    })
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run src/storage/migrations.test.ts`
Expected: FAIL — `MIGRATIONS[12]` is undefined.

- [ ] **Step 4: Edit `schema.ts`**

Bump `export const CURRENT_SCHEMA_VERSION = 13`. Replace the `PreferencesSchema` doc comment's closing parenthetical ("...sound and a second theme mode don't exist in the codebase today") with why sound now exists, and add the two new fields plus their own bullets to the doc comment body:

```typescript
/**
 * v4 Phase 4.1 ("Settings, for real"): device/UX preferences, versioned and
 * carried through export/import like every other UserProfile field — the
 * whole point being that v5's account sync picks these up for free without
 * a separate preferences payload. Each field earns its place:
 *
 * - `timerOnTrace`: makes todo 14's "no timer on regular trace mode"
 *   (TracePage.tsx's hardcoded `timed={false}`) a preference instead of a
 *   hardcode, so a player who wants the per-checkpoint clock can opt in.
 * - `reducedMotion`: an app-level override independent of the OS's own
 *   `prefers-reduced-motion` — the codebase has no reduced-motion handling
 *   of any kind today (grep-verified), so this is the first place it's
 *   respected at all.
 * - `codeFontSize`: drives the single global `--font-size-code` token every
 *   code surface already reads (CodeSnippet.tsx, practice.css) — one token,
 *   zero per-component changes needed.
 * - `theme`: which accent/surface palette applies app-wide (`index.css`'s
 *   `[data-app-theme]` overrides) — 'default' is exactly today's shipped
 *   lime-on-near-black look; 'blue'/'slate' are new dark directions and
 *   'light' is a light-surfaced variant of the same brand accent (deepened
 *   to a legible shade for light backgrounds — see index.css's own comment
 *   on why the raw neon lime can't just be reused as-is).
 * - `sound` (practice feedback loop, v13): Practice's synthesized impact
 *   audio (feedbackSound.ts) — added because Practice now has audio at
 *   all, where before this repo had none anywhere (grep-verified at the
 *   time). Defaults `true`; the escape hatch is a one-tap mute in
 *   StatusBar (something that makes noise unprompted needs a kill switch
 *   in the moment, not just a settings toggle) — see StatusBar.tsx.
 * - `autoAdvance` (practice feedback loop, v13): whether a correct commit
 *   auto-advances Practice's PuzzleCardShell after a beat instead of
 *   waiting for a Continue tap — see PuzzleCardShell.tsx's `autoAdvanceMs`
 *   prop. Defaults `true`.
 */
export const PreferencesSchema = z.object({
  timerOnTrace: z.boolean(),
  reducedMotion: z.boolean(),
  codeFontSize: z.enum(['sm', 'md', 'lg']),
  theme: z.enum(['default', 'blue', 'slate', 'light']),
  sound: z.boolean(),
  autoAdvance: z.boolean(),
})

export interface Preferences {
  timerOnTrace: boolean
  reducedMotion: boolean
  codeFontSize: 'sm' | 'md' | 'lg'
  theme: 'default' | 'blue' | 'slate' | 'light'
  sound: boolean
  autoAdvance: boolean
}

/** Every default matches today's actual shipped behavior EXCEPT sound/autoAdvance, which are new mechanics defaulted on — see PreferencesSchema's own doc comment for why. */
export const DEFAULT_PREFERENCES: Preferences = {
  timerOnTrace: false,
  reducedMotion: false,
  codeFontSize: 'md',
  theme: 'default',
  sound: true,
  autoAdvance: true,
}
```

- [ ] **Step 5: Edit `migrations.ts`**

```typescript
// Append before the MIGRATIONS export in src/storage/migrations.ts:

/**
 * v12 -> v13: the practice feedback loop adds `sound` and `autoAdvance` —
 * see src/storage/schema.ts's PreferencesSchema doc comment. Unlike every
 * migration above it, this one merges new keys INTO the existing nested
 * `preferences` object rather than adding a top-level field — every other
 * preference value on the profile must survive untouched. Both new keys
 * default `true` for every existing profile (see DEFAULT_PREFERENCES'
 * own doc comment for why sound defaults on despite being new/unprompted
 * noise — StatusBar's mute toggle is the matching escape hatch).
 */
function migrateV12ToV13(raw: Record<string, unknown>): Record<string, unknown> {
  const preferences = raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {}
  return {
    ...raw,
    schema_version: 13,
    preferences: { ...preferences, sound: true, autoAdvance: true },
  }
}

// And register it:
export const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
  4: migrateV4ToV5,
  5: migrateV5ToV6,
  6: migrateV6ToV7,
  7: migrateV7ToV8,
  8: migrateV8ToV9,
  9: migrateV9ToV10,
  10: migrateV10ToV11,
  11: migrateV11ToV12,
  12: migrateV12ToV13,
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run src/storage/migrations.test.ts src/storage/schema.test.ts`
Expected: PASS. Also run `pnpm vitest run src/storage` to catch any other test in that directory pinning `CURRENT_SCHEMA_VERSION`/`DEFAULT_PREFERENCES` (e.g. `exportImport.test.ts`, `profile.test.ts`) — fix any literal mismatches the same way.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no errors — this is the step that will surface every other file constructing a `Preferences` object literally (search first: `grep -rn "timerOnTrace:" src --include="*.ts" --include="*.tsx"` to find them proactively) missing the two new required fields.

- [ ] **Step 8: Commit**

```bash
git add src/storage/schema.ts src/storage/migrations.ts src/storage/migrations.test.ts
git commit -m "feat(storage): v13 preferences migration adds sound + autoAdvance"
```

---

### Task 7: `usePracticeSession.ts` — route answers through `resolveOutcome`

**Files:**

- Modify: `src/app/practice/usePracticeSession.ts`
- Modify: `src/app/practice/usePracticeSession.test.ts`

**Interfaces:**

- Consumes: `resolveOutcome`, `Outcome` from `./feel` (Task 2); `playImpact` from `./playImpact` (Task 5); `Preferences` from `../../storage` (already imported via `UserProfile`).
- Produces: `PracticeSession.shields: number`, `PracticeSession.lastOutcome: Outcome | null` (new fields other tasks — StatusBar, PuzzleCardShell wiring, ComboSurge — read from).
- Removes from `PracticeSession`: `streakPause`, `handleStreakPauseKeepGoing`, `handleStreakPauseDoneForNow` (Practice no longer uses the blocking modal — Task 10 replaces it with `ComboSurge`, driven off `lastOutcome` instead).

- [ ] **Step 1: Update imports and state**

```typescript
// In src/app/practice/usePracticeSession.ts, replace:
//   import { resolveStreakPause } from '../streakPauseLogic'
//   import type { StreakPauseState } from '../streakPauseLogic'
// with:
import { resolveOutcome } from './feel'
import type { Outcome } from './feel'
import { playImpact } from './playImpact'

// Remove the hapticTick import/usage entirely from this file (haptics now
// only fire via playImpact) — but do NOT touch src/app/practice/haptics.ts's
// hapticTick export itself, TraceRunner.tsx still calls it directly.
```

```typescript
// State: replace
//   const [streakPause, setStreakPause] = useState<StreakPauseState | null>(null)
// with
const [shields, setShields] = useState(0)
const [lastOutcome, setLastOutcome] = useState<Outcome | null>(null)
```

- [ ] **Step 2: Update the `PracticeSession` interface**

Remove from the interface: `streakPause: StreakPauseState | null`, `handleStreakPauseKeepGoing: () => void`, `handleStreakPauseDoneForNow: () => void`. Add, near `combo`:

```typescript
/** Session-only banked shields (feel.ts) — same lifetime as `combo`, never persisted to the profile. */
shields: number
/** The Outcome (feel.ts) `resolveOutcome` produced for the most recent handleAnswered call — null before any answer this session. Drives PuzzleCardShell's `impact`/`autoAdvanceMs` props and ComboSurge. */
lastOutcome: Outcome | null
```

Update the `streakAttempts` field's doc comment: it currently says "Cleared on a miss so the link always encodes the live streak." — narrow this to "Cleared on an _unshielded_ miss" per Step 3 below.

- [ ] **Step 3: Rewrite the combo/shield transition inside `handleAnswered`**

```typescript
// Replace this block:
//   const newCombo = payload.correct ? combo + 1 : 0
//   const pause = resolveStreakPause(newCombo, profile.bestRunStreak)
//   const updatedProfile: UserProfile = {
//     ...profile,
//     rating: newRating,
//     ratedAttemptCount: profile.ratedAttemptCount + 1,
//     requeueState: newRequeueState,
//     bestRunStreak: pause?.isNewBest ? newCombo : profile.bestRunStreak,
//   }
// with:

const outcome = resolveOutcome({ correct: payload.correct, combo, shields, rating: oldRating })
// Re-expresses the old resolveStreakPause(...).isNewBest gating (only ever
// updated on a streak-pause-eligible crossing) against the new tier-aware
// surge check — same behavior, new threshold. See
// docs/design/practice-feedback-loop.md SS9.
const isNewBestStreak =
  outcome.kind === 'correct' && outcome.surge && outcome.newCombo > profile.bestRunStreak

const updatedProfile: UserProfile = {
  ...profile,
  rating: newRating,
  ratedAttemptCount: profile.ratedAttemptCount + 1,
  requeueState: newRequeueState,
  bestRunStreak: isNewBestStreak ? outcome.newCombo : profile.bestRunStreak,
}
```

- [ ] **Step 4: Update the state-setting block**

```typescript
// Replace:
//   setCombo(newCombo)
// with:
setCombo(outcome.newCombo)
setShields(outcome.newShields)
setLastOutcome(outcome)
```

```typescript
// Replace the streakAttempts branch:
//   if (payload.correct) {
//     setSolvedThisSession((s) => s + 1)
//     setStreakAttempts((prev) => [
//       ...prev,
//       { puzzleId: puzzle.id, correct: true, time_ms: timeMs },
//     ])
//   } else {
//     setStreakAttempts([])
//   }
// with:
if (payload.correct) {
  setSolvedThisSession((s) => s + 1)
  setStreakAttempts((prev) => [...prev, { puzzleId: puzzle.id, correct: true, time_ms: timeMs }])
} else if (outcome.kind === 'wrong') {
  // A shielded miss leaves streakAttempts untouched — the streak survived,
  // so the challenge link should still encode it (see this field's own
  // doc comment). Only a real, unshielded wrong clears it.
  setStreakAttempts([])
}
```

```typescript
// Replace:
//   if (pause) {
//     setStreakPause(pause)
//     trackStreakPause({ mode: 'practice', streak: pause.streak, is_new_best: pause.isNewBest })
//   }
// with:
if (outcome.kind === 'correct' && outcome.surge) {
  trackStreakPause({
    mode: 'practice',
    streak: outcome.newCombo,
    is_new_best: isNewBestStreak,
    tier: outcome.tier,
    shields_banked: outcome.newShields,
  })
}
if (outcome.kind === 'shielded') {
  trackComboShieldUsed({
    tier: outcome.tier,
    combo: outcome.newCombo,
    shields_remaining: outcome.newShields,
  })
}
```

`trackComboShieldUsed` is added to the telemetry import list in Task 14 — add it to this file's `import { ... } from '../../telemetry'` line in that task, not here, to keep this task's diff focused on the outcome-routing logic. If Task 14 hasn't landed yet when this task runs, stub the call behind a `// TODO(Task 14): trackComboShieldUsed` comment instead — do not leave an unresolved import.

- [ ] **Step 5: Extend the `trackAttempt` call**

```typescript
// Replace the existing trackAttempt({...}) call's payload with the three
// new fields (impact_level is 0 for wrong/shielded — the escalation
// concept only applies to correct answers, see
// docs/design/practice-feedback-loop.md SS10):
trackAttempt({
  puzzle_id: puzzle.id,
  correct: payload.correct,
  time_ms: timeMs,
  mode: 'practice',
  interaction: puzzle.interaction,
  user_rating_before: oldRating,
  user_rating_after: newRating,
  combo: outcome.newCombo,
  impact_level: outcome.kind === 'correct' ? outcome.level : 0,
  rating_tier: outcome.tier,
})
```

- [ ] **Step 6: Replace the `hapticTick()` call**

```typescript
// Replace the trailing:
//   hapticTick()
// with:
playImpact(outcome, updatedProfile.preferences)
```

- [ ] **Step 7: Remove `handleStreakPauseKeepGoing`/`handleStreakPauseDoneForNow` and the return object's now-removed fields**

Delete both callback definitions and the two corresponding lines from the returned object; also remove `streakPause` from the returned object (replace with `shields`, `lastOutcome`).

- [ ] **Step 8: Rewrite the `usePracticeSession.test.ts` streak-pause block**

Delete the entire `describe('streak-pause (Phase 5b Item 7/8)', ...)` block (currently the ~130 lines directly preceding `describe('content-metadata-lazy-load Task 5: ...')` — confirm the exact boundary with `grep -n "describe('streak-pause\|describe('content-metadata-lazy-load" src/app/practice/usePracticeSession.test.ts` before deleting) and replace it with:

```typescript
describe('combo/shield economy (feel.ts)', () => {
  it('a correct answer increments combo and shields stay at 0 below the first surge', async () => {
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    expect(result.current.combo).toBe(1)
    expect(result.current.shields).toBe(0)
    expect(result.current.lastOutcome).toMatchObject({ kind: 'correct', newCombo: 1 })
  })

  it('a surge crossing (novice, combo step 3) banks a shield and fires streak_pause with tier + shields_banked', async () => {
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    act(() => {
      result.current.handleContinue()
    })
    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    act(() => {
      result.current.handleContinue()
    })
    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 }) // combo -> 3, novice surge
    })

    expect(result.current.combo).toBe(3)
    expect(result.current.shields).toBe(1)
    expect(trackStreakPause).toHaveBeenCalledWith({
      mode: 'practice',
      streak: 3,
      is_new_best: true,
      tier: 'novice',
      shields_banked: 1,
    })
    expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ bestRunStreak: 3 }))
  })

  it('a wrong answer with a banked shield is shielded: combo holds, streakAttempts is untouched, a shield is spent', async () => {
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    // Bank one shield first (3 correct in a row, novice).
    for (let i = 0; i < 3; i++) {
      act(() => {
        result.current.handleAnswered({ correct: true, choiceIndex: 0 })
      })
      if (i < 2) {
        act(() => {
          result.current.handleContinue()
        })
      }
    }
    expect(result.current.shields).toBe(1)
    const streakAttemptsBeforeMiss = result.current.streakAttempts

    act(() => {
      result.current.handleAnswered({ correct: false, choiceIndex: 1 })
    })

    expect(result.current.combo).toBe(3) // held, not reset
    expect(result.current.shields).toBe(0) // spent
    expect(result.current.streakAttempts).toEqual(streakAttemptsBeforeMiss) // untouched
    expect(result.current.lastOutcome).toMatchObject({
      kind: 'shielded',
      newCombo: 3,
      newShields: 0,
    })
    expect(trackComboShieldUsed).toHaveBeenCalledWith({
      tier: 'novice',
      combo: 3,
      shields_remaining: 0,
    })
  })

  it('a wrong answer with no shield resets combo, shields, and streakAttempts', async () => {
    const { result } = renderHook(() => usePracticeSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    act(() => {
      result.current.handleAnswered({ correct: false, choiceIndex: 1 })
    })

    expect(result.current.combo).toBe(0)
    expect(result.current.shields).toBe(0)
    expect(result.current.streakAttempts).toHaveLength(0)
    expect(result.current.lastOutcome).toMatchObject({ kind: 'wrong' })
  })
})
```

Also update the mocked telemetry import list at the top of the file (`vi.mock('../../telemetry', ...)`) to include `trackComboShieldUsed` as a `vi.fn()`, alongside the existing `trackStreakPause` mock — check the exact mock shape with `grep -n "vi.mock('../../telemetry'" -A 15 src/app/practice/usePracticeSession.test.ts` first and follow its existing pattern.

- [ ] **Step 9: Search for any other test/file referencing the removed fields**

Run: `grep -rn "streakPause\|handleStreakPauseKeepGoing\|handleStreakPauseDoneForNow" src/app/practice`
Expected after this task: zero remaining references inside `src/app/practice/` (Task 13 removes `PracticePage.tsx`'s own usage in the same sweep — if this task runs before Task 13, `PracticePage.tsx` will fail to typecheck referencing the now-removed fields; land Task 13 immediately after this one, or leave a `// TODO(Task 13)` stub — do not leave the build red between commits longer than necessary).

- [ ] **Step 10: Run the full test file**

Run: `pnpm vitest run src/app/practice/usePracticeSession.test.ts`
Expected: PASS — every prior case (rating math, requeue, filters, stale-while-revalidate, prefetch) plus the new combo/shield block.

- [ ] **Step 11: Commit**

```bash
git add src/app/practice/usePracticeSession.ts src/app/practice/usePracticeSession.test.ts
git commit -m "feat(practice): route answers through resolveOutcome (combo/shield economy)"
```

---

### Task 8: `PuzzleCardShell.tsx` — auto-advance + `data-impact`

**Files:**

- Modify: `src/app/practice/PuzzleCardShell.tsx`
- Modify: `src/app/practice/PuzzleCardShell.test.tsx`

**Interfaces:**

- Consumes: `ImpactVariant` from `./feel` (Task 2) — imported only for the prop's type, no runtime logic duplicated here.
- Produces: new optional props `autoAdvanceMs?: number`, `onAutoAdvanceResolved?: (cancelled: boolean) => void`, `impact?: ImpactVariant | null` on `PuzzleCardShellProps`. Every existing prop/behavior is unchanged; all seven current callers keep compiling with zero edits since every new prop is optional.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to src/app/practice/PuzzleCardShell.test.tsx, in a new
// describe('auto-advance', () => { ... }) block. Uses fake timers — check
// the file's existing `describe('forcedCommit ...')` block (around line
// 573) for this repo's established fake-timer setup/teardown pattern in
// this exact file before writing these.

describe('auto-advance', () => {
  it('does not auto-advance a wrong answer even when autoAdvanceMs is set', async () => {
    vi.useFakeTimers()
    const onContinue = vi.fn()
    // Use this file's existing mcq fixture puzzle (see the top-of-file
    // fixtures used by earlier describe blocks) and commit its known
    // WRONG choice via the existing commit-simulation pattern.
    render(
      <PuzzleCardShell
        puzzle={puzzle}
        ratingDelta={-9}
        onAnswered={vi.fn()}
        onContinue={onContinue}
        autoAdvanceMs={1400}
      />,
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(onContinue).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('auto-advances a correct answer after autoAdvanceMs elapses', async () => {
    vi.useFakeTimers()
    const onContinue = vi.fn()
    render(
      <PuzzleCardShell
        puzzle={puzzle}
        ratingDelta={12}
        onAnswered={vi.fn()}
        onContinue={onContinue}
        autoAdvanceMs={1400}
      />,
    )
    // commit the correct choice
    await vi.advanceTimersByTimeAsync(1400)
    expect(onContinue).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('cancels the countdown on a pointerdown inside the card (not on the Continue button) and never fires afterward', async () => {
    vi.useFakeTimers()
    const onContinue = vi.fn()
    const onAutoAdvanceResolved = vi.fn()
    render(
      <PuzzleCardShell
        puzzle={puzzle}
        ratingDelta={12}
        onAnswered={vi.fn()}
        onContinue={onContinue}
        autoAdvanceMs={1400}
        onAutoAdvanceResolved={onAutoAdvanceResolved}
      />,
    )
    // commit correct, advance timers partway, then fireEvent.pointerDown
    // on the feedback panel (NOT the Continue button)
    await vi.advanceTimersByTimeAsync(2000)
    expect(onContinue).not.toHaveBeenCalled()
    expect(onAutoAdvanceResolved).toHaveBeenCalledWith(true)
    vi.useRealTimers()
  })

  it('tapping Continue during the countdown advances immediately and reports cancelled: false', async () => {
    vi.useFakeTimers()
    const onContinue = vi.fn()
    // commit correct, autoAdvanceMs set, fireEvent.click the Continue
    // button directly before the timer fires
    expect(onContinue).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('skips auto-advance entirely when autoAdvanceMs is undefined (every existing caller)', async () => {
    vi.useFakeTimers()
    const onContinue = vi.fn()
    // commit correct, NO autoAdvanceMs prop
    await vi.advanceTimersByTimeAsync(5000)
    expect(onContinue).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('sets data-impact on .puzzle-card once committed, matching the impact prop', async () => {
    render(
      <PuzzleCardShell
        puzzle={puzzle}
        ratingDelta={12}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
        impact="correct-2"
      />,
    )
    // commit correct
    expect(document.querySelector('.puzzle-card')).toHaveAttribute('data-impact', 'correct-2')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/practice/PuzzleCardShell.test.tsx`
Expected: existing cases still PASS (baseline check), new `describe('auto-advance', ...)` cases FAIL — props don't exist yet.

- [ ] **Step 3: Implement — props + countdown state**

```typescript
// In PuzzleCardShellProps, add after `sidebarSlot`:
/** ms to wait before auto-advancing after a CORRECT commit. Omitted = today's behavior (Continue is the only way forward). Practice is currently the only caller that passes it. */
autoAdvanceMs?: number | undefined
/** Fires once the auto-advance countdown resolves — true if cancelled by interaction/visibility, false if it ran to completion and advanced. Never fires when autoAdvanceMs is omitted, or for a wrong commit (auto-advance never starts). */
onAutoAdvanceResolved?: (cancelled: boolean) => void
/** data-impact variant (feel.ts's ImpactVariant) to stamp on .puzzle-card once committed — drives practice.css's motion keyframes. Omitted/null renders no attribute (every non-Practice caller). */
impact?: ImpactVariant | null
```

```typescript
// Add to the component's destructured props:
autoAdvanceMs,
onAutoAdvanceResolved,
impact = null,
```

```typescript
// New state + effects, placed after the existing continueButtonRef focus
// effect (so it reads `committed`/`committedPayload` already in scope).
// Cancel listeners are attached to cardRef.current AND (mobile-only) the
// sticky feedback drawer's own root — the drawer is a DOM SIBLING of
// .puzzle-card, not a descendant, so cardRef alone would miss taps inside
// it (see the drawer's own render block further down this file).
const drawerRef = useRef<HTMLDivElement | null>(null)
const [autoAdvanceStartedAt, setAutoAdvanceStartedAt] = useState<number | null>(null)
const autoAdvanceResolvedRef = useRef(false)

useEffect(() => {
  autoAdvanceResolvedRef.current = false
  setAutoAdvanceStartedAt(null)
  if (!committed || !committedPayload?.correct || autoAdvanceMs === undefined) return
  setAutoAdvanceStartedAt(Date.now())
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [committed, puzzle.id])

useEffect(() => {
  if (autoAdvanceStartedAt === null || autoAdvanceMs === undefined) return

  const resolve = (cancelled: boolean) => {
    if (autoAdvanceResolvedRef.current) return
    autoAdvanceResolvedRef.current = true
    setAutoAdvanceStartedAt(null)
    onAutoAdvanceResolved?.(cancelled)
    if (!cancelled) onContinue()
  }

  const timer = window.setTimeout(() => {
    resolve(false)
  }, autoAdvanceMs)

  const cancelOnInteraction = (event: Event) => {
    if (event.target instanceof Node && continueButtonRef.current?.contains(event.target)) return
    resolve(true)
  }
  const cancelOnHidden = () => {
    if (document.hidden) resolve(true)
  }

  const targets = [cardRef.current, drawerRef.current].filter(
    (el): el is HTMLDivElement => el !== null,
  )
  for (const el of targets) {
    el.addEventListener('pointerdown', cancelOnInteraction)
    el.addEventListener('keydown', cancelOnInteraction)
  }
  document.addEventListener('visibilitychange', cancelOnHidden)

  return () => {
    window.clearTimeout(timer)
    for (const el of targets) {
      el.removeEventListener('pointerdown', cancelOnInteraction)
      el.removeEventListener('keydown', cancelOnInteraction)
    }
    document.removeEventListener('visibilitychange', cancelOnHidden)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [autoAdvanceStartedAt, autoAdvanceMs])
```

Attach `ref={drawerRef}` to the existing `<div className={FEEDBACK_DRAWER_CLASS}>` element further down this file (the mobile sticky drawer) — it currently has no ref.

- [ ] **Step 4: Implement — `data-impact` + draining Continue button**

```typescript
// On the .puzzle-card div, add:
data-impact={committed ? (impact ?? undefined) : undefined}
```

```typescript
// ContinueCta needs a draining-fill visual while autoAdvanceStartedAt is
// non-null. Both placements (mobile drawer's FEEDBACK_CONTINUE_CLASS
// button, desktop's DESKTOP_CONTINUE_CLASS button) already share this one
// component, so this is a single change:
function ContinueCta({
  className,
  destination,
  onContinue,
  buttonRef,
  autoAdvanceMs,
}: {
  className: string
  destination: ContinueDestination
  onContinue: () => void
  buttonRef?: RefObject<HTMLButtonElement | null>
  autoAdvanceMs?: number
}) {
  return (
    <button
      type="button"
      className={`${className} continue-cta`}
      style={
        autoAdvanceMs !== undefined
          ? ({ '--auto-advance-ms': `${String(autoAdvanceMs)}ms` } as CSSProperties)
          : undefined
      }
      data-draining={autoAdvanceMs !== undefined ? 'true' : undefined}
      onClick={onContinue}
      ref={buttonRef}
    >
      {continueLabel(destination)}
      <ContinueIcon destination={destination} />
    </button>
  )
}
```

Pass `autoAdvanceMs={autoAdvanceStartedAt !== null ? autoAdvanceMs : undefined}` from both of `PuzzleCardShell`'s two `<ContinueCta>` call sites (desktop's `desktopResult` block and mobile's drawer block). Import `CSSProperties` from `'react'` at the top of the file.

- [ ] **Step 5: Run to verify the new tests pass and old ones are unaffected**

Run: `pnpm vitest run src/app/practice/PuzzleCardShell.test.tsx`
Expected: PASS — all pre-existing cases (unchanged, since every new prop defaults to inert) plus the new `auto-advance` block.

- [ ] **Step 6: Run every other file that renders `PuzzleCardShell`**

Run: `grep -rl "PuzzleCardShell" src/app --include="*.tsx" | grep -v "PuzzleCardShell.tsx\|PuzzleCardShell.test.tsx"` to find every consumer, then run the matching test files for each result.
Expected: PASS, zero behavior change for callers that don't pass the new props.

- [ ] **Step 7: Commit**

```bash
git add src/app/practice/PuzzleCardShell.tsx src/app/practice/PuzzleCardShell.test.tsx
git commit -m "feat(practice): opt-in auto-advance + data-impact on PuzzleCardShell"
```

---

### Task 9: Motion — `practice.css` keyframes + reduced-motion

**Files:**

- Modify: `src/app/practice/practice.css`

**Interfaces:** None (pure CSS) — consumes the `data-impact` attribute values (`correct-1`/`correct-2`/`correct-3`/`shielded`/`wrong`) and `continue-cta[data-draining='true']`/`--auto-advance-ms` from Task 8, and the existing `[data-reduced-motion='true']` convention from `src/index.css`.

- [ ] **Step 1: Append the impact keyframes and draining-button styles**

Append to `src/app/practice/practice.css` (after the existing drag-order block — do not touch anything above it, per the file's own "swipe-fallback/drag-order left untouched" header comment):

```css
/* --- practice feedback loop: impact motion --------------------------------
 * Driven entirely by PuzzleCardShell.tsx's `data-impact` attribute on
 * `.puzzle-card` (feel.ts's ImpactVariant) — pure CSS, no JS animation
 * driver. Cleared for free when the shell remounts on the next puzzle
 * (key={puzzle.id} at PracticePage's call site), so no explicit cleanup
 * rule is needed here. Every transform stays under ~1.02 scale (this is a
 * card with code in it, not a slot machine) — see
 * docs/design/practice-feedback-loop.md section 7.
 */

@keyframes practice-pulse-1 {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.006);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes practice-pulse-2 {
  0% {
    transform: scale(1);
  }
  35% {
    transform: scale(1.012);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes practice-pulse-3 {
  0% {
    transform: scale(1);
  }
  30% {
    transform: scale(1.02);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes practice-glow-1 {
  0% {
    box-shadow: 0 0 0 0 var(--ok-dim);
  }
  40% {
    box-shadow: 0 0 0 3px var(--ok-dim);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

@keyframes practice-glow-3 {
  0% {
    box-shadow: 0 0 0 0 var(--accent);
  }
  30% {
    box-shadow: 0 0 0 6px var(--ok-dim);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

@keyframes practice-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-4px);
  }
  40% {
    transform: translateX(4px);
  }
  60% {
    transform: translateX(-4px);
  }
  80% {
    transform: translateX(4px);
  }
}

@keyframes practice-shield-pulse {
  0% {
    box-shadow: 0 0 0 0 var(--accent-dim);
    transform: scale(1);
  }
  40% {
    box-shadow: 0 0 0 4px var(--accent-dim);
    transform: scale(0.996);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
    transform: scale(1);
  }
}

.puzzle-card[data-impact='correct-1'] {
  animation:
    practice-pulse-1 0.32s ease-out,
    practice-glow-1 0.4s ease-out;
}

.puzzle-card[data-impact='correct-2'] {
  animation:
    practice-pulse-2 0.34s ease-out,
    practice-glow-1 0.45s ease-out;
}

.puzzle-card[data-impact='correct-3'] {
  animation:
    practice-pulse-3 0.36s ease-out,
    practice-glow-3 0.5s ease-out;
}

.puzzle-card[data-impact='wrong'] {
  animation: practice-shake 0.2s ease-in-out;
  box-shadow: 0 0 0 2px var(--danger-dim);
}

/* Shielded: no shake — reads as "caught," not a failure. */
.puzzle-card[data-impact='shielded'] {
  animation: practice-shield-pulse 0.36s ease-out;
}

/* Both the app-level preference override AND the OS-level media query drop
 * every transform, keeping colour-only feedback — mirrors src/index.css's
 * own [data-reduced-motion='true'] kill-switch pattern exactly, scoped
 * here to just these new rules. */
[data-reduced-motion='true'] .puzzle-card[data-impact] {
  animation: none !important;
  box-shadow: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .puzzle-card[data-impact] {
    animation: none !important;
    box-shadow: none !important;
  }
}

/* --- practice feedback loop: auto-advance draining Continue button ------- */

@keyframes continue-cta-drain {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}

.continue-cta[data-draining='true'] {
  position: relative;
  overflow: hidden;
}

.continue-cta[data-draining='true']::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgb(255 255 255 / 18%);
  animation: continue-cta-drain var(--auto-advance-ms, 1400ms) linear forwards;
  pointer-events: none;
}

[data-reduced-motion='true'] .continue-cta[data-draining='true']::after {
  animation: none !important;
  width: 0 !important;
}

@media (prefers-reduced-motion: reduce) {
  .continue-cta[data-draining='true']::after {
    animation: none !important;
    width: 0 !important;
  }
}

/* --- practice feedback loop: promoted feedback-panel delta --------------- */

@keyframes feedback-delta-scale-in {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.scale-in {
  animation: feedback-delta-scale-in 0.22s ease-out;
}

[data-reduced-motion='true'] .scale-in {
  animation: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .scale-in {
    animation: none !important;
  }
}
```

- [ ] **Step 2: Manual sanity check (no automated CSS test exists in this repo)**

Use the `run` skill (or `pnpm dev`) and, in dev-puzzle-mode, answer a few Practice puzzles correctly in a row to confirm the card pulses and the Continue button visibly drains; answer wrong to confirm the shake; verify a shielded miss (bank a shield first) shows no shake. Toggle `prefers-reduced-motion` in devtools and confirm animations disappear but colours (danger/accent borders) still change.

- [ ] **Step 3: Commit**

```bash
git add src/app/practice/practice.css
git commit -m "feat(practice): impact motion keyframes + draining auto-advance fill"
```

---

### Task 10: `useNumberTween.ts` — promoted delta + tweened rating pill

**Files:**

- Create: `src/app/practice/useNumberTween.ts`
- Test: `src/app/practice/useNumberTween.test.ts`
- Modify: `src/app/practice/PuzzleCardShell.tsx` (`FeedbackHeader`)
- Modify: `src/app/practice/StatusBar.tsx`
- Modify: `src/app/practice/StatusBar.test.tsx`

**Interfaces:**

- Produces: `useNumberTween(target: number, durationMs: number, options?: { animateOnMount?: boolean }): number`. Default (`animateOnMount` falsy/omitted): snaps straight to `target` on first mount, animates from the previously-returned value to a new `target` on every subsequent change — this is `StatusBar`'s shape (never animate on page load, only on a real rating change). With `animateOnMount: true`: starts at 0 and animates up to `target` on mount too — this is `FeedbackHeader`'s shape (each commit is a fresh mount of the delta).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/practice/useNumberTween.test.ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNumberTween } from './useNumberTween'

describe('useNumberTween', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the target immediately on first mount by default — no animate-from-0', () => {
    const { result } = renderHook(() => useNumberTween(42, 600))
    expect(result.current).toBe(42)
  })

  it('animates from the previous value to a new target when target changes', () => {
    const { result, rerender } = renderHook(({ target }) => useNumberTween(target, 600), {
      initialProps: { target: 1200 },
    })
    expect(result.current).toBe(1200)

    rerender({ target: 1212 })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBeGreaterThanOrEqual(1200)
    expect(result.current).toBeLessThanOrEqual(1212)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(result.current).toBe(1212)
  })

  it('with animateOnMount, starts at 0 and animates up to target on first mount', () => {
    const { result } = renderHook(() => useNumberTween(12, 500, { animateOnMount: true }))
    expect(result.current).toBe(0)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe(12)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/practice/useNumberTween.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/app/practice/useNumberTween.ts
/**
 * Shared rAF number tween — the "the number must visibly move" half of the
 * practice feedback loop's motion spec (docs/design/practice-feedback-loop.md
 * section 7): FeedbackHeader's promoted rating delta counts up from 0 on
 * each fresh commit (`animateOnMount: true` — it mounts fresh per commit),
 * and StatusBar's rating pill tweens from its old value to its new one
 * whenever the profile's rating changes but never animates in on first
 * page load (default: snap to target on mount, animate only on change).
 */
import { useEffect, useRef, useState } from 'react'

export function useNumberTween(
  target: number,
  durationMs: number,
  options?: { animateOnMount?: boolean },
): number {
  const animateOnMount = options?.animateOnMount ?? false
  const [displayed, setDisplayed] = useState(animateOnMount ? 0 : target)
  const displayedRef = useRef(animateOnMount ? 0 : target)
  const hasMountedRef = useRef(false)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const from = displayedRef.current
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      if (!animateOnMount) {
        displayedRef.current = target
        return
      }
      // animateOnMount: fall through and animate from 0 (the initial
      // displayedRef value) to `target` below, same as any later change.
    }

    const delta = target - from
    if (delta === 0) return

    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(1, elapsed / durationMs)
      const next = from + delta * progress
      displayedRef.current = next
      setDisplayed(next)
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      }
    }
    frameRef.current = requestAnimationFrame(tick)

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs])

  return displayed
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/app/practice/useNumberTween.test.ts`
Expected: PASS. If `requestAnimationFrame` isn't driven by `vi.advanceTimersByTime` under this repo's vitest setup, check `vitest.setup.ts`/`vite.config.ts` for an existing rAF-under-fake-timers shim other animation code already relies on (search: `grep -rn "requestAnimationFrame" vitest.setup.ts src/**/*.test.ts*`) and follow that same pattern rather than adding a second one; if none exists, add a minimal `global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16)` shim to this test file's own setup rather than a repo-wide one, to keep the blast radius contained to this task.

- [ ] **Step 5: Wire into `FeedbackHeader` (`PuzzleCardShell.tsx`)**

```typescript
// Replace FeedbackHeader's delta span:
//   {ratingDelta !== null && (
//     <span className={`feedback-panel__delta font-mono font-bold tabular-nums ${feedbackAccentClass(correct)}`}>
//       {ratingDelta > 0 ? `+${String(ratingDelta)}` : String(ratingDelta)}
//     </span>
//   )}
// with a version that counts up from 0 and is visually promoted (larger,
// scale-in):
function FeedbackDelta({ correct, ratingDelta }: { correct: boolean; ratingDelta: number }) {
  const tweened = useNumberTween(ratingDelta, 500, { animateOnMount: true })
  const rounded = Math.round(tweened)
  return (
    <span
      className={`feedback-panel__delta font-mono font-extrabold tabular-nums text-2xl scale-in ${feedbackAccentClass(correct)}`}
    >
      {rounded > 0 ? `+${String(rounded)}` : String(rounded)}
    </span>
  )
}

// In FeedbackHeader, replace the inline span with:
{ratingDelta !== null && <FeedbackDelta correct={correct} ratingDelta={ratingDelta} />}
```

Import `useNumberTween` from `./useNumberTween` at the top of `PuzzleCardShell.tsx`.

- [ ] **Step 6: Wire into `StatusBar.tsx`'s rating pill**

```typescript
// In StatusBar.tsx, import useNumberTween and replace the rating pill's
// bare {Math.round(rating)} with a tweened value:
const tweenedRating = useNumberTween(rating, 600)
// ...
<span>{Math.round(tweenedRating)}</span>
```

- [ ] **Step 7: Run the full affected test set**

Run: `pnpm vitest run src/app/practice/useNumberTween.test.ts src/app/practice/PuzzleCardShell.test.tsx src/app/practice/StatusBar.test.tsx src/app/puzzle/PuzzlePage.test.tsx`
Expected: PASS — confirm `feedback-panel__delta`'s classname and text content (`PuzzlePage.test.tsx`'s assertion) still resolve correctly once the tween settles (wrap that assertion in `await waitFor(...)` if it previously read the value synchronously and now fails because the tween hasn't settled within the same tick — adjust only if it actually fails).

- [ ] **Step 8: Commit**

```bash
git add src/app/practice/useNumberTween.ts src/app/practice/useNumberTween.test.ts src/app/practice/PuzzleCardShell.tsx src/app/practice/StatusBar.tsx
git commit -m "feat(practice): promoted counting-up delta + tweened rating pill"
```

---

### Task 11: `StatusBar.tsx` — mute toggle + shield pips

**Files:**

- Modify: `src/app/practice/StatusBar.tsx`
- Modify: `src/app/practice/StatusBar.test.tsx`
- Modify: `src/app/practice/usePracticeSession.ts` (add a `setSoundPreference` setter — see Step 4)
- Modify: `src/app/practice/PracticePage.tsx` (thread new props through both `<StatusBar>` call sites — mobile top bar and desktop sidebar)

**Interfaces:**

- Produces: `StatusBarProps.shields: number`, `StatusBarProps.soundEnabled: boolean`, `StatusBarProps.onToggleSound: () => void` (new, required — every existing caller must be updated in the same task since these aren't optional; a silent unprompted-noise feature needs its mute control always present, not opt-in). Adds `PracticeSession.setSoundPreference: (enabled: boolean) => void`.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to src/app/practice/StatusBar.test.tsx — update every existing
// render(<StatusBar .../>) call in this file to also pass shields={0}
// soundEnabled onToggleSound={vi.fn()} (required props now), then add:

it('renders no shield pips at 0 shields', () => {
  render(
    <StatusBar rating={1200} streak={0} combo={0} solvedThisSession={0} shields={0} soundEnabled onToggleSound={vi.fn()} />,
  )
  expect(screen.queryByTestId('shield-pip')).not.toBeInTheDocument()
})

it('renders one pip per banked shield', () => {
  render(
    <StatusBar rating={1200} streak={0} combo={3} solvedThisSession={0} shields={2} soundEnabled onToggleSound={vi.fn()} />,
  )
  expect(screen.getAllByTestId('shield-pip')).toHaveLength(2)
})

it('mute toggle reflects soundEnabled via aria-pressed and calls onToggleSound on click', () => {
  const onToggleSound = vi.fn()
  render(
    <StatusBar rating={1200} streak={0} combo={0} solvedThisSession={0} shields={0} soundEnabled onToggleSound={onToggleSound} />,
  )
  const toggle = screen.getByRole('button', { name: /mute|sound/i })
  expect(toggle).toHaveAttribute('aria-pressed', 'false') // pressed = muted; sound ON = not pressed
  fireEvent.click(toggle)
  expect(onToggleSound).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/practice/StatusBar.test.tsx`
Expected: FAIL — new required props missing/undefined, `shield-pip`/mute button not found.

- [ ] **Step 3: Implement `StatusBar.tsx`**

```typescript
// StatusBarProps gains:
shields: number
/** True = sound on. The toggle's aria-pressed is the inverse (pressed = muted) — see the button below. */
soundEnabled: boolean
onToggleSound: () => void
```

```typescript
// Destructure the three new props, then INSIDE the existing
// `{combo >= 2 && (...)}` combo-badge block (pips only make sense
// alongside a visible combo badge — a banked shield with no combo shown
// would be a stray icon with no context), add shield pips after the
// existing text span, and render the mute toggle unconditionally at the
// end of the row, after the combo-badge block:

{combo >= 2 && (
  <div className="status-bar__combo flex items-center gap-1.5 min-h-11 py-1.5 px-3 rounded-full bg-ok-dim text-accent font-bold" data-testid="combo-badge">
    {/* ...existing lightning icon + text... */}
    {shields > 0 && (
      <span className="flex items-center gap-1 ml-1" aria-label={`${String(shields)} shield${shields === 1 ? '' : 's'} banked`}>
        {Array.from({ length: shields }, (_, i) => (
          <svg
            key={i}
            data-testid="shield-pip"
            aria-hidden="true"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="var(--accent)"
          >
            <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3Z" />
          </svg>
        ))}
      </span>
    )}
  </div>
)}
<button
  type="button"
  className={`${pillClass} !px-2.5`}
  aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
  aria-pressed={!soundEnabled}
  onClick={onToggleSound}
>
  {soundEnabled ? <SpeakerIcon /> : <SpeakerMutedIcon />}
</button>
```

Add small inline `SpeakerIcon`/`SpeakerMutedIcon` functions above `StatusBar`, matching this file's existing inline-SVG convention (copy the stroke/size/viewBox conventions from the rating/streak icons already in this file — 14x14, `stroke="var(--accent)"`/`var(--text-2)`, `strokeWidth="2"`).

- [ ] **Step 4: Add `setSoundPreference` to `usePracticeSession.ts`**

Every other profile mutation in this codebase goes through the hook/page that owns the read (`updatePreference` in `SettingsPage.tsx`, `useChallengerName`'s save callback) — `usePracticeSession` already owns `profile` state, so the mute toggle's write belongs there too rather than as a one-off inline callback in `PracticePage.tsx`:

```typescript
// In usePracticeSession.ts, add alongside handleContinue/retryLoad:
const setSoundPreference = useCallback(
  (enabled: boolean) => {
    if (!profile) return
    const updatedProfile: UserProfile = {
      ...profile,
      preferences: { ...profile.preferences, sound: enabled },
    }
    setProfile(updatedProfile)
    saveProfile(updatedProfile).catch((error: unknown) => {
      trackError(error, 'usePracticeSession: saveProfile (sound preference) failed')
    })
  },
  [profile],
)

// Add to the PracticeSession interface, near retryLoad:
/** Optimistically flips preferences.sound and persists it — the StatusBar mute toggle's write path (see StatusBar.tsx). */
setSoundPreference: (enabled: boolean) => void

// Add to the returned object:
setSoundPreference,
```

- [ ] **Step 5: Thread the props through `PracticePage.tsx`'s two `<StatusBar>` call sites**

```typescript
// Both the mobile (`!isDesktop`) and desktop-sidebar StatusBar renders need:
shields={session.shields}
soundEnabled={session.profile.preferences.sound}
onToggleSound={() => {
  session.setSoundPreference(!session.profile.preferences.sound)
}}
```

- [ ] **Step 6: Run the full affected test set**

Run: `pnpm vitest run src/app/practice/StatusBar.test.tsx src/app/practice/PracticePage.test.tsx src/app/practice/usePracticeSession.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/practice/StatusBar.tsx src/app/practice/StatusBar.test.tsx src/app/practice/usePracticeSession.ts src/app/practice/PracticePage.tsx
git commit -m "feat(practice): StatusBar mute toggle + shield pips"
```

---

### Task 12: `SettingsPage.tsx` — sound + auto-advance rows

**Files:**

- Modify: `src/app/settings/SettingsPage.tsx`
- Modify: `src/app/settings/SettingsPage.test.tsx`

**Interfaces:** None new — reuses the existing `updatePreference<K extends keyof Preferences>` generic exactly as the four current rows do.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to src/app/settings/SettingsPage.test.tsx, following this file's
// existing pattern for the reducedMotion/timerOnTrace toggle-row tests
// (check that pattern first with
// `grep -n "Timer on Trace\|Reduce motion" src/app/settings/SettingsPage.test.tsx`
// and mirror it exactly):

it('toggles the sound preference and persists it', async () => {
  // render SettingsPage, wait for profile load, click the "Sound" switch,
  // assert saveProfile called with preferences.sound flipped — same shape
  // as the existing reducedMotion test.
})

it('toggles the auto-advance preference and persists it', async () => {
  // mirror the above for "autoAdvance"
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/settings/SettingsPage.test.tsx`
Expected: FAIL — no matching switch found.

- [ ] **Step 3: Implement**

Add two rows to `SettingsPage.tsx`'s Preferences section, immediately after the existing "Reduce motion" row, following that row's exact switch-button markup (`role="switch"`, `aria-checked`, the same `translate-x-[17px]` thumb animation):

```typescript
<div className={PREF_ROW_CLASS}>
  <div>
    <div className={PREF_LABEL_CLASS}>Sound</div>
    <div className={PREF_DESC_CLASS}>
      Short synthesized cues on correct/wrong/shielded answers in Practice.
    </div>
  </div>
  <button
    type="button"
    role="switch"
    aria-checked={preferences.sound}
    aria-label="Sound"
    className={`relative flex-none w-10 h-[23px] rounded-full border-0 cursor-pointer ${
      preferences.sound ? 'bg-accent' : 'bg-border-strong'
    }`}
    onClick={() => void updatePreference('sound', !preferences.sound)}
  >
    <span
      className={`absolute top-[2px] left-[2px] w-[19px] h-[19px] rounded-full transition-transform duration-150 ease-out ${
        preferences.sound ? 'translate-x-[17px] bg-accent-ink' : 'bg-text-0'
      }`}
    />
  </button>
</div>

<div className={PREF_ROW_CLASS}>
  <div>
    <div className={PREF_LABEL_CLASS}>Auto-advance</div>
    <div className={PREF_DESC_CLASS}>
      Move on automatically a beat after a correct answer in Practice, instead of waiting for Continue.
    </div>
  </div>
  <button
    type="button"
    role="switch"
    aria-checked={preferences.autoAdvance}
    aria-label="Auto-advance"
    className={`relative flex-none w-10 h-[23px] rounded-full border-0 cursor-pointer ${
      preferences.autoAdvance ? 'bg-accent' : 'bg-border-strong'
    }`}
    onClick={() => void updatePreference('autoAdvance', !preferences.autoAdvance)}
  >
    <span
      className={`absolute top-[2px] left-[2px] w-[19px] h-[19px] rounded-full transition-transform duration-150 ease-out ${
        preferences.autoAdvance ? 'translate-x-[17px] bg-accent-ink' : 'bg-text-0'
      }`}
    />
  </button>
</div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/app/settings/SettingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/SettingsPage.tsx src/app/settings/SettingsPage.test.tsx
git commit -m "feat(settings): sound + auto-advance preference rows"
```

---

### Task 13: `ComboSurge.tsx` + `PracticePage.tsx` wiring (drop `StreakPause` for Practice)

**Files:**

- Create: `src/app/practice/ComboSurge.tsx`
- Test: `src/app/practice/ComboSurge.test.tsx`
- Modify: `src/app/practice/PracticePage.tsx`
- Modify: `src/app/practice/PracticePage.test.tsx`

**Interfaces:**

- Consumes: `Outcome` from `./feel`.
- Produces: `ComboSurgeProps { outcome: Extract<Outcome, { kind: 'correct' }>; isNewBest: boolean; onDismiss: () => void }`, component `ComboSurge`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/practice/ComboSurge.test.tsx
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComboSurge } from './ComboSurge'
import type { Outcome } from './feel'

const OUTCOME: Extract<Outcome, { kind: 'correct' }> = {
  kind: 'correct',
  level: 1,
  newCombo: 3,
  newShields: 1,
  surge: true,
  tier: 'novice',
}

describe('ComboSurge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is a non-blocking status region showing the combo count', () => {
    render(<ComboSurge outcome={OUTCOME} isNewBest={false} onDismiss={vi.fn()} />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('3')
  })

  it('shows "+1 shield" when this surge banked one', () => {
    render(<ComboSurge outcome={{ ...OUTCOME, newShields: 1 }} isNewBest={false} onDismiss={vi.fn()} />)
    expect(screen.getByText(/shield/i)).toBeInTheDocument()
  })

  it('shows "New best" when isNewBest', () => {
    render(<ComboSurge outcome={OUTCOME} isNewBest onDismiss={vi.fn()} />)
    expect(screen.getByText(/new best/i)).toBeInTheDocument()
  })

  it('auto-dismisses after ~1600ms', () => {
    const onDismiss = vi.fn()
    render(<ComboSurge outcome={OUTCOME} isNewBest={false} onDismiss={onDismiss} />)
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders no buttons — dismissal is time-only, not user-initiated', () => {
    render(<ComboSurge outcome={OUTCOME} isNewBest={false} onDismiss={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/practice/ComboSurge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/app/practice/ComboSurge.tsx
/**
 * Practice's non-blocking combo-surge moment — replaces the old blocking
 * StreakPause modal for Practice ONLY (Trace keeps StreakPause/
 * streakPauseLogic.ts entirely unmodified). `role="status"`, no buttons,
 * auto-dismissing: interrupting a streak with a decision the player has to
 * act on is exactly what this change is fixing (see
 * docs/design/practice-feedback-loop.md section 9). Overlaid above the
 * card by the caller (PracticePage), not a portal — it's a toast, not a
 * dialog.
 */
import { useEffect } from 'react'
import type { Outcome } from './feel'

const AUTO_DISMISS_MS = 1600

export interface ComboSurgeProps {
  outcome: Extract<Outcome, { kind: 'correct' }>
  isNewBest: boolean
  onDismiss: () => void
}

export function ComboSurge({ outcome, isNewBest, onDismiss }: ComboSurgeProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [onDismiss])

  return (
    <div
      role="status"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 py-3 px-5 rounded-lg border border-accent bg-surface-1 text-center shadow-lg"
    >
      <p className="m-0 text-lg font-bold text-text-0">{outcome.newCombo} in a row</p>
      {outcome.newShields > 0 && <p className="m-0 text-sm font-semibold text-accent">+1 shield</p>}
      {isNewBest && <p className="m-0 text-sm font-semibold text-accent">New best</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/app/practice/ComboSurge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into `PracticePage.tsx`, dropping `StreakPause`**

```typescript
// Remove: import { StreakPause } from '../StreakPause'
// Add:
import { ComboSurge } from './ComboSurge'

// Remove the whole `{session.streakPause && (<StreakPause .../>)}` block
// (usePracticeSession no longer exposes streakPause — Task 7 removed it).
// Replace with local dismissal state, tracking which Outcome instance has
// already been dismissed by reference:

const [dismissedOutcome, setDismissedOutcome] = useState<typeof session.lastOutcome>(null)

const activeSurge =
  session.lastOutcome?.kind === 'correct' &&
  session.lastOutcome.surge &&
  session.lastOutcome !== dismissedOutcome
    ? session.lastOutcome
    : null

// ...in the returned JSX, replace the removed StreakPause block with:
{activeSurge && (
  <ComboSurge
    outcome={activeSurge}
    isNewBest={session.profile.bestRunStreak === activeSurge.newCombo}
    onDismiss={() => {
      setDismissedOutcome(activeSurge)
    }}
  />
)}
```

`isNewBest` is derived at the call site (`session.profile.bestRunStreak === activeSurge.newCombo`) rather than stored on `Outcome` itself — `feel.ts` is pure and has no access to `profile.bestRunStreak`. This equality check is safe because `usePracticeSession.ts` (Task 7) already sets `bestRunStreak: isNewBestStreak ? outcome.newCombo : profile.bestRunStreak` synchronously inside the same `handleAnswered` call that produces `lastOutcome`, so by the time this renders, `session.profile.bestRunStreak` already reflects the answer that produced `activeSurge`.

Comparing `session.lastOutcome !== dismissedOutcome` by object identity (not a derived token/counter) works because `usePracticeSession` creates a brand-new `Outcome` object on every `handleAnswered` call (`resolveOutcome` always returns a fresh object literal) — no two distinct answers can ever produce reference-equal outcomes, so this is a safe, simpler alternative to a separate counter/token.

- [ ] **Step 6: Run the full affected test set**

Run: `pnpm vitest run src/app/practice/PracticePage.test.tsx src/app/practice/ComboSurge.test.tsx`
Expected: PASS.

- [ ] **Step 7: Search for stray `StreakPause` references left in Practice's tree**

Run: `grep -rn "StreakPause" src/app/practice`
Expected: zero matches (Trace's own usage under `src/app/trace/`/`src/app/missions/` is untouched and out of scope).

- [ ] **Step 8: Commit**

```bash
git add src/app/practice/ComboSurge.tsx src/app/practice/ComboSurge.test.tsx src/app/practice/PracticePage.tsx src/app/practice/PracticePage.test.tsx
git commit -m "feat(practice): non-blocking ComboSurge replaces StreakPause in Practice"
```

---

### Task 14: Telemetry additions

**Files:**

- Modify: `src/telemetry/events.ts`
- Modify: `src/telemetry/index.ts`
- Modify: `src/app/practice/usePracticeSession.ts` (wire in `trackComboShieldUsed` — resolves Task 7's TODO stub, if left)
- Modify: `src/app/practice/PracticePage.tsx` (wire in `trackAutoAdvance` via `onAutoAdvanceResolved`)

**Interfaces:**

- Produces: extended `AttemptEventPayload` (+`combo: number`, `+impact_level: number`, `+rating_tier: string`), extended `StreakPausePayload` (+`tier?: string`, `+shields_banked?: number`, both optional so Trace's existing call site is unaffected), new `ComboShieldUsedPayload { tier: string; combo: number; shields_remaining: number }` + `trackComboShieldUsed`, new `AutoAdvancePayload { impact_level: number; cancelled: boolean }` + `trackAutoAdvance`.

- [ ] **Step 1: Write the failing test additions**

```typescript
// Add to src/telemetry/telemetry.test.ts, following its existing
// per-function test pattern (check with
// `grep -n "describe('trackStreakPause\|describe('trackAttempt" src/telemetry/telemetry.test.ts`
// and mirror exactly):

describe('trackComboShieldUsed', () => {
  it('captures combo_shield_used with the exact payload shape', () => {
    trackComboShieldUsed({ tier: 'novice', combo: 4, shields_remaining: 0 })
    expect(safeCaptureSpy).toHaveBeenCalledWith('combo_shield_used', {
      tier: 'novice',
      combo: 4,
      shields_remaining: 0,
    })
  })
})

describe('trackAutoAdvance', () => {
  it('captures auto_advance with the exact payload shape', () => {
    trackAutoAdvance({ impact_level: 2, cancelled: false })
    expect(safeCaptureSpy).toHaveBeenCalledWith('auto_advance', {
      impact_level: 2,
      cancelled: false,
    })
  })
})

describe('trackStreakPause (practice feedback loop additions)', () => {
  it('accepts tier and shields_banked alongside the existing fields', () => {
    trackStreakPause({
      mode: 'practice',
      streak: 6,
      is_new_best: false,
      tier: 'steady',
      shields_banked: 2,
    })
    expect(safeCaptureSpy).toHaveBeenCalledWith('streak_pause', {
      mode: 'practice',
      streak: 6,
      is_new_best: false,
      tier: 'steady',
      shields_banked: 2,
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/telemetry/telemetry.test.ts`
Expected: FAIL — `trackComboShieldUsed`/`trackAutoAdvance` not exported.

- [ ] **Step 3: Implement**

```typescript
// In src/telemetry/events.ts:

// Extend the existing interface (add three fields):
export interface AttemptEventPayload {
  puzzle_id: string
  correct: boolean
  time_ms: number
  mode: AttemptMode
  interaction: Puzzle['interaction']
  user_rating_before: number
  user_rating_after: number
  /** Practice feedback loop: post-answer in-session combo (feel.ts). Practice is currently the only caller passing a value driven by the tier model — see usePracticeSession.ts. */
  combo: number
  /** 0-3, correct answers only — 0 for wrong/shielded (see docs/design/practice-feedback-loop.md section 10). */
  impact_level: number
  /** feel.ts's RatingTier at answer time. */
  rating_tier: string
}

// Extend the existing interface (add two OPTIONAL fields — Trace's own
// resolveStreakPause-driven trackStreakPause call site, unmodified, has no
// tier concept and keeps omitting both):
export interface StreakPausePayload {
  mode: 'practice' | 'trace'
  streak: number
  is_new_best: boolean
  /** Practice feedback loop: feel.ts's RatingTier at the moment this fired. Optional — Trace's calls omit it. */
  tier?: string
  /** Shields banked immediately after this surge. Optional — Trace's calls omit it. */
  shields_banked?: number
}

/** Fired on every `'shielded'` Outcome (feel.ts) — a miss absorbed by a banked shield instead of resetting the combo. */
export interface ComboShieldUsedPayload {
  tier: string
  combo: number
  shields_remaining: number
}

export function trackComboShieldUsed(payload: ComboShieldUsedPayload): void {
  safeCapture('combo_shield_used', payload)
}

/** Fired once an auto-advance countdown resolves — either it ran to completion (cancelled: false) or was interrupted by interaction/visibility (cancelled: true). Never fired for a manual Continue tap when autoAdvanceMs was never set (preferences.autoAdvance off, or a wrong answer). */
export interface AutoAdvancePayload {
  impact_level: number
  cancelled: boolean
}

export function trackAutoAdvance(payload: AutoAdvancePayload): void {
  safeCapture('auto_advance', payload)
}
```

```typescript
// In src/telemetry/index.ts, add to both the value-export list and the
// type-export list:
export { /* ...existing..., */ trackComboShieldUsed, trackAutoAdvance } from './events'
export type {
  /* ...existing..., */
  ComboShieldUsedPayload,
  AutoAdvancePayload,
} from './events'
```

Confirm Trace's own `trackStreakPause` call site needs no edit: `grep -n "trackStreakPause" src/app/trace/useTraceSession.ts` — it should still typecheck unchanged since the two new fields are optional.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/telemetry/telemetry.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Wire `trackComboShieldUsed` into `usePracticeSession.ts`**

```typescript
// Update the existing telemetry import line in usePracticeSession.ts:
import { trackAttempt, trackComboShieldUsed, trackError, trackStreakPause } from '../../telemetry'
```

If Task 7 left a `// TODO(Task 14): trackComboShieldUsed` stub, replace it now with the real call it already wrote (Task 7 Step 4).

- [ ] **Step 6: Wire `trackAutoAdvance` into `PracticePage.tsx`'s `onAutoAdvanceResolved` callback**

```typescript
// In the <PuzzleCardShell> render (PracticePage.tsx, wired in Task 15),
// pass:
onAutoAdvanceResolved={(cancelled) => {
  if (session.lastOutcome?.kind === 'correct') {
    trackAutoAdvance({ impact_level: session.lastOutcome.level, cancelled })
  }
}}
```

Add `trackAutoAdvance` to `PracticePage.tsx`'s existing `import { trackShareClick } from '../../telemetry'` line. (If Task 15 lands after this one, leave a `// TODO(Task 15)` note at the `<PuzzleCardShell>` call site instead — the prop itself doesn't exist on that element until Task 15's edit.)

- [ ] **Step 7: Run the full practice + telemetry test suites**

Run: `pnpm vitest run src/app/practice src/telemetry`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/telemetry/events.ts src/telemetry/index.ts src/app/practice/usePracticeSession.ts src/app/practice/PracticePage.tsx
git commit -m "feat(telemetry): combo/impact_level/rating_tier + combo_shield_used + auto_advance events"
```

---

### Task 15: Wire `autoAdvanceMs`/`impact` from `PracticePage.tsx` into `PuzzleCardShell`

**Files:**

- Modify: `src/app/practice/PracticePage.tsx`
- Modify: `src/app/practice/PracticePage.test.tsx`

**Interfaces:**

- Consumes: `session.lastOutcome`, `session.profile.preferences.autoAdvance`, `impactVariant` from `./feel` (Task 2), `PuzzleCardShellProps.autoAdvanceMs`/`impact`/`onAutoAdvanceResolved` (Task 8).

This is the last integration seam — everything up to here builds the parts; this task connects `usePracticeSession`'s `lastOutcome` to `PuzzleCardShell`'s new props at the one real call site.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to src/app/practice/PracticePage.test.tsx — reuse this file's
// existing render/answer-a-puzzle helper (it has one, given the file's
// size — check with `grep -n "^function \|^async function " src/app/practice/PracticePage.test.tsx`
// before hand-rolling a new commit flow).

it('sets data-draining on Continue when preferences.autoAdvance is on and the answer is correct', async () => {
  // render PracticePage with a profile whose preferences.autoAdvance is
  // true, commit a correct answer, assert the Continue button carries
  // data-draining="true".
})

it('does not set data-draining when preferences.autoAdvance is false', async () => {
  // same, with autoAdvance: false — assert no data-draining attribute.
})

it('sets data-impact on the puzzle card matching the answer outcome', async () => {
  // commit correct/wrong/shielded (bank a shield first) and assert
  // .puzzle-card's data-impact attribute for each.
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/practice/PracticePage.test.tsx`
Expected: FAIL — `PuzzleCardShell` isn't receiving the new props yet.

- [ ] **Step 3: Implement**

```typescript
// In PracticePage.tsx, import impactVariant and add a module-scope
// lookup table (alongside PAGE_SHELL_CLASS etc. — a fixed constant, not
// per-render state):
import { impactVariant } from './feel'

/** Auto-advance duration per impact level — see docs/design/practice-feedback-loop.md section 3 for the rationale (bigger moments get to breathe). */
const AUTO_ADVANCE_MS_BY_LEVEL: Record<0 | 1 | 2 | 3, number> = {
  0: 1400,
  1: 1800,
  2: 2200,
  3: 2600,
}

// Inside the component, above the returned JSX (after `challengeButton`):
const canAutoAdvance =
  session.lastOutcome?.kind === 'correct' && session.profile.preferences.autoAdvance
const autoAdvanceMs = canAutoAdvance
  ? AUTO_ADVANCE_MS_BY_LEVEL[(session.lastOutcome as Extract<typeof session.lastOutcome, { kind: 'correct' }>).level]
  : undefined
const impact = session.lastOutcome ? impactVariant(session.lastOutcome) : null

// On the <PuzzleCardShell> element:
<PuzzleCardShell
  key={session.puzzle.id}
  puzzle={session.puzzle}
  ratingDelta={session.ratingDelta}
  onAnswered={handleAnswered}
  onContinue={session.handleContinue}
  shareActions={shareActions}
  challengeButton={answer && challengeButton}
  sidebarSlot={sidebarSlotEl}
  autoAdvanceMs={autoAdvanceMs}
  impact={impact}
  onAutoAdvanceResolved={(cancelled) => {
    if (session.lastOutcome?.kind === 'correct') {
      trackAutoAdvance({ impact_level: session.lastOutcome.level, cancelled })
    }
  }}
/>
```

(`trackAutoAdvance` is imported per Task 14 Step 6 — if that task landed first, this is already wired; if this task lands first, add the import here and Task 14 will find it already present.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/app/practice/PracticePage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/practice/PracticePage.tsx src/app/practice/PracticePage.test.tsx
git commit -m "feat(practice): wire autoAdvanceMs/impact from session outcome into PuzzleCardShell"
```

---

### Task 16: Full validation + deliverables

**Files:** None (verification only).

- [ ] **Step 1: Run the full suite**

Run: `pnpm validate`
Expected: `typecheck`, `lint`, `test`, `validate:content`, and `build` all green. Fix any fallout in files this plan didn't anticipate (e.g. another `Preferences` literal, another `PuzzleCardShell` caller snapshot) using the same patterns established above — do not disable a failing test, fix it per the "Expected test fallout — fix it, don't disable it" constraint from the original build prompt.

- [ ] **Step 2: Manual play-test pass**

Using dev-puzzle-mode (or a real profile with `rating` hand-edited via export/import, per `SettingsPage.tsx`'s own "Reset your rating" instructions), play a short session at ~1200 (novice) and, separately, at a rating forced to ~1700+ (elite). Confirm: novice's surge fires every 3rd correct (visible ComboSurge, audible arpeggio step, banked shield up to 2) while elite's fires every 6th and shields cap at 1; a shielded miss reads as "caught" (no shake, no combo reset) at both tiers; auto-advance drains and is cancellable by tapping elsewhere on the card; the mute toggle actually silences audio; reduced-motion (OS or in-app preference) drops all transforms but not colour.

- [ ] **Step 3: Write the three deliverables Thomas asked for, as a reply, not a file**

1. Every tunable constant introduced and where it lives (tier boundaries/combo steps/shield caps in `feel.ts`; auto-advance durations in `PracticePage.tsx`'s `AUTO_ADVANCE_MS_BY_LEVEL`; haptic patterns in `haptics.ts`; audio gain/semitones/frequencies in `feedbackSound.ts`; `ComboSurge`'s `AUTO_DISMISS_MS`).
2. Every decision made that the prompt didn't specify, pulled from this plan's own inline notes (the `correct-1`/level-0 CSS collapse; tier computed from pre-answer rating; `impact_level: 0` for non-correct telemetry; `StreakPausePayload`'s two new fields being optional rather than required; the mute toggle routed through a new `setSoundPreference` hook setter; `ComboSurge`'s object-identity dismissal tracking).
3. The manual play-test script from Step 2 above, written up concisely.

- [ ] **Step 4: Final commit (if Step 1 produced any fixup diffs) and push**

```bash
git push -u origin practice-feedback-loop
```

Do not open the PR without being asked — branch pushed and ready is the deliverable; PR creation is a separate, explicit step.
