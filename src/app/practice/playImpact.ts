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
