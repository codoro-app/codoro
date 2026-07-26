/**
 * Terms + privacy notice. Reachable only via the app-shell footer link —
 * not one of the four main modes, so it has no ModeSwitcher/NavRail tab.
 * Good-faith developer-written notice, not lawyer-reviewed.
 */
import type { AppMode } from '../ModeSwitcher'
import './legalPage.css'

export interface LegalPageProps {
  onNavigate: (mode: AppMode) => void
}

export function LegalPage({ onNavigate }: LegalPageProps) {
  return (
    <div className="legal-page">
      <button
        type="button"
        className="legal-page__back"
        onClick={() => {
          onNavigate('home')
        }}
      >
        ← Back
      </button>
      <h1 className="legal-page__title">Terms &amp; privacy</h1>
      <p className="legal-page__updated">Last updated 2026-07-26</p>

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
          are actually used.
        </p>
        <p>
          Your rating, streak, and puzzle history live entirely in your browser's local storage.
          Nothing is uploaded to a server. You can export that data or clear it at any time from
          your device settings — clearing site data for getcodoro.com removes it completely.
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
