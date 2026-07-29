# Prompt for Claude Code — v2 Phase 1a (URL routing)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**Check the branch state before anything else.** `origin/main` was at `c9f2405` when this was written. Three commits lived only on `v2-phase-0-hotfix`: `65fdb47` (requeue starvation), `061ce8c` (touch axis-lock), `0e51d58` (plan amendment), plus a Phase 0 close-out commit adding the "Known open defects" table and the 1a/1b split. **If that branch isn't merged into `main`, stop and say so.** Branching 1a off a `main` missing the gesture fixes means this phase's real-device testing re-surfaces bugs that are already fixed, and nobody will be able to tell which build they're looking at.

Standing rules, unchanged: `src/app/pwa/` is hands-off (list any touched file there in your summary), zero new dependencies **except the one authorized below**, no hex outside `index.css`, no AI attribution in commits.

Scope is `docs/v2-build-plan.md` **Phase 1a**. Read that section, the Phase 1 amendment explaining the 1a/1b split, and the "Known open defects" table before writing code. The plan is authoritative and has already been amended to match this prompt — they should not disagree. If they do, the plan wins and you tell me. Append an amendment at the end of the phase if your work contradicts it; silent divergence is the failure mode here, and it has bitten this repo before.

---

## Why this is 1a and not "Phase 1"

Phase 1 originally bundled routing with a shareability feature. They've been split, and **1b is gated on the Phase 2 scrubber go/no-go.** Reason, from the plan's own locked decisions: shipping share affordances and puzzle-link URLs for an app with no users and no marketing planned in v2, before you know whether the flagship interaction is any good, is the same front-loading-infrastructure-over-validation mistake v1's retro named. Routing is different — it's a real prerequisite (Phase 7's code splitting depends on it, and retrofitting a router after Phases 3–4 add scrubber surfaces costs more).

**Concretely: `/puzzle/:id` is not in this phase.** Neither are share affordances, share telemetry, or the OG unfurl decision. If you find yourself designing for a puzzle-link route, stop — you're in 1b. Do not add a `/puzzle/:id` placeholder, a `:id` param type, or a "we'll need this later" seam. 1b will design it with the storage and telemetry decisions in hand, and a speculative seam built now will be wrong in a way that's expensive to notice.

---

## What exists today

No router at all. `src/app/App.tsx` holds `AppMode` (`'practice' | 'daily' | 'rush' | 'home' | 'legal'`) in `useState`, renders a lazy chunk per mode, and threads `onModeChange` through `AppShell` → `ModeSwitcher` / `NavRail` / the footer legal link / the mobile brand button / `Home` / `LegalPage`.

Two behaviors in `App.tsx` are load-bearing, easy to destroy while swapping in a router, and will not fail loudly if you break them. **Preserve both, and cover both with a test that would catch the regression:**

1. **The first-visit boot rule.** `resolveBootMode()` reads `codoro:has-visited` from localStorage and boots a first-ever launch into Practice, every later launch into Home — deliberately, to protect the "solving within ~10 seconds" cold-start promise. With routing, `/` has to keep making that decision. Don't quietly turn `/` into "always Home." Note the read-and-mark-in-one-pass is intentional (documented in its doc comment); keep it atomic.
2. **The boot-chunk prefetch.** `modeImporters[bootMode]()` is fired inside `useState`'s initializer so the landing chunk's fetch overlaps app startup instead of waiting for Suspense to discover it during first render. Route-based splitting must survive — Phase 7 depends on it — but so must this eager prefetch. A router that only discovers the chunk during render silently regresses first paint, and Phase 7 is already hunting ~58 KB.

---

## Dependency authorization

**wouter is authorized. Nothing else.** ~2 KB vs react-router's ~20 KB, for a six-entry route table, in a repo where Phase 7 has to find ~58 KB.

If you conclude wouter genuinely can't do something 1a needs, **stop and report rather than swapping in react-router on your own authority.** Bundle budget is a locked Phase 7 constraint, not a preference. (Nothing in 1a should strain it — there isn't even a param route in this phase.)

---

## Item 1 — Route table

`/` (boot decision), `/practice`, `/daily`, `/rush`, `/browse`, `/legal`.

