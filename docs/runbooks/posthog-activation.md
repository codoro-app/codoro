# Runbook — activate PostHog telemetry in production

**Status: done.** `VITE_POSTHOG_KEY` is live on production (`getcodoro.com`) and has been since at least **2026-07-19** — confirmed via the live PostHog project (`session_start` "first seen" is 2026-07-19; the project token `phc_CEmmM3mEz8VcT75S97CUz68F74Pu3BFdu9KiUnHdzVL3` matches what production actually sends over the wire, and `POST us.i.posthog.com/e/` returns 200 from a real production page load). This section previously said "not done" — that was stale, not current: whoever set the Cloudflare env var and redeployed never came back to update this doc, which is exactly the kind of drift this repo's own precedent (5b decision 5) warns against. **Verified 2026-08-09.**

**Owner:** Thomas (Cloudflare Pages dashboard access required).
**Time:** ~15 minutes plus one deploy. (Already spent — nothing left to do here.)

---

## Why this is worth doing before Phase 6

Not for vanity metrics. Two decisions already on the roadmap are currently un-makeable without this data:

- **Phase 5's timer constants** (`15s` quiz / `30s` per checkpoint) are guesses. There is no attempt-duration distribution to size them against, because no `attempt` event has ever been recorded.
- **Phase 6 is content calibration.** Calibrating difficulty ratings against real solve rates is the entire point of that phase, and solve rates come from the `attempt` event. Without telemetry, Phase 6 recalibrates by feel — which is what v1 did, and what `docs/v1-retro.md` names as a content weakness.

There is also a standing accuracy problem: `src/app/legal/LegalPage.tsx:32` already tells users the app collects anonymous usage data via PostHog. Right now that statement describes collection that isn't happening. Turning it on makes the published notice true rather than requiring a notice change.

---

## What is actually wrong

Nothing in the code. `src/telemetry/` is correctly written and correctly gated — do not "fix" it.

The chain:

1. `src/env.ts` declares `VITE_POSTHOG_KEY: z.string().optional()`.
2. `src/telemetry/client.ts`'s `loadPosthog()` returns `null` when `env.VITE_POSTHOG_KEY` is falsy, so `initTelemetry()` and every `safeCapture()` return early and `posthog-js` is never even dynamically imported.
3. `src/main.tsx:12-13` calls `initTelemetry()` and `trackSessionStart()` on boot, as designed.

So the app is doing exactly what it was told: no key, no telemetry. The key was never set on the production build.

**The critical detail that makes this easy to get wrong:** `VITE_*` variables are inlined by Vite **at build time**, not read at runtime. Setting the variable in Cloudflare and not rebuilding changes nothing — the already-deployed bundle has the `undefined` baked in. A redeploy is mandatory, not optional.

---

## Steps

### 1. Get the PostHog project API key

PostHog → **Settings → Project → Project API key**. It starts with `phc_`.

Note the **region** on the same screen. US projects use `https://us.i.posthog.com`; EU projects use `https://eu.i.posthog.com`. `src/env.ts` defaults to US — if the project is EU, `VITE_POSTHOG_HOST` must be set too or every event silently posts to the wrong region.

This key is **public by design**. It gets inlined into the client bundle and is visible to anyone who views source. That is how PostHog's browser SDK works — it is a write-only ingestion key, not a secret. Do not treat leaking it as an incident. (Contrast `ANTHROPIC_API_KEY` in `.env.example`, which is deliberately _not_ `VITE_`-prefixed precisely so it can never reach the bundle.)

### 2. Set the variables in Cloudflare Pages

Cloudflare dashboard → **Workers & Pages → codoro → Settings → Environment variables** (labelled _Variables and Secrets_ in newer dashboard versions).

Add to the **Production** environment:

| Name                | Value                                                  |
| ------------------- | ------------------------------------------------------ |
| `VITE_POSTHOG_KEY`  | `phc_...`                                              |
| `VITE_POSTHOG_HOST` | only if the project is EU — `https://eu.i.posthog.com` |

Plain variable or encrypted secret both work; both are available to the build. Plain is fine given the key is public anyway, and plain is readable later when you're wondering whether it was ever set.

**Also add them to the Preview environment** if you want preview deploys instrumented. Consider deliberately _not_ doing this — preview traffic is you testing, and it will pollute the same project's data with events that aren't real users. If you do instrument previews, set a separate PostHog project key for them rather than mixing.

### 3. Redeploy

**Deployments → the current production deployment → Retry deployment**, or push any commit to `main`.

