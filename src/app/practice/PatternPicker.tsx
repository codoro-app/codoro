/**
 * Browse-by-pattern entry point: pick a single bug pattern to practice, or
 * go back to the full pool. Filtering itself happens in usePracticeSession
 * (setPatternFilter) — this component is presentation only.
 */
import { PATTERN_LABELS, PATTERN_SLUGS } from '../../content'
import type { PatternSlug } from '../../content'
import './practicePage.css'

export interface PatternPickerProps {
  onSelect: (pattern: PatternSlug | null) => void
  onBack: () => void
}

export function PatternPicker({ onSelect, onBack }: PatternPickerProps) {
  return (
    <div className="pattern-picker">
      <div className="pattern-picker__header">
        <button type="button" className="practice-page__link" onClick={onBack}>
          ← Back
        </button>
        <h2 className="pattern-picker__title">Practice by pattern</h2>
      </div>

      <button
        type="button"
        className="pattern-picker__all"
        onClick={() => {
          onSelect(null)
        }}
      >
        Practice all patterns
      </button>

      <div className="pattern-picker__grid">
        {PATTERN_SLUGS.map((slug) => (
          <button
            key={slug}
            type="button"
            className="pattern-picker__button"
            onClick={() => {
              onSelect(slug)
            }}
          >
            {PATTERN_LABELS[slug]}
          </button>
        ))}
      </div>
    </div>
  )
}
