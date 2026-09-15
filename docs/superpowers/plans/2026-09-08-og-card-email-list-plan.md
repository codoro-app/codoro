---
name: og-card-email-list-plan
description: Scope for challenge-link OG cards + a pre-launch email list, plus the interim legal/privacy update both require. Pre-v5 (no D1/Clerk yet). Read the "critical architecture note" before writing any code.
type: project
---

# OG cards + email list (pre-v5)

## Why this exists

Two growth fixes Thomas wants before starting v5 (accounts): (1) challenge links currently
unfurl as a bare URL in iMessage/SMS/Slack — no preview card — and (2) there's no way to
capture an email from someone who plays a challenge, for a pre-launch list. Both are meant to
stay small and NOT require the v5 backend (Workers + D1 + Clerk) — see
[[codoro-v5-backend-security]] and [[codoro-multiplayer-sequencing]] for why that backend is
scoped for later. **Recipient email notification (emailing the challenge link to someone) is
explicitly OUT of scope here** — it needs Resend + real abuse controls and overlaps enough
with v5.5 that building it now is either throwaway or a stealth slice of v5's Task 0. Don't
build it as part of this.

## Critical architecture note — read first, this changes the naive approach

The entire challenge payload (puzzle ids, results, total time, challenger name) lives in the
**URL fragment**: `/challenge#<base64url>` (`src/challenge/codec.ts`). This is deliberate —
per that file's own doc comment, a fragment never reaches Cloudflare or the service worker,
which is what lets `/challenge` stay a plain static route with no server involvement at all.

That means **link-preview crawlers (iMessage, Slack, Discord, Gemini, etc.) cannot see the
fragment** — the fragment is stripped client-side before the HTTP request is ever sent. A
server-side OG-tag generator has literally nothing to read. This is the reason today's
`/challenge` unfurl is just the site's generic static card from `index.html`
(`og-image.png`, brand mark only, no per-challenge text — see
`src/app/og/generateOgImage.ts`'s doc comment: it's deliberately static/textless).