Retrying an existing deployment re-runs the build, so it does pick up new environment variables. If you want certainty, push a commit — a fresh build from a fresh trigger removes all doubt.

### 4. Verify — do not skip this, it is the whole point

The failure this runbook exists to prevent is "set the variable, assume it worked, discover in Phase 6 that there's still no data."

1. **Bundle check.** Open `getcodoro.com`, view source / check the built JS assets, and search for `phc_`. If the key isn't in the bundle, the build didn't pick up the variable — go back to step 2 and confirm you set it on **Production**, not only Preview.
2. **Network check.** DevTools → Network → filter `i.posthog.com`. Load the site and solve one puzzle. You should see requests. **Disable ad blockers and use a clean browser profile** — uBlock and friends block PostHog by default, and a blocked request looks identical to a broken config from the outside. This is the single most common false negative here.
3. **PostHog check.** PostHog → **Activity** (live event feed). You should see `session_start` on load, then `attempt` after solving. Both are defined in `src/telemetry/events.ts`.

If the bundle contains the key but no network requests fire, the problem is client-side (blocker, or `disable_external_dependency_loading` interacting with something) — not the config. If requests fire but nothing lands in PostHog, check the region/host.

### 5. Backfill nothing

There is no historical data to recover. Everything before this deploy is gone and was never captured. Phase 6 calibration should be scheduled far enough after activation to have accumulated a usable sample — which, at current traffic, is worth checking before assuming a week is enough.

---

## What this does _not_ turn on

Worth knowing so you don't go looking for data that was deliberately never collected. `src/telemetry/client.ts` explicitly disables autocapture, session recording, surveys, dead-click detection, and web-vitals capture, plus `disable_external_dependency_loading` as a blanket guard.

**Pageviews and exit pages are on**, as of the "site-flow funnel" follow-up: `$pageview` (hand-fired from `useRouteTelemetry.ts`, once per distinct route) and `$pageleave` (posthog-js's own automatic exit-page signal, `capture_pageleave: true`) — both ordinary anonymous events, same free-tier bucket as everything else, no person profile involved. `$current_url`/`$pathname` are sanitized via `client.ts`'s `before_send` hook (real puzzle ids/challenge payloads never leave the device) before either event ships. This is what feeds PostHog's built-in Web Analytics dashboard, Paths, and exit-page reports.

Everything else in the locked schema is unchanged — see `src/telemetry/README.md` for the full event list.

**Your own testing traffic may still be mixed into this data.** `VITE_POSTHOG_KEY` is confirmed set on Production only (2026-09-01), not Preview — but a live PostHog Activity pull the same day showed `session_start` firing from several `*.codoro.pages.dev` URLs alongside `getcodoro.com`. That's not a Preview-environment leak: Cloudflare Pages gives every deployment, production included, its own auto-generated per-deployment subdomain in addition to the custom domain, and that subdomain carries whatever env vars the deployment was built with — Production's key included. So any QA click on a production deploy's `*.pages.dev` alias (rather than `getcodoro.com` itself) ships real telemetry, indistinguishable from a real visitor except by `$host`. If you want funnel/pageview numbers clean of this, filter to `$host = getcodoro.com` when you build the funnel below (there's no environment-level toggle for it, since it's the same Production key either way) — or just get in the habit of testing against `getcodoro.com`/`localhost` rather than a deploy's own alias.

## Building the site-flow funnel in PostHog

Once this ships and redeploys, in PostHog:

1. **Insights → New insight → Funnel.**
2. Add steps as `$pageview` events, filtered by `$pathname` for each step you care about — e.g. Step 1: `$pageview` where `$pathname = /`; Step 2: `$pageview` where `$pathname` is one of `/practice`, `/daily`, `/rush` (any mode page); Step 3: `attempt` (first real puzzle interaction); Step 4 (optional): `$pageview` again on a later day, to see day-2 return.
3. Set the conversion window to whatever's meaningful (a single session vs. a return visit needs a longer window, e.g. 7 days).
4. For **exit pages** specifically (where people actually leave), PostHog's Web Analytics dashboard has a built-in paths/exit-page breakdown once `$pageview`/`$pageleave` are flowing — no funnel needed for that one, it's automatic.

Filter to `$host = getcodoro.com` first (see the note above), or your own deploy-alias QA clicks will be counted as real users.

## Related

- `src/telemetry/README.md` — the event schema and the choke-point convention
- `docs/v2-backlog.md` — the original "telemetry found completely inactive" finding
- `src/app/legal/LegalPage.tsx` — the privacy notice this makes accurate
