/**
 * Tier picker shared by Compete's two doors (Play Computer here, Play Human
 * in a later task) — both draw their 5 puzzles from the same rating-window
 * mechanic (`sampleDistinctIds`/`widenedEligible`, src/challenge), centered
 * on one of Practice's own tier labels (src/app/practice/feel.ts's
 * `RatingTier`) rather than a second, invented tier vocabulary.
 */
import type { EloTier } from '../../challenge'

export interface LevelPickerProps {
  onSelect: (tier: EloTier) => void
  onBack: () => void
}

const TIERS: { tier: EloTier; label: string; description: string }[] = [
  { tier: 'novice', label: 'Novice', description: 'Under 1300' },
  { tier: 'steady', label: 'Steady', description: '1300+' },
  { tier: 'sharp', label: 'Sharp', description: '1500+' },
  { tier: 'elite', label: 'Elite', description: '1700+' },
]

const BACK_BUTTON_CLASS =
  'self-start text-sm font-bold text-accent bg-transparent border-0 cursor-pointer p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const TIER_BUTTON_CLASS =
  'flex flex-col items-start gap-1 min-h-11 w-full p-4 rounded-md border border-border bg-surface-1 text-left text-text-0 cursor-pointer lg:transition-[transform,border-color] lg:duration-150 lg:hover:border-border-strong active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

export function LevelPicker({ onSelect, onBack }: LevelPickerProps) {
  return (
    <div className="flex flex-col gap-3">
      <button type="button" className={BACK_BUTTON_CLASS} onClick={onBack}>
        ← Back
      </button>
      <p className="m-0 text-sm font-bold text-text-1">Pick a level</p>
      <div className="flex flex-col gap-2">
        {TIERS.map(({ tier, label, description }) => (
          <button
            key={tier}
            type="button"
            className={TIER_BUTTON_CLASS}
            onClick={() => {
              onSelect(tier)
            }}
          >
            <span className="text-lg font-bold">{label}</span>
            <span className="text-sm text-text-2">{description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
