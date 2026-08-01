# Prompt for Claude Code — v2 Phase 1b corrective (pre-merge)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first.

**Check the branch state before anything else.** `origin/main` was at `c5e0e89` ("v2 Phase 3: Trace mode (scrubber UI) (#37)") when this was written, and `v2-phase-1b` was at `a0bcf11`, **open and unmerged as PR #38**. If Phase 1b has already been merged, stop and say so — this prompt amends the open PR. **Commit onto `v2-phase-1b` and update PR #38.** Do not open a new branch.

Phase 1b reviewed largely clean and most of it is not in scope. Verified independently and **not** to be relitigated: the `?redirect=` guard rejects 14 of 15 adversarial payloads correctly (`//evil.com`, `https://evil.com`, `javascript:`, `data:`, `\\evil.com`, `/\evil.com`, `https://getcodoro.com.evil.com`, …); `DYNAMIC_ROUTES` is a sound way to keep the `_redirects` drift guard honest for a dynamic route; the SW denylist regex is correct for `/puzzle/<id>`, `/puzzle/<id>?q`, bare `/puzzle/`, and `/nonsense`; `/puzzle/*` correctly does not trip the "no `/*` catch-all" test; `PuzzlePage.tsx` is unrated **by construction** (zero storage imports in the file); `?pattern=` is properly validated against `PATTERN_SLUGS`; telemetry is additive and snake_case. The suite is green (725 tests).

Standing rules, unchanged: `src/app/pwa/` is hands-off, no hex outside `src/index.css`, no AI attribution in commits, `pnpm validate` must not require Python, `src/engine/` stays React-free, `selectNext` untouched, `AttemptMode` stays a three-value union, telemetry stays snake_case and additive. **Zero new dependencies.**

---

## Finding 1 (P0, blocker) — `/practice?pattern=<slug>` is an infinite render loop

This is the destination of `/puzzle/:id`'s "practice more like this" CTA — the conversion path of the entire feature.

**Mechanism.** `PracticePage`'s new effect depends on `session.setPatternFilter`:

```ts
}, [search, session.setPatternFilter])
```

`setPatternFilter` is `useCallback`'d in `usePracticeSession.ts` with deps `[profile, puzzle, serveNext]`. Calling it runs `serveNext(profile, pattern)`, which unconditionally does `setProfile({ ...currentProfile, requeueState: result.newRequeueState })` — a **new object every call**. New `profile` → new `setPatternFilter` identity → the effect re-fires → calls `setPatternFilter` again → forever.

**Evidence, both measured, not reasoned:**

- Instrumented unit run (counter inside the effect, real branch code, existing `PracticePage.test.tsx` fixture): **247 effect runs and 247 `setPatternFilter` calls in 400 ms of idle time**, still climbing when the test ended.
- Live on the deployed preview (`v2-phase-1b.codoro.pages.dev`, service worker serving the shell so the query string survives): `/practice?pattern=null-undefined` produced **1,700 DOM mutations in 1.5 s**; `/practice` with no param, same page, same measurement window, produced **0**.

**Why every existing test passes anyway.** `applies a ?pattern= query param as the filter on load` uses `waitFor` to catch the "Filtering: …" chip, which appears on the _first_ iteration; the test then ends and unmounts before anything observes that the loop never stops. It is a textbook assertion that passes for the wrong reason — the same failure mode as the Phase 3 fixture-only tests.

