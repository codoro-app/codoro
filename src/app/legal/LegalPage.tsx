/**
 * Terms + privacy notice. Reachable only via the app-shell footer link —
 * not one of the four main modes, so it has no ModeSwitcher/NavRail tab.
 * Good-faith developer-written notice, not lawyer-reviewed — an honest
 * starting point for an app that now has real accounts (Clerk) and email
 * collection (PII), not a substitute for real legal review, which hasn't
 * happened yet. Refreshed for v2 Phase 7 (Items 1, 5, 6):
 * points at the new in-app /settings export, and names challenge links and
 * the anonymous ID honestly. Edited once for this phase, per the Phase 7
 * build prompt's own sequencing note (Item 6's outcome had to be settled
 * first) — see docs/v2-build-plan.md's Phase 7 amendment.
 *
 * Launch instrumentation (Item 4): the feedback form (FeedbackLink.tsx)
 * added an optional email field, which made the old unqualified "collects
 * no personal information" opening sentence false — scoped to "the app
 * itself" and a new closing paragraph names the feedback form's data
 * handling honestly, same standard as the anonymous-ID/challenge-link
 * paragraphs above.
 *
 * v5 Phase 5.6 / T15 (2026-09-15): the Privacy section still said "Codoro
 * has no accounts" and "Nothing is uploaded to a server" after Phase 5.1
 * shipped real Clerk accounts + D1 sync (2026-09-12) — both had been false
 * in production for several days. Rewritten to cover accounts (optional,
 * Clerk-backed, collects an email), sync (D1, signed-in players only), and
 * deletion (Clerk user + D1 rows both removed) — scoped to only what's
 * actually live; leaderboard display and marketing email are NOT
 * mentioned because neither has shipped yet (5.3/5.5 paused). Real lawyer
 * review is still the action item this doesn't replace — see the closing
 * amendment for exactly what's outstanding and whose job it is.
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
    <div className="flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] mx-auto pt-[var(--space-4)] px-4 pb-6 text-text-1">
      <Link
        href="/"
        className="self-start min-h-11 py-2 px-3 border border-border rounded-sm bg-surface-1 text-text-1 text-sm no-underline cursor-pointer inline-flex items-center"
      >
        ← Back
      </Link>
      {/* legal-page__title stays literal — App.test.tsx scopes
          findByText('Terms & privacy', { selector: '.legal-page__title' }). */}
      <h1 className="legal-page__title text-2xl text-text-0 m-0">Terms &amp; privacy</h1>
      <p className="text-sm text-text-2 m-0">Last updated 2026-09-15</p>

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
          Playing without an account is still fully local and still the default: your rating,
          streak, and puzzle history live in your browser's local storage, exportable or clearable
          any time from{' '}
          <Link href={ROUTES.settings.path} className={LINK_CLASS}>
            Settings
          </Link>
          , or by clearing site data for getcodoro.com in your browser's settings. The only data
          sent off your device while playing signed out is anonymous usage events (which screen
          you're on, whether an answer was right or wrong, that kind of thing) via PostHog, carrying
          an app-generated anonymous ID stored on your device — it contains no personal information
          and is never linked to a name, email, or account.
        </p>
        <p className={SECTION_COPY_CLASS}>
          Signing in is optional. If you choose to, Codoro creates an account for you through{' '}
          <a
            className={LINK_CLASS}
            href="https://clerk.com/privacy"
            target="_blank"
            rel="noreferrer"
          >
            Clerk
          </a>
          , our authentication provider, which collects an email address to manage that account.
          Clerk's own privacy practices govern that data — see their privacy policy linked above.
        </p>
        <p className={SECTION_COPY_CLASS}>
          Once signed in, your rating, streak, and puzzle history also sync to a server (Cloudflare
          D1) so they carry across devices. This replaces local-only storage for a signed-in player;
          guests are unaffected. Deleting your account removes both your Clerk user and your synced
          data on our server — nothing is kept after deletion.
        </p>
        <p className={SECTION_COPY_CLASS}>
          If you challenge a friend, the puzzles you solved and how you did are encoded directly
          into the link you send them — that's the only way it works, since a challenge link doesn't
          require either side to be signed in. That link is the one way your data leaves your device
          by choice; nothing in it identifies you personally, and it's never sent anywhere except by
          you, when you choose to share it.
        </p>
        <p className={SECTION_COPY_CLASS}>
          Feedback form. The Feedback link opens a form hosted by Tally, and answers go to Tally's
          servers rather than ours. Every question on it is optional except one, and the only
          personal information it asks for is an email address — also optional, and used for exactly
          one thing: telling you when Codoro has changed in a way worth coming back for. It is never
          sold, never added to a mailing list, and you can have it deleted at any time by emailing
          the address below.
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
