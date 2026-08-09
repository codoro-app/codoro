/**
 * Terms + privacy notice. Reachable only via the app-shell footer link —
 * not one of the four main modes, so it has no ModeSwitcher/NavRail tab.
 * Good-faith developer-written notice, not lawyer-reviewed — that's an
 * accurate, appropriate framing for a pre-launch, no-accounts, no-PII app;
 * real legal review is a v3.0 launch-readiness item (docs/roadmap.md), not
 * something to upgrade to here. Refreshed for v2 Phase 7 (Items 1, 5, 6):
 * points at the new in-app /settings export, and names challenge links and
 * the anonymous ID honestly. Edited once for this phase, per the Phase 7
 * build prompt's own sequencing note (Item 6's outcome had to be settled
 * first) — see docs/v2-build-plan.md's Phase 7 amendment.
 */
import { Link } from 'wouter'
import { ROUTES } from '../routes'
import './legalPage.css'

export function LegalPage() {
  return (
    <div className="legal-page">
      <Link href="/" className="legal-page__back">
        ← Back
      </Link>
      <h1 className="legal-page__title">Terms &amp; privacy</h1>
      <p className="legal-page__updated">Last updated 2026-08-09</p>

      <section className="legal-page__section">
        <h2>Terms</h2>
        <p>
          Codoro is a free, personal project for practicing bug-spotting. It's provided as-is, with
          no uptime or accuracy guarantees. Don't rely on it for anything that matters — the puzzle
          explanations are written in good faith but can be wrong.
        </p>
      </section>

      <section className="legal-page__section">
        <h2>Privacy</h2>
        <p>
          Codoro has no accounts and collects no personal information. The only data sent off your
          device is anonymous usage events (which screen you're on, whether an answer was right or
          wrong, that kind of thing) via PostHog, used solely to understand which parts of the app
          are actually used and whether people come back. Those events carry an app-generated
          anonymous ID, stored on your device, so we can count a returning visit without knowing who
          anyone is — it contains no personal information and is never linked to a name, email, or
          account, because there isn't one.
        </p>
        <p>
          Your rating, streak, and puzzle history live entirely in your browser's local storage.
          Nothing is uploaded to a server. You can export or import that data any time from{' '}
          <Link href={ROUTES.settings.path} className="legal-page__link">
            Settings
          </Link>
          , or clear it entirely from your device's browser settings — clearing site data for
          getcodoro.com removes it completely.
        </p>
        <p>
          If you challenge a friend, the puzzles you solved and how you did are encoded directly
          into the link you send them — that's the only way it works, since Codoro has no server to
          store it on. That link is the one way your data leaves your device by design; nothing in
          it identifies you personally, and it's never sent anywhere except by you, when you choose
          to share it.
        </p>
      </section>

      <section className="legal-page__section">
        <h2>Contact</h2>
        <p>
          Questions or concerns:{' '}
          <a className="legal-page__link" href="mailto:codoroapp@gmail.com">
            codoroapp@gmail.com
          </a>
        </p>
      </section>
    </div>
  )
}
