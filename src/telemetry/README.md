# telemetry/

PostHog wrapper — the single choke point for all analytics events. Everything
outside this directory imports from `./index.ts` (the barrel) only; nothing
else in the codebase should `import posthog from 'posthog-js'` directly, same
convention as `src/engine/` and `src/storage/`.

## Public API

- `initTelemetry()` — configures the posthog-js singleton from
  `env.VITE_POSTHOG_KEY` / `env.VITE_POSTHOG_HOST` (see `src/env.ts`). Call
  once on app startup (see `src/main.tsx`).
- `trackSessionStart()` — fires the `session_start` event. Call once per app
  session, alongside `initTelemetry()`.
- `trackAttempt(payload: AttemptEventPayload)` — fires the `attempt` event.
  Property names are a locked schema shared with Daily/Rush in later phases —
  do not rename or restructure them.
- `trackRushAttempt(payload)` — fires the same `attempt` event as `trackAttempt`,
  with Rush's run-level context (`run_id`, `position_in_run`, `difficulty_served`)
  appended. Additive only — the locked `AttemptEventPayload` fields are never
  renamed or restructured.
- `trackRushRunEnd(payload)` — fires once per completed Rush run with the final
  score/streak/difficulty.
- `trackTraceAttempt(payload)` — fires the same `attempt` event as `trackAttempt`,
  with Trace's per-checkpoint context (`checkpoint_results`: an array of
  `{ correct, choice_index }`, one entry per checkpoint on the puzzle, in
  answer order) appended. Additive only — the locked `AttemptEventPayload`
  fields are never renamed or restructured. Called once per completed puzzle
  (all checkpoints answered), not once per checkpoint; `mode` is `'practice'`
  since Trace shares Practice's rating pool.
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
- `trackError(error, context?)` — fires an `app_error` event with a truncated
  message/stack. Used by `src/app/ErrorBoundary.tsx`; call it directly for any
  other caught error worth reporting.

If `VITE_POSTHOG_KEY` is unset (local dev, or an ad-blocker prevents the
PostHog script from loading), every exported function silently no-ops. The
same holds if posthog-js itself throws inside `init()`/`capture()` — a
blocked or misbehaving analytics provider must never break the app.

We never call `posthog.identify()`. Every user stays on PostHog's default
anonymous `distinct_id`.

## Sentry vs. PostHog-only for error tracking (V1 decision)

We're not adding Sentry. `trackError` routes render errors (via
`ErrorBoundary`) and any other caught errors through the same PostHog choke
point as everything else, at zero extra bundle/dependency cost. PostHog's
event stream (message + truncated stack + context) is enough to notice and
triage a broken deploy for V1's traffic volume; we don't yet have the volume
or need for Sentry's source-map-resolved stack traces, release tracking, or
issue-grouping UI. Revisit if/when error volume or the need for richer
crash-triage tooling justifies the added weight.
