/**
 * Shared "how am I doing / how many left" indicator — redesign Phase 1.
 * Unifies four previously-unrelated widgets: Rush's strikes dots + per-puzzle
 * timer bar, Boss's health bar + puzzle-position pip row, and Missions'
 * StageTracker pill-dot stepper (see docs/redesign/phase8-content-status.md,
 * "Four unrelated progress/lives indicators for one mechanic"). One prop
 * shape — `value`/`max` plus a `variant` ('dots' for discrete counts,
 * 'bar' for a continuous fill) and a `tone` ('accent' for progress-is-good,
 * 'danger' for a draining resource) — covers every caller; no per-mode
 * variant of this component exists or should be added.
 *
 * `label`, when given, makes this an accessible live element rather than a
 * decorative one (`aria-hidden`) — for callers (Boss's puzzle-position pips,
 * Missions' stage dots) that already render their own accessible readout
 * alongside it. `announceAs` picks which ARIA pattern the label uses:
 * `'status'` (default) suits values that change rarely — a life lost, a
 * stage advanced — matching Rush's and Boss's existing `role="status"`
 * "X of 3 strikes" contract (RushPage.test.tsx / BossPage.test.tsx assert
 * on this exact role+name, dots or bar). `'progressbar'` suits a
 * continuously-ticking value (Rush's per-puzzle countdown) — `status` is an
 * implicit polite live region, so using it there would re-announce every
 * tick to screen readers; `progressbar` isn't, and pairs with real
 * `aria-valuemin`/`aria-valuemax`/`aria-valuenow`.
 *
 * `data-testid`/`data-state` on each dot and the bar's fill are a plain
 * test hook (no visual effect) — the classnames the old bespoke widgets
 * were asserted on (`.boss-strikes__fill`, `.boss-progress__pip`, etc.) are
 * gone now that this is one shared, generic component.
 */
export type ProgressIndicatorVariant = 'dots' | 'bar'
export type ProgressIndicatorTone = 'accent' | 'danger'

export interface ProgressIndicatorProps {
  /** Current value — lives/stages/puzzles reached, or ms elapsed. */
  value: number
  /** Max value — max lives, total stages/puzzles, or a time limit. */
  max: number
  variant: ProgressIndicatorVariant
  /** Fill color. 'accent' (default) for progress-is-good, 'danger' for a draining resource (lives, time). */
  tone?: ProgressIndicatorTone
  /** Accessible name. Omit for a decorative indicator (`aria-hidden`) when the caller renders its own readout alongside it. */
  label?: string
  /** ARIA pattern to use when `label` is set. See file doc comment. */
  announceAs?: 'status' | 'progressbar'
}

const DOT_STATE_CLASS: Record<
  ProgressIndicatorTone,
  Record<'done' | 'current' | 'upcoming', string>
> = {
  accent: {
    done: 'bg-accent',
    current: 'bg-accent-dim border-2 border-accent',
    upcoming: 'bg-surface-2 border border-border',
  },
  danger: {
    done: 'bg-danger border-2 border-danger',
    // Strikes/lives have no meaningful "current" step — collapses to "upcoming".
    current: 'bg-transparent border-2 border-border-strong',
    upcoming: 'bg-transparent border-2 border-border-strong',
  },
}

function dotState(
  index: number,
  value: number,
  tone: ProgressIndicatorTone,
): 'done' | 'current' | 'upcoming' {
  if (tone === 'danger') return index < value ? 'done' : 'upcoming'
  if (index < value - 1) return 'done'
  if (index === value - 1) return 'current'
  return 'upcoming'
}

export function ProgressIndicator({
  value,
  max,
  variant,
  tone = 'accent',
  label,
  announceAs = 'status',
}: ProgressIndicatorProps) {
  const a11yProps =
    label === undefined
      ? { 'aria-hidden': true as const }
      : announceAs === 'progressbar'
        ? {
            role: 'progressbar' as const,
            'aria-label': label,
            'aria-valuemin': 0,
            'aria-valuemax': max,
            'aria-valuenow': Math.round(value),
          }
        : { role: 'status' as const, 'aria-label': label }

  if (variant === 'bar') {
    const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
    return (
      <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden" {...a11yProps}>
        <div
          data-testid="progress-fill"
          className={`h-full rounded-full transition-[width] duration-150 ease-out ${tone === 'danger' ? 'bg-danger' : 'bg-accent'}`}
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2" {...a11yProps}>
      {Array.from({ length: max }, (_, i) => {
        const state = dotState(i, value, tone)
        return (
          <span
            key={i}
            data-testid="progress-dot"
            data-state={state}
            className={`w-3 h-3 rounded-full ${DOT_STATE_CLASS[tone][state]}`}
          />
        )
      })}
    </div>
  )
}