`AppMode` is replaced by the route. `NavRail`, `ModeSwitcher`, the `AppShell` footer legal link, the mobile brand button, and `Home`'s CTAs all become **real links** — `<a href>` under the hood, not buttons with `navigate()` handlers. Middle-click and cmd-click opening a new tab is most of the point of having URLs. `LegalPage`'s and `Home`'s `onNavigate` props go away.

`AppShell` currently mounts both `ModeSwitcher` and `NavRail` unconditionally and lets CSS media queries decide which is visible — that's a deliberate "no JS breakpoint logic for layout" rule documented in its header. **Keep it.** Both become link sets; neither becomes conditional.

`/` is the only route with logic in it. Implement the boot decision as a redirect (first-ever visitor → `/practice`, returning → `/home` or render Home at `/`, your call — say which and why), and make sure a hard refresh of `/` doesn't double-write `codoro:has-visited` or flash the wrong page.

## Item 2 — Extract `/browse`

Browse currently lives inside `PracticePage`'s `view` state machine, where Phase 0 deliberately left it: Phase 0 fixed the desktop master-detail defect _within_ that machine (`view === 'patterns' && !isDesktop` early return) and explicitly deferred the routing extraction to here.

**This is the riskiest item in 1a**, because it touches code that shipped days ago and has not yet been verified on a real screen. Sequence it defensively:

1. First commit: characterization tests at both widths against the _current_ behavior — desktop shows the pattern list and an interactive puzzle side by side and selecting a pattern re-serves; mobile shows the full-screen picker. If Phase 0's tests already cover this, say so and skip rather than duplicating.
2. Then extract, with those tests unchanged and still green.

Desktop master-detail behavior is preserved exactly. Mobile keeps the full-screen picker — that's a layout decision, not a routing one, and it doesn't change. **`view === 'mastery'` stays internal state**; it isn't in this phase and pulling it out is scope creep. If extracting Browse genuinely forces mastery out too, stop and explain rather than doing it quietly.

Compose from the existing design system — tokens, card surfaces, chip and progress-track styles in `practicePage.css`. If a genuinely new visual pattern is needed, flag it for a Claude Design round instead of inventing one.

## Item 3 — Cloudflare Pages deep-link serving

**There is no `public/_redirects` file.** Cloudflare Pages serves `public/404.html` for any path that doesn't match a static file. So today a cold load of `getcodoro.com/legal` — the exact thing 1a's DoD requires to work — hits 404.html, not the app. Every route you add in Item 1 is dead on production until this is fixed.

The reflex fix is `/* /index.html 200`. **Don't ship that.** It makes every URL on the domain return 200 with the app shell, which kills the "bad path returns 404" requirement carried over from Phase 0 and is bad for crawlers.

Enumerate the real routes as exact rules and let everything else keep falling through to `404.html`. There is no wildcard route in 1a — `/puzzle/*` is 1b's problem, and 1b will have to decide whether an unknown puzzle id is a soft 404, which is a genuinely different question. Don't pre-solve it.

Verify rule ordering and the interaction with `public/_headers` (which sets `no-cache` on `/sw.js` and immutable caching on `/assets/*`). **State in your summary exactly what a request to `/nonsense` returns after your change**, as a status code, not a description.

## Item 4 — Service-worker navigate fallback

`vite.config.ts` sets `workbox.navigateFallback: '/index.html'` with **no `navigateFallbackDenylist`**. Once the SW is installed, _every_ navigation — including deliberately bad paths — is served index.html from cache. So 404 behavior differs between a first visit and the installed PWA, and the production 404 check silently passes or fails depending on which one was tested. That's worse than either behavior on its own, because it makes the check unreliable rather than wrong.

`vite.config.ts` is not inside `src/app/pwa/`, so it's in bounds — but the SW's update semantics are exactly what the hands-off rule protects. **Make the minimal change (a denylist), explain it, and do not touch `registerType: 'prompt'`, `injectRegister`, or the update flow.** The comment block above `registerType` explains why prompt-not-autoUpdate is deliberate; leave it intact.

Write down explicitly, in the PR, **how a 404 should behave in the installed PWA versus a browser tab after your change.** That's what I'll be checking against on a real phone, and if it isn't written down I have no way to tell a pass from a fail.