**Decision (confirm with Thomas before implementing, don't just proceed silently):** add a
second, minimal, server-visible query param alongside the existing fragment, carrying ONLY
what a preview card needs — not the full payload:

```
/challenge?og=<base64url of {n: challengerName | null, c: puzzleCount}>#<existing fragment>
```

- The fragment keeps carrying the full replay payload exactly as today — zero changes to
  `codec.ts`, `schema.ts`, `useChallengeSession`, or any existing test.
- The new `og` param is small, forgeable (same posture as the rest of this payload), and
  **is** visible to Cloudflare's edge logs and whatever PostHog captures for the pageview
  (check `src/telemetry` — do we capture full URL/query string today? If PostHog's pageview
  capture includes query strings, note that in the privacy update in Part C: a challenger's
  self-chosen display name becomes visible in analytics for this route, which wasn't true
  before). This is a real, if minor, change to the "nothing about a challenge reaches the
  server" design intent that `codec.ts`'s comment states as deliberate — flag it as a
  tradeoff being made, don't silently reverse the original design decision without saying so
  in the PR description.
- `totalMs` is deliberately left OUT of the `og` param for v1 — keeps the card generic
  ("Alex challenged you to 5 puzzles") rather than needing to also duplicate/format timing
  data server-side. Add it later if the card's worth improving.

If Thomas would rather not put anything about a challenge into a server-visible query string
at all, the fallback is: ship the generic static card as-is (no per-challenge text) and treat
this whole OG-card effort as not worth doing pre-v5. Don't build a fake "dynamic" card that's
actually still generic — that's wasted work. **Stop and confirm this tradeoff before writing
the Pages Function.**

## Part A — Dynamic OG card (Phase 1: text only, no dynamic image)

Scope Phase 1 to title/description text only. A bespoke per-challenge raster image is a nice-
to-have (Phase 2, optional, not in this pass) — most of the "looks real, not spam" value in a
text link preview comes from the title/description, not a custom image, and it avoids pulling
in an image-rendering runtime (Satori/`workers-og` or similar) for a first pass.

1. `src/challenge/codec.ts`: add `buildChallengeOgParam(challengerName, puzzleCount)` and
   `decodeChallengeOgParam(encoded)` — same base64url style as the existing codec, own small
   schema (`{ n: string | null, c: number }`), same "any failure collapses to null" contract.
   `buildChallengeUrl` gains the `og` query param alongside the existing fragment (keep the
   fragment first-class; query param is additive, not a replacement).
2. New Cloudflare Pages Function, `functions/challenge.ts` (no `functions/` dir exists yet —
   this is new, and it is genuinely new infra, even though it needs no D1/Clerk/auth. Say so
   plainly in the PR description so it doesn't get mentally lumped in with "no backend
   touched"). On a GET to `/challenge`:
   - Fetch the static asset via `env.ASSETS.fetch(request)` (standard Pages Functions
     pattern — this is NOT a rewrite of routing, just an interception point).
   - If the `og` query param is present and decodes successfully, use `HTMLRewriter` (built
     into the Workers/Pages runtime — prefer this over manual string/regex replacement on
     the HTML) to replace `og:title`, `og:description`, `twitter:title`, `twitter:description`,
     and `<title>` with challenge-specific copy, e.g.:
     - Named: `"{name} challenges you — {n} puzzles, one shot"` /
       `"Beat {name}'s time on {n} coding puzzles."`
     - Anonymous (`n` null, matches the existing "A friend challenged you!" fallback copy
       already used in `ChallengePage.tsx`): `"A friend challenges you — {n} puzzles"`.
   - No `og` param, or it fails to decode: pass the asset through untouched (today's generic
     card). Same "reject wholesale, one legible fallback" convention the codec already uses.
   - `og:image`/`twitter:image` stay pointed at the existing static `og-image.png` in Phase 1.
3. Update `ChallengeButton.tsx` / wherever `buildChallengeUrl` is called to pass through
   `challengerName` and the puzzle count it already has at hand — this should be a small
   diff, the data's already local to the call site.
4. Tests: extend `codec.test.ts` for the new encode/decode pair (mirror its existing
   "garbage in -> null" coverage). Pages Functions are harder to unit test in this stack —
   at minimum verify the HTMLRewriter logic against a fixture HTML string; don't skip
   verification just because it's a new surface.

## Part B — Pre-launch email list (capture only, no recipient-notification sending)

**Use Resend, not a third-party ESP.** Resend is already the decided vendor for v5.5's email
re-engagement (see [[codoro-v5-backend-security]]) — introducing Buttondown/ConvertKit/
Mailchimp now just to swap to Resend later is pure churn. Resend's Audiences/Contacts API
needs only an API key, no D1, no Clerk — it's a legitimate pre-v5 fit.

1. Create a Resend Audience for the pre-launch list (Thomas does this once in the Resend
   dashboard — not something Claude Code can do; needs the account).
2. New Pages Function, `functions/api/subscribe.ts`:
   - `POST` only, body `{ email: string }`.
   - Validate with zod: real email shape, reasonable length cap. Reject anything else with a
     generic 400 — no reflecting the input back, no verbose error detail (same spirit as the
     `reports` table's "no free-text column" posture in [[codoro-v5-backend-security]]).
   - Call Resend's create-contact endpoint server-side with the API key read from a Pages
     Functions secret (`RESEND_API_KEY`) — **never** expose this client-side, never put it in
     a public env var.
   - Basic abuse control before this ships, not after: this is an unauthenticated write, same
     category of risk the `/api/report` endpoint was explicitly built with per-IP rate
     limiting for (see [[codoro-v5-backend-security]]'s I9/I10/S-series discussion for the
     standard this codebase holds unauthenticated writes to). Cloudflare Pages Functions can
     rate-limit via KV (a simple per-IP counter with a short TTL) — add a KV namespace for
     this if one doesn't already exist. A honeypot field (hidden input real users never fill)
     is a cheap add-on, not a substitute for the rate limit.
   - Return a generic success/failure shape the frontend can show a toast for — don't leak
     whether an email already exists in the audience (that's a minor enumeration leak).
3. Frontend: a small, skippable, non-blocking opt-in — follow the existing
   `ChallengerNameSheet.tsx` / `useChallengerName.ts` pattern (same "skip never blocks
   anything" precedent already established for the challenger-name capture) rather than
   inventing a new interaction shape. Default placement: `ChallengeComparison.tsx`, after a
   recipient finishes a challenge (highest-intent moment, zero friction added to the actual
   challenge flow). A second, lower-priority spot on the challenge-creation side is optional
   — don't add it unless the first placement feels too thin; more signup asks isn't free.
   - Explicit opt-in checkbox/action, never pre-checked.
   - Microcopy states plainly what they're signing up for (product updates / launch news) and
     that they can unsubscribe anytime (true — Resend adds this automatically to every
     campaign send).
4. Track a `email_signup` telemetry event via the existing `src/telemetry` module, following
   its existing event-shape conventions (see `ChallengeCreatePayload` etc.) — surface only,
   never the email address itself into PostHog.

## Part C — Legal/privacy: this needs an interim page, not an "update"

**There is no privacy policy or ToS in this repo at all yet** (`docs/todo.md` items 15/16 —
both explicitly deferred wholesale to v5.6's single lawyer review). Don't touch, extend, or
half-write that real policy here — that lawyer review is still the one that matters and this
work doesn't replace it. What Part B needs is a small, clearly-labeled **interim** notice
sufficient to collect an email with honest consent in the meantime.

1. New route, e.g. `/privacy` (plain static page, matches the rest of the site's static-route
   pattern) containing a short, plain-language section: what's collected (email address
   only), why (product updates, no other purpose), who processes it (name Resend explicitly
   as the sub-processor, link Resend's own privacy policy), that it's never sold or shared
   beyond that, how to stop (unsubscribe link in every email, or ask directly), and — if the
   `og` query param from Part A shipped — a one-line note that a challenger's chosen display
   name may appear in usage analytics for challenge links. Header the page clearly as
   **interim**, explicitly says the full reviewed privacy policy + ToS are coming with
   accounts (v5.6), and that this page will be replaced then.
2. Link this `/privacy` page from the Part B opt-in's microcopy (small "see how we handle
   this" link next to the checkbox).
3. Update `docs/todo.md` items 15/16 with a one-line note that an interim privacy page now
   exists at `/privacy` for the email-capture flow, and that 15/16 still cover the real
   lawyer-reviewed policy + ToS at v5.6 — don't mark them done, they aren't.
4. **Flag to Thomas directly, don't just quietly assume it's handled** — these are calls only
   he can make, not something to invent copy for:
   - CAN-SPAM requires a real physical mailing address in the footer of every marketing email
     Resend sends (a PO box is fine and commonly used instead of a home address) — Resend
     supports this in its footer, but the address itself has to come from Thomas.
   - Sender identification must be truthful (no disguised "from" address/subject lines) and
     opt-outs need to be honored promptly — mostly automatic with Resend, worth a one-line
     confirmation it's configured that way, not a whole feature to build.
   - If any signups could plausibly come from EU visitors, GDPR's consent-and-right-to-
     deletion bar is a bit higher than CAN-SPAM's — flag it as a question for the real v5.6
     lawyer review, not something to solve here.

## Explicit non-goals for this pass

- Recipient email notification / "email them the challenge link" — deferred, overlaps v5.5.
- Per-challenge dynamic OG _image_ (Phase 2) — text-only card is Phase 1's scope.
- The real, lawyer-reviewed privacy policy + ToS — still v5.6, this is a stopgap only.
- Any D1/Clerk/account work — none of this should touch or assume the v5 backend exists.

## Stop-and-ask list (confirm before/while building, don't guess)

- The fragment → query-param tradeoff in the "critical architecture note" above — Thomas
  should sign off on putting `challengerName` + puzzle count somewhere server-visible before
  this is built, not discover it in the diff.
- Whether PostHog's current config captures full URLs/query strings on pageviews (changes
  what Part C's analytics disclosure line needs to say — check
  [[codoro-analytics-posthog]] / the actual PostHog init config, don't assume).
- Exact copy for the OG card text and the email opt-in microcopy — draft reasonable defaults
  above, but confirm final wording with Thomas rather than shipping placeholder copy as final.
- Whether a KV namespace already exists in this Cloudflare project for the rate limiter, or
  needs creating from scratch.

## Done-when

- A `/challenge` link with a challenger name unfurls in iMessage/Slack/etc. with that name
  and puzzle count in the title/description; a link with no name falls back to the existing
  generic "a friend challenged you" framing; a malformed/missing `og` param falls back to
  today's static card — no broken states.
- The existing challenge fragment/replay flow is unchanged and its tests still pass untouched.
- `POST /api/subscribe` adds a valid email to the Resend audience, rejects invalid input, and
  is rate-limited per IP; the frontend opt-in is skippable and never blocks challenge play.
- `/privacy` exists, is linked from the opt-in, is clearly labeled interim, and `docs/todo.md`
  15/16 reflect that without being marked done.