**The obvious fix is wrong — do not ship it without the second half.** Latching a `useRef` on the applied pattern and returning early is not sufficient: `setPatternFilter` **early-returns when `profile` is still `null`**, which it is on the first effect run (`loadProfile` hasn't resolved). A bare ref-latch marks the pattern applied on that no-op run and the filter is then never applied at all — confirmed: it makes the existing load test fail with a 5 s timeout. The retry-until-profile-exists behaviour is precisely what the runaway dependency was accidentally providing.

**The fix must therefore satisfy both properties:** apply the filter exactly once, _and_ not before `session.profile` is available. Gating on profile plus a latch ref satisfies both — verified: `setPatternFilter` calls drop **247 → 1** and all 19 `PracticePage` tests pass. Implement it as you see fit, but both properties must hold.

**Tests (required, and each must fail against the current code):**

1. A loop guard that counts serves/renders — assert `setPatternFilter` (or the served-puzzle churn it causes) happens **exactly once** across a mount plus a settling delay on `/practice?pattern=<slug>`. Waiting on the chip is not sufficient; the assertion must be about _how many times_, not _whether_.
2. A regression test for the no-op-while-loading trap: the filter is still applied when `loadProfile` resolves on a later tick. This is the test that would have caught the naive fix.

Reviewer focus: revert the profile gate → test 2 red. Revert the latch → test 1 red. **Both independently**, not merely red when the whole fix is reverted.

## Finding 2 (P1) — telemetry side effect inside a `setState` updater

`PuzzlePage.tsx`'s `ScrubberLinkPuzzle.handleCheckpointAnswered` calls `trackPuzzleLinkAttempt` **inside** the `setCheckpointResults(prev => …)` updater. Updater functions must be pure; React may invoke them more than once for a single logical update, and this app renders under `<StrictMode>` (`src/main.tsx`), which deliberately double-invokes them in development.

This matters more here than it normally would: Decision 1 of the Phase 1b plan locked "**don't record link attempts at all**," so `puzzle_link_attempt` is the _only_ record that link play ever happened. A double-fire corrupts the single signal the feature is evaluated by — the exact "feature is unevaluable" outcome instrumenting it was meant to prevent.

Fix by mirroring the established pattern in `useTraceSession.handleCheckpointAnswered`: a `useRef` holding the authoritative results array, mutated synchronously, with the telemetry call made **outside** the updater. Do not "fix" this by removing StrictMode.

**Test:** answer every checkpoint on a real scrubber puzzle from the bundled pool inside a `<StrictMode>` wrapper and assert `trackPuzzleLinkAttempt` fired **exactly once**. Revert the fix → red.

## Finding 3 (P2) — second bypass of the `?redirect=` guard: `/..//evil.com`

Same bug class the fresh reviewer already closed once. `resolveIntendedPath` in `App.tsx` passes `new URL('/..//evil.com', origin)`, whose WHATWG path normalization pops the `/..` and yields **`pathname === '//evil.com'` with the origin unchanged** — so the origin comparison passes and the function returns `//evil.com`, violating its own documented invariant ("must start with exactly one `/` — rejects a protocol-relative `//host/evil`").

**Severity is a crash, not a redirect** — verified in a real browser, not assumed: `history.replaceState(null, '', '//evil.com')` throws `SecurityError` ("A history state object with URL 'https://evil.com/' cannot be created in a document with origin …") rather than navigating, so wouter's `navigate` throws inside the boot `useLayoutEffect` and the ErrorBoundary catches it. A crafted link is a denial of the app shell, not a phishing vector. Fix it anyway: the guard's stated invariant is false, and the next person to reuse this helper may not be behind `replaceState`.

Fix by validating the **returned** value, not just the parsed origin — reject any resolved pathname beginning with `//` (or assert a single leading slash) before returning.

**Test:** extend the existing guard test table with `/..//evil.com`, `/..//..//evil.com`, and `/%2e%2e//evil.com`, asserting `null`. Revert → red.

---

## Item 4 — OD-3 (separable; commit on its own, or split to its own PR if you prefer)

`docs/v2-build-plan.md`'s OD-3 row — a checkpoint mask defeated by scrubbing one step backward — is currently owner-phase **"Undecided."** Two things:

1. **Assign it Phase 4, decision required before the first batch generation run**, matching how OD-2 is handled. The plan's own rule for that table is that anything unfixed by Phase 8 either blocks the phase or takes a written waiver; "Undecided" is the only field in that row carrying no commitment. It is also load-bearing: if the fix turns out to be content-side, the generator needs the rule _before_ it produces 40–60 puzzles.
2. Do **not** fix OD-3 in this PR. It needs the UI-vs-content decision the row already describes, weighed to the standard set by Finding 2's rejected-alternative reasoning in the Phase 3 amendment.

## Item 5 — Build-plan amendment (lead writes this personally)

Append to the Phase 1b section: all three findings with their mechanisms; **specifically** that Finding 1's naive ref-latch fix is wrong and why (the `profile`-null no-op), since that is the trap the next person hits; and the standing lesson — an effect that depends on a `useCallback` whose own deps churn is a render loop, and a `waitFor`-based test cannot detect one. Note that this is the second consecutive phase where a defect survived a green suite because the assertion was "does X appear" rather than "how many times does X happen."

## Item 6 — Final gate

Full `pnpm validate`. Haiku subagent confirms: debug route still absent from `dist/`, no new packages, no `src/app/pwa/` files touched, `src/engine/` untouched. Then a **final fresh reviewer subagent** reads this prompt against the finished diff.

**Then re-verify on the deployed preview**, not just the suite — Finding 1 was only _confirmable_ live. Load `/practice?pattern=<slug>` and measure DOM mutations over ~1.5 s against a `/practice` control. Expect both near zero. Record the numbers in the PR description.

**Sequencing note:** land Finding 4 first. Until it is fixed, a cold load of `/practice?pattern=<slug>` has its path and query string stripped by the redirect, so the only way to reach that URL at all is with the service worker already installed — which is how the original measurement had to be taken. Fixing Finding 4 first makes Finding 1's verification a plain incognito load with no workaround, and lets both findings be verified in the same preview pass.

---

## Finding 4 (P0, blocker) — every real route 3xx-redirects to `/` on production, and it IS a repo defect

**This finding supersedes an earlier, wrong diagnosis.** It was initially reported as a stray Cloudflare Redirect Rule / Page Rule to be fixed in the dashboard, out of this repo's scope. That was incorrect. Do not go looking in the dashboard — the elimination below was done there already, and the cause is `public/_redirects` in this repo.

**Symptom.** On production, `/practice`, `/daily`, `/rush`, `/trace`, `/browse`, and `/legal` all return a 3xx to `/`, discarding the path (and the query string). `/nonsense` correctly returns a real 404. Masked for anyone with the service worker already installed — the SW serves the cached shell without touching the network — which is why it went unnoticed and why it must be tested in a fresh incognito window.

**What was ruled out, with evidence — do not re-diagnose these:**

- **Page Rules:** 0 of 3 used, list empty.
- **Redirect Rules:** exactly one active — "Redirect from WWW to root [Template]", wildcard `https://www.*` → target `https://${1}`, 301, preserve-query-string on. That is correct, preserves the path, and does not match apex requests at all.
- **Stale deployment:** production is on `main c5e0e89`, deployed and successful.
- **Anything zone-level:** `codoro.pages.dev/practice` redirects to `/` identically, and that hostname bypasses the `getcodoro.com` zone entirely. The cause is inside the Pages deployment.
- **A malformed or mis-uploaded file:** the deployment's Redirects tab shows exactly the six lines from this repo, and the build log reads `Parsed 6 valid redirect rules.`

**Mechanism.** The rules match and fire — proven by the fact that `/nonsense` (no rule) still 404s while every listed route redirects. So the rewrite _target_ is what produces the redirect: Cloudflare Pages canonicalizes `.html` URLs and 308-redirects `/index.html` to `/`. Each rule rewrites to `/index.html`, Pages' canonicalization then bounces the browser to `/`, and the original path is lost.

**Confidence note, stated honestly:** the elimination above is directly observed. The `.html`-canonicalization step is a strong inference, not a directly observed `Location` header — the redirect is opaque to `fetch` and the dashboard's Trace tool was not run. **So treat the fix as a hypothesis to verify on a preview deployment before merging, not as a certainty.** If the preview disproves it, stop and report rather than piling on workarounds.

**Fix.** Change the rewrite target from `/index.html` to `/` in `public/_redirects`, for all six existing routes **and for the `/puzzle/*` line this phase added** — that line has the identical defect and would ship the same bug on the shareable-link surface, which is the one surface whose entire value is a stranger opening a deep link cold:

```
/practice / 200
/daily / 200
/rush / 200
/trace / 200
/browse / 200
/legal / 200
/puzzle/* / 200
```

Update `routes.test.ts`'s `_redirects` drift guard and `DYNAMIC_ROUTES[].redirectsRule` to match the new form — both currently assert the `/index.html` target and will go red, which is the guard working correctly.

**Do not** switch to a `/* /index.html 200` catch-all. It would "fix" the symptom while destroying the deliberate "an unknown path returns a real 404" property that `routes.test.ts` guards and that Phase 1a's amendment 3 documents.

**Verification (required, and it cannot be done from the test suite):** push to a branch, let the preview deploy, then in a **fresh incognito window** (no service worker) confirm on the preview URL: every real route returns 200 with the URL intact, `/puzzle/<real-id>` renders the puzzle, and `/nonsense` still 404s. Record the results in the PR description. A green `pnpm validate` proves nothing about this finding — the drift guard only checks that `_redirects` matches the route list, not that Cloudflare honors the target.

## DoD

- [ ] `/practice?pattern=<slug>` applies the filter exactly once — asserted by count, not by presence
- [ ] The filter still applies when `loadProfile` resolves late — the naive-fix regression test
- [ ] `puzzle_link_attempt` fires exactly once per completed scrubber link attempt under `<StrictMode>`
- [ ] `?redirect=` returns `null` for `/..//evil.com` and its variants
- [ ] All seven `_redirects` rules (six routes + `/puzzle/*`) rewrite to `/`, not `/index.html`; drift guard and `DYNAMIC_ROUTES[].redirectsRule` updated to match
- [ ] Preview deployment verified in a fresh incognito window: real routes 200 with the URL intact, `/puzzle/<real-id>` renders, `/nonsense` still 404s — results in the PR description
- [ ] No `/*` catch-all introduced
- [ ] OD-3 assigned an owner phase with a decision deadline
- [ ] Amendment committed, including why the naive Finding 1 fix is wrong
- [ ] Preview-measured mutation counts recorded in the PR description
- [ ] Every item independently reviewed via the revert-the-fix check
