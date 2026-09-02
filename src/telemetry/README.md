# telemetry/

PostHog wrapper — the single choke point for all analytics events. Everything
outside this directory imports from `./index.ts` (the barrel) only; nothing
else in the codebase should `import posthog from 'posthog-js'` directly, same
convention as `src/engine/` and `src/storage/`.

## Public API

- `initTelemetry(sanitizePathname?)` — configures the posthog-js singleton
  from `env.VITE_POSTHOG_KEY` / `env.VITE_POSTHOG_HOST` (see `src/env.ts`).
  Call once on app startup (see `src/main.tsx`, which always passes
  `routes.ts`'s `routePatternForPath`). `sanitizePathname` runs over the
  `$pathname`/`$current_url` properties posthog-js attaches to every event
  by default — see `client.ts`'s own doc comment for why that's necessary.
  Defaults to identity (pathname passed through unchanged) when omitted.
- `trackSessionStart()` — fires the `session_start` event. Call once per app
  session, alongside `initTelemetry()`. Takes no arguments — attribution
  (below) is computed internally on every call, so the one call site
  (`main.tsx`) is unaffected. Additive as of launch instrumentation Item 3:
  carries `referrer_host` (the referrer's bare hostname only — e.g.
  `reddit.com` — never the full referrer URL, which can carry search
  queries/paths; empty string for direct traffic or an unparseable
  referrer) and `utm_source`/`utm_medium`/`utm_campaign` (read from the
  landing URL's query string, `null` when absent — the only three query
  params ever read, since these are values Codoro itself authors onto its
  own campaign links). `session_start` previously had no payload at all;
  this is a pure addition, not a restructure.
- `registerAnonId(anonId: string)` (Phase 7 Item 6) — registers the stable,
  app-generated anonymous ID (`src/storage`'s `UserProfile.anonId`) as a
  PostHog super property (`posthog.register({ codoro_anon_id })`), so it's
  attached to every event captured afterward. Called once per app session
  from `src/main.tsx`, after the profile loads (not blocking
  `initTelemetry()`/`trackSessionStart()` — see main.tsx's own comment).
  This is **not** `posthog.identify()` — see the identity section below.
- `trackAttempt(payload: AttemptEventPayload)` — fires the `attempt` event.
  Property names are a locked schema shared with Daily/Rush in later phases —
  do not rename or restructure them.
- `trackRushAttempt(payload)` — fires the same `attempt` event as `trackAttempt`,
  with Rush's run-level context (`run_id`, `position_in_run`, `difficulty_served`,
  `timed_out`) appended. `timed_out` (Phase 5b Item 6) is true when this
  attempt's outcome came from the per-puzzle clock reaching 0 rather than a
  real tap — a strike either way, but distinguishable at analysis time.
  Additive only — the locked `AttemptEventPayload` fields are never renamed
  or restructured.
- `trackRushRunEnd(payload)` — fires once per completed Rush run with the final
  score/streak/difficulty, `ended_reason` (`'strikes' | 'clock'` — which
  trigger produced the run's final strike; Phase 5b Item 6), and
  `is_new_best_score` (true when this run's score just beat the profile's
  prior all-time best; Phase 5b Item 8 — never fires on a rating basis).
- `trackTraceAttempt(payload)` — fires the same `attempt` event as `trackAttempt`,
  with Trace's per-checkpoint context (`checkpoint_results`: an array of
  `{ correct, choice_index, timed_out }`, one entry per checkpoint on the
  puzzle, in answer order) appended. `choice_index` is nullable and
  `timed_out` is additive (Phase 5b Item 6): a checkpoint whose 30s clock
  reached 0 before an answer reports `choice_index: null, timed_out: true`.
  Additive only — the locked `AttemptEventPayload` fields are never renamed
  or restructured. Called once per completed puzzle (all checkpoints
  answered), not once per checkpoint; `mode` is `'practice'` since Trace
  shares Practice's rating pool.
- `trackPuzzleLinkView(payload)` — fires the `puzzle_link_view` event
  (`{ puzzle_id, interaction, found }`) once per `/puzzle/:id` page view.
  `interaction` is `null` and `found` is `false` when the id doesn't resolve
  to a real bundled puzzle — the signal someone shared a broken link.
- `trackPuzzleLinkAttempt(payload)` — fires the `puzzle_link_attempt` event
  (`{ puzzle_id, interaction, correct, time_ms }`) once a `/puzzle/:id`
  visitor completes an attempt. Deliberately separate from `trackAttempt`/
  `trackTraceAttempt` — `/puzzle/:id` attempts are never rated and must never
  enter the locked `attempt` event stream those fire. Per the Phase 1b build
  plan's decision not to record link attempts in storage at all, this event
  is the _only_ record that link play happened.
- `trackShareClick(payload)` — fires the `share_click` event
  (`{ surface, puzzle_id }`) whenever a share affordance is used — Daily and
  Rush's existing post-solve share cards, and Practice's solve-state share
  button (Phase 1b). `surface` is `'daily' | 'rush' | 'practice'`.
- `trackStreakPause(payload)` — fires the `streak_pause` event
  (`{ mode: 'practice' | 'trace', streak, is_new_best }`) whenever the
  streak-pause moment (Phase 5b Item 7/8) is shown. `is_new_best`
  distinguishes a pause that carried the "new best streak" framing from one
  that didn't.
- `trackChallengeCreate(payload)` — fires the `challenge_create` event
  (`{ surface, puzzle_count }`) whenever a "Challenge a friend" affordance
  produces a shareable challenge link (Phase 5c). `surface` is
  `'daily' | 'rush' | 'practice'`, plus `'challenge'` for a counter-challenge
  (the comparison screen re-encoding the recipient's own run); `puzzle_count`
  is how many puzzles the encoded challenge carries (≤ the cap — long runs
  truncate to their last 5).
- `trackChallengeLinkView(payload)` — fires the `challenge_link_view` event
  (`{ found }`) once per `/challenge` page view. `found: false` signals a
  challenge link that doesn't decode (malformed/truncated/unknown-version
  payload) or whose ids don't resolve to real bundled puzzles — the
  broken-link state.
- `trackChallengeLinkComplete(payload)` — fires the `challenge_link_complete`
  event (`{ beat_challenger }`) once a challenge recipient finishes their run
  and the comparison screen resolves. `beat_challenger` compares the
  recipient's total time against the challenger's `totalMs` (tie counts as
  not-beating). Challenge attempts are structurally unrated, so this event is
  the only record of a challenge's outcome.
- `trackError(error, context?)` — fires an `app_error` event with a truncated
  message/stack. Used by `src/app/ErrorBoundary.tsx`; call it directly for any
  other caught error worth reporting.
- `trackRouteView(payload)` — fires the `route_view` event (`{ route: string }`)
  once per distinct client-side route, including the very first render —
  launch instrumentation Item 1, the single most valuable data point at
  launch (where people land and where they leave). Fired from
  `src/app/useRouteTelemetry.ts`, called from `AppShell.tsx` (the one
  component mounted across every navigation). `route` is always a route
  PATTERN from `routes.ts`'s `routePatternForPath` — e.g. `/puzzle/:id`, never
  the raw pathname with its real id, and `/challenge` (which carries
  challenge payload data in its URL) always reports the literal `/challenge`
  pattern. Never a query string or hash. An unrecognized path reports
  `'unknown'`. Same known race as `trackSessionStart`: `registerAnonId`
  resolves after the profile loads, so the very first `route_view` of a
  session may rarely fire before `codoro_anon_id` is registered.
- `trackPageview()` — fires PostHog's own stock `$pageview` event
  ("site-flow funnel" follow-up), no explicit properties — the auto-attached
  `$current_url`/`$pathname` (sanitized, see `initTelemetry` above) carry
  the location. Called from `src/app/useRouteTelemetry.ts` at the exact
  same trigger point as `trackRouteView`. Sending PostHog's real
  `$pageview` name, rather than reusing `route_view`, is what unlocks
  PostHog's built-in Web Analytics dashboard, Paths, and exit-page reports.
- `trackFeedbackLinkClicked(payload)` — fires the `feedback_link_clicked`
  event (`{ surface: 'footer' | 'settings' }`) whenever the external Tally
  feedback link (`src/app/FeedbackLink.tsx`) is clicked, from either of its
  two placements (`AppShell.tsx`'s footer, `SettingsPage.tsx`'s own
  section) — `surface` says which one.

If `VITE_POSTHOG_KEY` is unset (local dev, or an ad-blocker prevents the
PostHog script from loading), every exported function silently no-ops. The
same holds if posthog-js itself throws inside `init()`/`capture()` — a
blocked or misbehaving analytics provider must never break the app.

We never call `posthog.identify()`. Every user stays on PostHog's default
anonymous `distinct_id`, and `person_profiles: 'identified_only'` means no
PostHog person profile is ever created for anyone.

**Retention identity (Phase 7 Item 6).** That wiring alone left day-2 return
— the metric `docs/roadmap.md`'s v3.0 gate names as "the honest signal" for
the v3 → v4 decision — unmeasurable: PostHog's own device-scoped anonymous
`distinct_id` doesn't reliably survive a site-data clear and doesn't
necessarily bridge the installed-PWA vs. browser-tab boundary, the two
places this app's users actually live. The fix attaches the app's own
stable `anonId` (generated once per device, in the profile store — see
`src/storage/schema.ts`'s `UserProfile.anonId`) as a **registered super
property**, not via `identify()`. See `src/telemetry/client.ts`'s
`registerAnonId` doc comment for the full mechanism decision (why a super
property over `identify()`, the person-profile billing question it avoids
by construction, and the "import collision" — a player importing a
friend's export file must never merge the two of them into one identity in
PostHog, handled in `src/storage/exportImport.ts`'s `commitImport`). This
changes _identity_, not _what is collected_: every capture toggle below
this point in the file stays exactly as locked. **Not yet verified live**
— no PostHog dashboard access was available in this environment to confirm
what retention PostHog actually computes from `identified_only` +
anonymous-only events with a custom super property, or that this ID
resolves to the same identity across a browser tab and the installed PWA
on a real deploy. Both are outstanding production checks — see
`docs/v2-build-plan.md`'s Phase 7 amendment.

## Sentry vs. PostHog-only for error tracking (V1 decision)

We're not adding Sentry. `trackError` routes render errors (via
`ErrorBoundary`) and any other caught errors through the same PostHog choke
point as everything else, at zero extra bundle/dependency cost. PostHog's
event stream (message + truncated stack + context) is enough to notice and
triage a broken deploy for V1's traffic volume; we don't yet have the volume
or need for Sentry's source-map-resolved stack traces, release tracking, or
issue-grouping UI. Revisit if/when error volume or the need for richer
crash-triage tooling justifies the added weight.
