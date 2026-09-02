/**
 * Small dismissible card nudging toward the external Tally feedback form —
 * launch instrumentation follow-up: the footer/Settings FeedbackLink alone
 * wasn't visible enough to draw any submissions, so this surfaces the same
 * link at two higher-intent moments instead (see DailyPage.tsx's completion
 * hero and Home.tsx's 5-solved-and-no-Daily-today fallback for the actual
 * trigger conditions — this component is purely presentational, matching
 * IosInstallSheet.tsx's caller-owns-visibility split).
 *
 * Visually modeled on Home.tsx's "Practice this next" card (icon + bold
 * one-liner + description in a bordered surface-1 box) rather than
 * IosInstallSheet's full-width fixed bottom sheet — this renders inline in
 * normal page flow, not as a page-covering overlay.
 *
 * Both the dismiss (✕) button and the Feedback link itself call onDismiss —
 * per the locked design, clicking through counts as "seen it", the same as
 * an explicit dismissal (see useFeedbackNudge.ts).
 */
import { FeedbackLink } from './FeedbackLink'
import { Tooltip } from './Tooltip'

export interface FeedbackNudgeProps {
  surface: 'daily_nudge' | 'home_nudge'
  onDismiss: () => void
}

export function FeedbackNudge({ surface, onDismiss }: FeedbackNudgeProps) {
  return (
    <div
      className="flex items-start gap-3 p-3.5 rounded-md border border-border bg-surface-1"
      role="note"
    >
      <span aria-hidden="true" className="text-xl leading-none">
        💬
      </span>
      <p className="m-0 flex-1 text-sm text-text-0">
        <span className="block font-bold mb-0.5">Got a sec?</span>
        Tell us what&apos;s working (or not) —{' '}
        <FeedbackLink
          surface={surface}
          className="text-accent font-semibold no-underline"
          onClick={onDismiss}
        />{' '}
        takes 2 minutes.
      </p>
      <Tooltip label="Dismiss">
        <button
          type="button"
          className="min-w-11 min-h-11 flex items-center justify-center border-0 bg-transparent text-text-1 text-xl leading-none cursor-pointer"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </Tooltip>
    </div>
  )
}
