# Prompt for Claude Code — v2 Phase 1a follow-up (four routing defects)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

`origin/main` was at `16036c3` ("v2 Phase 1a: URL routing (#33)") when this was written. Branch from `main`, not from `v2-phase-1a`.

Standing rules, unchanged: `src/app/pwa/` is hands-off (list any touched file there in your summary), **zero new dependencies**, no hex outside `index.css`, no AI attribution in commits.

This is a small corrective branch, not a phase. Four defects found in a post-merge read of Phase 1a. Three of them pass every existing test, which is the reason they survived review — each item below names the test that should have caught it and doesn't.

**Out of scope, do not drift into:** `/puzzle/:id` or anything else from Phase 1b; OD-1's swipe gesture (do not touch `SwipeBinary.tsx`'s `useDrag` config, `gestureThreshold.ts`, or `DEFAULT_SWIPE_THRESHOLD`); `view === 'mastery'`; anything from Phase 2.

---

## Item 1 — A first-ever visitor still downloads the Home chunk

**The defect.** `App.tsx` resolves the boot mode in `useState`'s initializer, eagerly prefetches the landing chunk there, then redirects to `/practice` from a `useLayoutEffect`. But `useLayoutEffect` runs in the **commit** phase, and wouter's `<Switch>` has already matched `/` and mounted `<Home />` in the **render** phase — which is when `React.lazy` calls its loader. So on a device's first-ever launch the browser fetches `Home-*.js` (2,825 B) and `Home-*.css` (2,487 B), two extra requests, in direct competition with the Practice chunk the initializer just prefetched. Then the redirect commits and Home unmounts, having been rendered for zero user-visible frames.

This is a regression of the exact property the eager prefetch exists to protect — "a cold load only pays for the mode it actually lands on" — on the exact path it was designed for. It is small in bytes and real in requests, and Phase 7 is already hunting ~58 KB.

**Why no test caught it.** `App.test.tsx`'s first-visit test asserts _which page rendered_ (`.practice-page` present, `.home` absent). Home is unmounted by the time that assertion runs, so it passes either way. The prefetch test is a source-inspection test on the initializer — it says nothing about what else the first render pulls in.

**Fix shape.** Keep the boot decision where it is; stop `<Home />` from mounting during the redirect pass. Something like a `bootRedirectPending` piece of state, set from the same initializer, that gates the `/` route's child and is cleared by the same layout effect that navigates — so a _later_ visit to `/` (clicking the logo) still renders Home normally. The subtle part is that "first-ever visitor" and "currently redirecting" are different conditions and the current `bootMode` value conflates them; gating on `bootMode === 'practice'` alone permanently blanks `/` for that user.

**Do not** fix this by calling `history.replaceState` inside the `useState` initializer and reordering the `useLocation` call below it. It works, and it is a side effect in the render phase that React's StrictMode double-render will run twice — the current initializer already gets away with this for `localStorage` because that write is idempotent, and history mutation is a worse thing to normalize. If you think that approach is right anyway, stop and explain rather than shipping it.

**Test that must fail before your fix and pass after.** Assert the Home _module_ is never imported during a first-ever visit's boot, not just that Home isn't in the DOM. A `vi.mock('./Home', factory)` whose factory increments a counter works, since Vitest invokes the factory on first import — but pick whatever genuinely fails on the current `main`. Verify it does, by running it against `main` before you write the fix, and say so in your summary.

## Item 2 — `navigateFallbackDenylist` breaks on any query string

**The defect.** `vite.config.ts` has:

```
navigateFallbackDenylist: [/^\/(?!$|practice$|daily$|rush$|browse$|legal$)/]
```

Workbox's `NavigationRoute` matches its allowlist/denylist against **`url.pathname + url.search`**, not `url.pathname`. Every alternative in that lookahead is anchored with `$`, so `/practice?utm_source=twitter` — a shared or campaign link, the most likely way a route is ever loaded with a query — fails every alternative, the negative lookahead succeeds, and the navigation is denied the cached shell.

Online this is masked: the request falls through to the network and Cloudflare's `_redirects` matches on path alone. Offline in the installed PWA it fails where bare `/practice` succeeds, which is both wrong and the kind of inconsistency that makes the manual 404/offline check unreliable again — the thing the denylist was added to fix.

