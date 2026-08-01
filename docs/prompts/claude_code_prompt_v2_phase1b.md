# Prompt for Claude Code — v2 Phase 1b (shareable puzzle links: `/puzzle/:id`)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**Check the branch state before anything else.** This phase requires **both** of the following in `main`'s history:

1. The Phase 3 merge (`v2-phase-3`, Trace mode). `/puzzle/:id` renders a puzzle **in its native interaction type**, and for a scrubber puzzle that renderer did not exist before Phase 3. This gate is written into the plan (Phase 1b's own heading) precisely so this phase can't recreate the Phase 2 corrective's P0 — an interaction type reachable with nothing to render it — at the shareable-link surface.
2. The **Phase 3 corrective** covering the two post-merge review findings (`next-line` choice-label base mismatch; masked-value leak via an aliased sibling variable). If that corrective isn't merged, stop and say so: this phase reuses Trace's renderer directly, and building share links on top of a renderer with a known player-facing correctness bug means every shared scrubber link ships that bug to a stranger — the single worst surface to ship it on.

If either is missing, stop and report rather than working around it.

Work on `v2-phase-1b` off `origin/main`, PR back to `main`.

Scope is `docs/v2-build-plan.md` **Phase 1b**. Read that section (build items 1–5 and its DoD), plus the Phase 1a section's **Amendment 3 and Amendment 4** — Amendment 4 in particular, because three of its four defects were route-registry defects and this phase adds the first _dynamic_ route in the app, which breaks assumptions two of those fixes baked in. The plan is authoritative. Append an amendment if your work contradicts it; silent divergence is this repo's named failure mode.

Standing rules, unchanged: `src/app/pwa/` is hands-off (list any touched file there in your summary), no hex outside `src/index.css`, no AI attribution in commits, `pnpm validate` must not require Python, `src/engine/` stays React-free, `selectNext` untouched, telemetry stays snake_case and additive. **Zero new dependencies.**

---

## Decisions — locked, do not relitigate

1. **Link attempts are not recorded at all** (build item 2, option 3 — the plan's own recommendation). Do not add a fourth `AttemptMode`, do not reuse `'rush'`, do not bump the storage schema. `shouldRateAttempt` is not touched. "Never rated" becomes structurally true — there is no code path from `/puzzle/:id` to `appendAttempt` or `saveProfile` — rather than dependent on a correctly-written switch case someone could later get wrong. Consequence you must own: the telemetry in Decision 3 is then the _only_ record that link play happened, which is exactly why item 3 is not optional.
2. **OG unfurls: option (a) — accept the generic site card for v2.** Client-side `<meta>` updates do not affect unfurls; Twitter/Slack/iMessage/Discord read served HTML and never run the JS. Do not build prerendering (b1) or per-puzzle OG images (b2) in this phase. Your amendment must **price (b1)** concretely (count the routes it would emit, name the Vite hook, estimate the build-time cost) and hand that number to Phase 7, which wants prerendering for Lighthouse anyway. Recording "we chose (a)" without the (b1) price is an incomplete deliverable — the plan's DoD line asks for the real cost.
3. **`/puzzle/:id` consumes `puzzlePool`** — the full union, every interaction type. This is the one app-facing surface where the full union is genuinely correct, and it is the reason `puzzlePool` still exists as an export alongside `quizPool`/`scrubberPool`. Do not add a filter; do not "be safe" and serve `quizPool`.
4. **Out of scope, do not drift into:** Phase 4 (scrubber content pipeline/volume), Phase 5 (quiz mode upgrades), Phase 7 (prerendering, code-splitting work, bundle reclaim), unifying Daily's and Rush's parallel `shareText`/`ShareCard` implementations, any rating/selection behavior change, Daily serving a scrubber puzzle.

---

## How to run this: orchestration

Run this as an orchestrator. You (the lead) own sequencing, design judgment, and the merge decision. Delegate via the Task tool by the nature of the work:

- **Haiku subagents** — mechanical work: enumerating every surface that would host a share affordance; running the suite and reporting failures; grepping the built `dist/` at the gate; auditing that no rated-mode session hook changed.
- **Sonnet subagents** — bounded implementation from a written brief: each item below, once you've made the calls it flags to you.
- **Lead (you)** — the design calls: the dynamic-route registry problem (Item 1's hardest part), the dispatch seam, the (b1) pricing, and the amendment prose. Do not delegate amendment wording.

**Review loop — mandatory, per item.** After each item, spawn a **fresh reviewer subagent (sonnet, no prior context)** with the item's brief and the diff, asking: _does the test fail if the fix is reverted?_ The reviewer checks mechanisms, not end states — e.g. delete the `appendAttempt` guard and confirm the unrated test goes red; drop `/puzzle/*` from `_redirects` and confirm the drift guard catches it. Loop until clean, then commit. Granular commits, one concern each.

Phase 3's review loop caught a real synchronous double-click race that every existing test passed through, and Phase 3's own _post-merge_ review still caught two player-facing defects that the whole suite plus a fresh final reviewer missed — both because every test asserted against synthetic fixtures rather than the real content pool. **Take that lesson literally in this phase:** at least one test per item must exercise the real bundled pool, not a hand-built fixture.

---

## What exists that you build on — read before designing

- `src/app/trace/TraceRunner.tsx` — already split into an outer `TraceRunner` (owns the `useTraceSession` instance) and an inner **`TraceRunnerPuzzle`** (pure props: `puzzle`, `checkpointResults`, `isComplete`, `solved`, `ratingDelta`, `onCheckpointAnswered`, `onContinue`; owns only `stepIndex`). **`TraceRunnerPuzzle` is your reuse seam for scrubber links** — it already has no session dependency. Export it and drive it from unrated local state. Do not fork it, do not import `useTraceSession` on this surface, and do not add an `unrated` prop to the session hook.
- `src/app/practice/PuzzleCardShell.tsx` — the quiz-side renderer. Two things to know: its prop is typed `puzzle: Puzzle` (**the full union — the type system will not stop you from handing it a scrubber puzzle**), and its `case 'scrubber'` deliberately **throws** with a message about serving from `scrubberPool`. So a missed dispatch is a runtime crash on a shared link, not a blank card. Either narrow that prop to `QuizPuzzle` as part of this phase (preferred — it turns your dispatch obligation into a compile error) or prove the dispatch with a test against the real pool. Say which you chose and why.
- `src/app/daily/ShareCard.tsx` + `src/app/daily/shareText.ts`, `src/app/rush/RushShareCard.tsx` + `src/app/rush/shareText.ts` — the two existing, deliberately parallel share implementations. Follow that convention for Practice's solve state rather than unifying all three (locked, Decision 4).
- `src/telemetry/events.ts` — `trackTraceAttempt` is the precedent for adding an event without disturbing the locked schema. Additive snake_case only; `src/telemetry/README.md` updates in the **same commit**.
- `src/app/routes.ts` — `ROUTES`, `ROUTE_META`, `labelForPath`. Note `labelForPath` currently does an exact-path lookup with two hardcoded special cases (`/`, `/browse`); a dynamic route has no exact path to look up, and this function feeds `AppShell`'s `<main aria-label>` (Phase 1a Amendment 1's accessibility mechanism). Decide what a `/puzzle/:id` page announces to a screen reader.

---

## Item 0 — The first-ever-visitor deep-link hazard (read before Item 1; it may or may not need code)

`App.tsx`'s boot redirect is correctly scoped — `bootMode` is `null` unless `window.location.pathname === '/'`, so deep-linking to a real route skips it, exactly as its doc comment claims. But there is a failure mode that only bites this phase, observed live while reviewing the Phase 3 corrective:

On the Cloudflare Pages **branch-alias** preview domain (`v2-phase-3.codoro.pages.dev`), a cold network request for `/trace` returned a 3xx (confirmed: `performance` navigation `redirectCount: 1`, and `fetch(..., {redirect:'manual'})` returned `opaqueredirect` for `/trace`, `/practice`, **and** `/rush` alike, while `/nonsense` correctly 404'd). The app therefore booted at `/`, `resolveBootMode()` saw a first-ever visitor, and pushed them to `/practice` — **the deep link was silently destroyed, with no error and no trace of the intended destination.** The same URL loaded correctly once a service worker was installed (the SW served the shell without touching the network), and correctly on the deployment-hash domain, so this is an artifact of that preview domain rather than a Phase 3 defect — the route registries themselves are right.

Why it matters here and nowhere else: every prior route is reached by someone who already has the app. `/puzzle/:id` is reached by **strangers**, who are first-ever visitors essentially by definition. Any condition that bounces a deep link to `/` — a preview domain, a trailing-slash canonicalization, a hosting rule someone adds later, an auth bounce — is converted by the boot redirect into "…and now you're in Practice," which looks to the sharer like the feature simply doesn't work.

**Decide, in writing, and record it in the amendment:** either (a) accept it, having confirmed the production apex domain does not redirect real routes (verify, don't assume — the check is the `fetch(..., {redirect:'manual'})` one above), or (b) make the loss recoverable, e.g. having the boot redirect preserve an intended path it was handed. Do not silently do nothing. If you choose (a), the verification you ran belongs in the amendment as evidence, not as an assertion.

## Item 1 — The dynamic route across all three registries (the hard part; do this first)

Every route so far has been a static literal, and both the SW-denylist mirror test and the `_redirects` drift guard were written against that assumption. `/puzzle/:id` breaks both. Work through each registry deliberately:

1. **`src/app/routes.ts`** — `ROUTE_META` is `Record<string, RouteMetaEntry>` keyed by literal path, and `routes.test.ts` iterates its keys to assert a matching `_redirects` line. Adding the key `'/puzzle/:id'` would make that test demand a `/puzzle/:id /index.html 200` line — **wouter's param syntax, which Cloudflare does not understand**. Decide how a dynamic route is represented here (a separate entry shape, a pattern→file-glob mapping, or keeping it out of `ROUTE_META` with its title/description set another way) and make the drift guard understand it rather than dropping the guard. Whatever you choose, the property "add a route and forget `_redirects` and a test goes red" must still hold — that guard exists because it didn't, once.
2. **`public/_redirects`** — needs `/puzzle/* /index.html 200`. Confirm this does **not** trip the existing "no `/*` catch-all" test (that test checks `line.startsWith('/*')`, and `/puzzle/*` does not — verify, don't assume) and that `/nonsense` still returns a real 404. Also decide and write down what `/puzzle/` (trailing slash, no id) and `/puzzle/nonsense` do: the first is a routing question, the second is build item 1's not-found state.
3. **`vite.config.ts`** — the denylist regex is currently `/^\/(?!(?:practice|daily|rush|browse|legal|trace)?(?:\?|$))/`. Every alternative is a bare segment with an optional query string; `/puzzle/<id>` has a **second path segment**, which no alternative admits, so the SW denies it the app shell offline. Extend the regex (only the regex — this file configures the PWA but is not `src/app/pwa/`; list the change explicitly in your summary) and update `routes.test.ts`'s hand-synced mirror with cases for a real id, a query string on a real id, `/puzzle/` bare, and `/nonsense`. Phase 1a Amendment 4 item 2 is the reference for why this regex is tested against `pathname + search`, not `pathname`.

**Tests:** the `_redirects` drift guard still catches a dropped line (prove it by dropping one); the denylist mirror covers the four cases above; cold deep-load verified **against the built `dist/`**, not the dev server.

Reviewer focus: drop `/puzzle/*` from `_redirects` → a test goes red. Revert the regex → the `/puzzle/<id>` mirror case goes red.

## Item 2 — `/puzzle/:id` page: dispatch, unrated, not-found

Renders any bundled puzzle from `puzzlePool` in its native interaction type, **unrated**, with a "practice more like this" CTA into `/practice` filtered to that puzzle's pattern. Bad id → a real in-app not-found state, not a crash and not a redirect.

- Dispatch: quiz interactions → `PuzzleCardShell`; `scrubber` → `TraceRunnerPuzzle` driven by local unrated state (accumulate `CheckpointResult`s, score with `scoreScrubberAttempt` for display only, never persist). See the seam notes above.
- Unrated: no `appendAttempt`, no `saveProfile`, no rating math that reaches storage. A displayed `ratingDelta` must be `null` on this surface, not a computed-but-discarded number.

**Tests:** dispatch asserted **against the real `puzzlePool`** — for every bundled puzzle id, the right renderer mounts and nothing throws (this is the test that would have caught the corrective's P0, and it is cheap); unrated asserted **at the storage/profile layer** (DoD wording — spy on the storage boundary and assert zero writes across a full solve, don't just read the code); bad id renders the not-found state.

Reviewer focus: add an `appendAttempt` call on the link path → the unrated test goes red. Serve a scrubber id → no throw from `PuzzleCardShell`.

## Item 3 — Share-loop telemetry (not optional; see Decision 1)

Additive, snake_case, nothing renamed or removed: `puzzle_link_view` (`{ puzzle_id, interaction, found }` — `found: false` is the signal someone shared a broken link), `puzzle_link_attempt`, `share_click` (`{ surface, puzzle_id }`). Update `src/telemetry/README.md` in the same commit.

**Tests:** each event fires once per the action it names, with the documented payload shape; `found: false` fires on a bad id.

## Item 4 — Share affordances

Share on Daily (extend its existing `shareText` to carry the puzzle URL), Rush, and **Practice's solve state** (new). Follow the existing per-mode duplication convention (locked). Every affordance fires `share_click` with its `surface`.

**Tests:** the generated URL resolves to a real bundled puzzle id — assert against the real pool, not a fixture.

## Item 5 — Build-plan amendment

Append to the Phase 1b section: the dynamic-route registry decision from Item 1 (what `ROUTE_META` does with a pattern, and how the drift guard was kept honest), the dispatch seam and whether you narrowed `PuzzleCardShell`'s prop type, the (b1) prerendering price handed to Phase 7, and any DoD line you could not verify without production access — named explicitly as remaining manual verification, not silently checked off.

## Item 6 — Final gate

Full `pnpm validate` (typecheck, lint, tests, `validate:content`, build). Haiku subagent confirms: debug route still absent from `dist/`, no new packages of any kind, no `src/app/pwa/` files touched, no rated-mode session hook changed, `src/engine/` untouched. Then a **final fresh reviewer subagent** reads the Phase 1b plan section plus this prompt against the finished diff and reports anything skipped or silently divergent. Resolve, then open the PR.

**PR description:** per-item summary, the three-registry enumeration, the amendment text, and the manual checklist below. No AI attribution.

---

## DoD (from the plan, plus this prompt's additions)

- [ ] Direct load of `getcodoro.com/puzzle/<real-id>` on production renders the right puzzle — **manual, after deploy**
- [ ] Bad puzzle id → real not-found state, not a crash
- [ ] `/puzzle/:id` attempts are never rated — asserted at the storage/profile layer, not by reading the code
- [ ] Every bundled puzzle id renders in its native interaction without throwing — asserted against the real `puzzlePool`
- [ ] `/puzzle/*` in `_redirects`; SW denylist admits `/puzzle/<id>` with and without a query string; drift guards still fail when broken
- [ ] `/nonsense` still returns a real 404 after the dynamic-route additions
- [ ] Share telemetry lands in PostHog from production — **manual; depends on the Phase 0 PostHog verification actually being done**
- [ ] OG option (a) recorded as an amendment **with the real priced cost of (b1)**
- [ ] Amendment committed; every item independently reviewed via the revert-the-fix check
