/**
 * Shared status-pill shape (rating/streak/solved-count/sound) — StatusBar.tsx
 * used to render each as its own one-off markup (a rounded-full pill for
 * rating/streak, bare icon+text for solved, a differently-padded pill for
 * sound); this is the one shape all four now share. The combo badge stays
 * bespoke (bg-ok-dim, shield pips) — it isn't one of the four variants the
 * redesign mockups (docs/redesign/mockups/Practice*.png) actually show.
 */
import type { ReactNode } from 'react'

export interface StatBadgeProps {
  icon: ReactNode
  children?: ReactNode
  title?: string
  /** Tighter horizontal padding for icon-only badges (the sound toggle). */
  compact?: boolean
  as?: 'button'
  ariaLabel?: string
  ariaPressed?: boolean
  onClick?: () => void
}

const BASE =
  'flex items-center gap-1.5 min-h-11 rounded-full bg-surface-1 border border-border text-text-0 font-bold tabular-nums'
const PADDING = 'py-1.5 px-3'
const PADDING_COMPACT = 'py-1.5 px-2.5'

export function StatBadge({
  icon,
  children,
  title,
  compact,
  as,
  ariaLabel,
  ariaPressed,
  onClick,
}: StatBadgeProps) {
  const className = `${BASE} ${compact ? PADDING_COMPACT : PADDING}`
  if (as === 'button') {
    return (
      <button
        type="button"
        className={className}
        title={title}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        onClick={onClick}
      >
        {icon}
        {children}
      </button>
    )
  }
  return (
    <div className={className} title={title}>
      {icon}
      {children}
    </div>
  )
}