**Confirm the mechanism from source before changing anything**, per this repo's standing rule. Read `NavigationRoute`'s `_match` in the installed `workbox-routing` (via `vite-plugin-pwa`'s dependency tree) and confirm it builds `pathnameAndSearch`. If it doesn't, stop and report — the rest of this item is then wrong.

**Proposed replacement** (verify, don't paste on trust):

```
/^\/(?!(?:practice|daily|rush|browse|legal)?(?:\?|$))/
```

The optional group plus `(?:\?|$)` collapses the `/` case and the six-route case into one alternative and admits a query string on any of them. Check `/`, `/?x=1`, `/practice`, `/practice?utm_source=x`, `/practice/foo`, `/nonsense`, `/nonsense?x=1`.

`routes.test.ts` already mirrors this pattern by hand and is the drift guard — update the mirror and add the query-string cases to it. Do **not** try to import it from `vite.config.ts`; the comment there explains why that's a fight over `tsconfig.node.json` for a marginal win, and that reasoning still holds.

Leave `registerType: 'prompt'`, `injectRegister`, and the update flow alone.

## Item 3 — Leaving Browse pushes instead of replacing

`PracticePage`'s `PatternPicker` handlers call `navigate('/practice')` on both the mobile branch and the desktop sidebar branch. That's a `pushState`, so the history stack becomes `/practice → /browse → /practice` and the browser Back button from there returns the user to Browse rather than to where they were before they opened it. Selecting a pattern makes it worse: Back lands on Browse with the filter already applied and no visible relationship to what the user just did.

Use `{ replace: true }` on both. `App.test.tsx`'s Browse round-trip test asserts `window.location.pathname` and the no-remount property, both of which still hold — add an assertion that a Back press after leaving Browse does not return to `/browse`.

Entering Browse stays a push. That's correct: Back out of Browse should work.

## Item 4 — `public/_redirects` has no drift guard

The SW denylist got a hand-synced mirror test in `routes.test.ts`. `_redirects` — the file that decides whether a route exists at all on production — got nothing. Add a route to `ROUTE_META` and forget `_redirects`, and the route 404s on a cold load with a fully green `pnpm validate`.

Add a test that reads `public/_redirects` off disk and asserts it has a `200` rewrite for every key in `ROUTE_META` **except `/`** (Vite emits `index.html` at the root, so `/` needs no rule — assert that exclusion explicitly rather than leaving it implied), and that the file contains no `/*` catch-all. Node `fs` in a Vitest test is already the pattern `App.test.tsx` uses for its source-inspection test, so this needs no new machinery.

---

## Plan amendment

Append an amendment to `docs/v2-build-plan.md`'s Phase 1a section recording all four, what shipped wrong, and what each one now is. Two DoD lines in that section are currently checked and were not fully true:

- "Route-level code splitting intact **and** landing-route chunk still prefetched eagerly, with a test that would catch losing it" — the prefetch survived; the splitting property did not, on the first-visit path. Say that plainly rather than re-checking the box silently.
- "`_redirects` enumerates real routes; `/nonsense` still returns a real 404; SW `navigateFallbackDenylist` decision written down" — true for bare paths, false with a query string.

Also update Amendment 3's per-context `/nonsense` table if Item 2 changes any of its three answers.

Leave the unchecked production-verification boxes unchecked. They're mine.

---

## Definition of done

- [ ] First-ever visit does not import the Home module; test verified to fail on `main` before the fix
- [ ] A later visit to `/` (logo click) still renders Home — covered by the existing test, confirm it still passes for the right reason
- [ ] Denylist regex admits a query string on every real route and still denies `/nonsense`, `/nonsense?x=1`, and `/practice/foo`; `routes.test.ts` mirror updated with those cases; mechanism confirmed from `workbox-routing` source
- [ ] Both Browse exits use `{ replace: true }`; Back-after-Browse asserted
- [ ] `_redirects` drift test reads the real file and covers every `ROUTE_META` key except `/`, and rejects a `/*` catch-all
- [ ] Plan amendment appended, including the two DoD lines that were checked prematurely
- [ ] `pnpm validate` green; zero new dependencies
- [ ] Bundle-size delta from `16036c3` reported as a number (expected to be ~0 — say so if it isn't)

## What's on me

Unchanged and still outstanding from Phases 0 and 1a — do not attempt or check off: PostHog production event from a real phone; `/nonsense` returning HTTP 404 on production in a browser tab **and** in the installed PWA; cold load of `getcodoro.com/legal`; PWA install/launch/SW-update prompt against a real deploy; OD-1 device repro.

If Item 2 changes what I should see on device for any of those, say so explicitly at the end of your summary.

## Orchestration

- Branch `v2-phase-1a-followup`, PR into `main` when green.
- One commit per item, in the order above. Item 1 first — it's the only one with a behavioral fix worth bisecting to.
- Delegating is fine for Items 3 and 4. **Keep your own reasoning on Items 1 and 2** — both are cases where the obvious fix is subtly wrong (a permanently blank `/`, and a regex that looks right against pathnames and isn't what Workbox tests).
- Report: whether the Item 1 test actually failed on `main`; what `NavigationRoute._match` really matches against, quoted; the final regex with its case table; and anything in the plan amendment you disagreed with.
