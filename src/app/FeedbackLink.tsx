/**
 * External feedback link — a plain `<a target="_blank">` to a Tally-hosted
 * form. Deliberately NOT an iframe embed and NOT a form that POSTs
 * anywhere: public/_headers' CSP is `default-src 'self'` with no
 * `frame-src` and `form-action 'self'` — an off-origin embed or POST would
 * violate it, silently today (the policy is Report-Only) and loudly the
 * moment it's enforced. A plain anchor to an off-origin page trips neither
 * directive. `rel="noopener noreferrer"` is the standard target="_blank"
 * hardening (no `window.opener` access back into this app; no more
 * referrer leaked to Tally than any ordinary outbound link already sends).
 *
 * Rendered from four places — AppShell.tsx's footer, SettingsPage.tsx's own
 * section, and (feedback-nudge follow-up) FeedbackNudge.tsx's two trigger
 * surfaces — each passing its own `className` (styling isn't shared, since
 * the surfaces use different layout conventions) and a `surface` used only
 * for the `feedback_link_clicked` telemetry event, so it's possible to tell
 * which placement actually gets used. `onClick` is optional and additive to
 * tracking, never a replacement for it — FeedbackNudge uses it to also
 * permanently dismiss itself on click-through (useFeedbackNudge's dismiss).
 *
 * FEEDBACK_URL is the real, live Tally form for this launch.
 */
import { trackFeedbackLinkClicked } from '../telemetry'

export const FEEDBACK_URL = 'https://tally.so/r/Xxb0v4'

export interface FeedbackLinkProps {
  surface: 'footer' | 'settings' | 'daily_nudge' | 'home_nudge'
  className?: string
  onClick?: () => void
}

export function FeedbackLink({ surface, className, onClick }: FeedbackLinkProps) {
  return (
    <a
      href={FEEDBACK_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() => {
        trackFeedbackLinkClicked({ surface })
        onClick?.()
      }}
    >
      Feedback
    </a>
  )
}