## Item 5 — Per-route meta, focus, scroll

- Per-route `<title>` and meta description. **Browser- and screen-reader-facing only.** Unfurl bots don't run JS, so this does not fix link previews — that's 1b's decision (option b1, prerendering, is written up in the plan). Don't attempt it here and don't add a prerender hook "while you're in there."
- Update `404.html`'s link — it currently points at `/`, which is fine, but check nothing else in it references a mode that's now a route.
- **Route-change focus and scroll management.** A router regresses both by default: focus stays on the clicked link (or resets to `<body>`), and scroll position persists across navigations. Move focus to the new page's heading and reset scroll on navigation, excluding back/forward where restoring scroll is correct. This is an a11y regression nobody notices for months, which is why it's a DoD line and not a nice-to-have.

---

## Definition of done — code

- [ ] All six routes render; nav is real links (cmd-click opens a new tab); back/forward behaves
- [ ] `/` still boots a first-ever visitor into Practice and a returning one into Home, with a test; no double-write of `codoro:has-visited`, no wrong-page flash
- [ ] Route-level code splitting intact **and** the landing route's chunk still prefetched eagerly, with a test that would catch losing it
- [ ] `/browse` is a real route; desktop master-detail preserved from Phase 0, mobile picker unchanged, both widths tested, `view === 'mastery'` untouched
- [ ] Route changes move focus to the new page heading and reset scroll; back/forward restores scroll
- [ ] `_redirects` enumerates real routes; `/nonsense` still returns a real 404; no `/*` catch-all
- [ ] SW `navigateFallbackDenylist` added; PWA-vs-tab 404 behavior written down in the PR; `registerType`/update flow untouched
- [ ] Per-route `<title>`/description; `404.html` links checked
- [ ] `pnpm validate` green; exactly one new dependency (wouter)
- [ ] Bundle-size delta reported as a number — Phase 7 needs the baseline

## What you verify vs. what's on me

**Yours:** everything above.

**Mine (do not attempt, do not check off):**

- Cold load of `getcodoro.com/legal` and the other routes on production
- `/nonsense` returning a real HTTP 404 on production, in a browser tab **and** in the installed PWA
- PWA install + launch + SW update prompt against a real deploy, post-routing
- OD-1 device repro

**OD-1 — do not touch, but help me capture it.** The "Known open defects" table has OD-1: swipe still unreliable on a real phone after both Phase 0 gesture fixes. **Not yours to fix in this phase** — do not modify `SwipeBinary.tsx`'s gesture config or `gestureThreshold.ts`, and do not retune `DEFAULT_SWIPE_THRESHOLD`. But 1a forces a real-device PWA pass anyway, so if something you're already building makes the repro cheaper to capture — a dev-only route or query-param overlay showing resolved gesture values, behind the existing `DevPuzzleToggle` dev-tools pattern and not shipped to production — **mention it as an option in your summary with a cost estimate. Don't build it unprompted.**

Also: if anything in this phase changes what I need to check on device, say so explicitly at the end of your summary.

## Orchestration

- Branch `v2-phase-1a`, PR into `main` when green.
- Commit order: wouter + route table with pages still rendering as-is → nav components converted to links → boot-rule and prefetch preservation with tests → Browse characterization tests → Browse extraction to `/browse` → focus/scroll management → `_redirects` + SW denylist + per-route meta. Each commit independently green. The nav-to-links commit is the one most likely to break tests broadly — keep it isolated so a bisect is readable.
- Delegate to a subagent: the mechanical `onNavigate` → `<Link>` conversion across nav components, `_redirects` rule generation, and test boilerplate. **Keep your strongest reasoning on the `_redirects`/SW-denylist interaction and the boot-rule-plus-prefetch preservation** — those are the two places a wrong call passes every test and only shows up in production or in a first-paint regression nobody attributes to this phase.
- When done, report: the route table as shipped and how `/` implements the boot decision; exactly what `/nonsense` returns in a browser tab vs. the installed PWA; the bundle-size delta as a number; what the Browse extraction touched and whether Phase 0's tests already covered it; anything you couldn't compose from the existing design system; and anything that changes my device checklist.
