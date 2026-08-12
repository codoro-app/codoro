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

// 2b.0: was `.legal-page__section h2`/`p` descendant selectors
// (legalPage.css) — applied directly to each heading/paragraph since there's
// no longer a styled section wrapper to select through.
const SECTION_HEADING_CLASS = 'text-lg text-text-0 m-0 mb-2'
const SECTION_COPY_CLASS = 'text-md leading-[1.5] m-0 mb-3'
const LINK_CLASS = 'text-accent'

export function LegalPage() {
  return (
    <div className="flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] mx-auto pt-[calc(var(--space-4)+env(safe-area-inset-top))] px-4 pb-6 text-text-1">
      <Link
        href="/"
        className="self-start min-h-11 py-2 px-3 border border-border rounded-sm bg-surface-1 text-text-1 text-sm no-underline cursor-pointer inline-flex items-center"
      >
        ← Back
      </Link>
      {/* legal-page__title stays literal — App.test.tsx scopes
          findByText('Terms & privacy', { selector: '.legal-page__title' }). */}
      <h1 className="legal-page__title text-2xl text-text-0 m-0">Terms &amp; privacy</h1>
      <p className="text-sm text-text-2 m-0">Last updated 2026-08-09</p>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Terms</h2>
        <p className={SECTION_COPY_CLASS}>
          Codoro is a free, personal project for practicing bug-spotting. It's provided as-is, with
          no uptime or accuracy guarantees. Don't rely on it for anything that matters — the puzzle
          explanations are written in good faith but can be wrong.
        </p>
      </section>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Privacy</h2>
        <p className={SECTION_COPY_CLASS}>
          Codoro has no accounts and collects no personal information. The only data sent off your
          device is anonymous usage events (which screen you're on, whether an answer was right or
          wrong, that kind of thing) via PostHog, used solely to understand which parts of the app
          are actually used and whether people come back. Those events carry an app-generated
          anonymous ID, stored on your device, so we can count a returning visit without knowing who
          anyone is — it contains no personal information and is never linked to a name, email, or
          account, because there isn't one.
        </p>
        <p className={SECTION_COPY_CLASS}>
          Your rating, streak, and puzzle history live entirely in your browser's local storage.
          Nothing is uploaded to a server. You can export or import that data any time from{' '}
          <Link href={ROUTES.settings.path} className={LINK_CLASS}>
            Settings
          </Link>
          , or clear it entirely from your device's browser settings — clearing site data for
          getcodoro.com removes it completely.
        </p>
        <p className={SECTION_COPY_CLASS}>
          If you challenge a friend, the puzzles you solved and how you did are encoded directly
          into the link you send them — that's the only way it works, since Codoro has no server to
          store it on. That link is the one way your data leaves your device by design; nothing in
          it identifies you personally, and it's never sent anywhere except by you, when you choose
          to share it.
        </p>
      </section>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Contact</h2>
        <p className={SECTION_COPY_CLASS}>
          Questions or concerns:{' '}
          <a className={LINK_CLASS} href="mailto:codoroapp@gmail.com">
            codoroapp@gmail.com
          </a>
        </p>
      </section>
    </div>
  )
}
