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
 * Rendered from two places — AppShell.tsx's footer and SettingsPage.tsx's
 * own section — each passing its own `className` (styling isn't shared,
 * since the two surfaces use different layout conventions) and a `surface`
 * used only for the `feedback_link_clicked` telemetry event, so it's
 * possible to tell which placement actually gets used.
 *
 * FEEDBACK_URL is a placeholder — see the TODO below — swap in the real
 * Tally form URL before merging this branch.
 */
import { trackFeedbackLinkClicked } from '../telemetry'

// TODO(pre-merge): replace with the real Tally form URL.
export const FEEDBACK_URL = 'https://tally.so/r/REPLACE_ME'

export interface FeedbackLinkProps {
  surface: 'footer' | 'settings'
  className?: string
}

export function FeedbackLink({ surface, className }: FeedbackLinkProps) {
  return (
    <a
      href={FEEDBACK_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() => {
        trackFeedbackLinkClicked({ surface })
      }}
    >
      Feedback
    </a>
  )
}
