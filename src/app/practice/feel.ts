/**
 * Practice's tier/combo/shield/impact engine — pure, no React, no I/O.
 * Mirrors src/engine/'s Rng-injection/pure-function style, but deliberately
 * lives here rather than in src/engine/: this is Practice-only feel/pacing,
 * not rating/selection/streak/requeue domain logic, and src/engine/ is a
 * barrel of the latter (see docs/design/practice-feedback-loop.md).
 *
 * The whole point of the tier model (docs/design/practice-feedback-loop.md
 * §1): pacing shifts by rating tier, not just puzzle difficulty. A 1200 and
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
 * docs/design/practice-feedback-loop.md §3).
 */
export function impactVariant(outcome: Outcome): ImpactVariant {
  if (outcome.kind === 'wrong') return 'wrong'
  if (outcome.kind === 'shielded') return 'shielded'
  return `correct-${String(Math.max(1, outcome.level))}` as ImpactVariant
}
