# Prompt for Claude Code — Practice-page performance pass (mobile Lighthouse 46 → 80+)

Paste this into Claude Code in the codoro repo. `git fetch && git status` first, branch off current `main`.

This is a measurement-and-performance pass on the **already-shipped** `/practice` page. No new features, no UI redesign, no content changes. Two Lighthouse runs against production `https://getcodoro.com/practice` (2026-08-24) are the input:

|         | Perf     | A11y | Best Practices | SEO  |
| ------- | -------- | ---- | -------------- | ---- |
| Mobile  | **0.46** | 0.96 | 0.73           | 1.00 |
| Desktop | 0.85     | 0.95 | 0.73           | 1.00 |

Both raw reports are attached / in the repo root as `codoro_lighthouse_mobile.json` and `codoro_lighthouse_desktop.json`. **Read them before changing anything** — this prompt's numbers were pulled from them, but you should confirm each one yourself rather than trusting this document.

---

## Task 0 (blocking): the baseline is contaminated — re-measure before you touch code

Both runs were captured in a Chrome profile with ~12 extensions loaded (MetaMask, Adobe Acrobat, AdBlock, an LMS-detector, others). This is not a footnote; it invalidates a large fraction of the report:

- `unused-javascript`: 4,741 KiB "savings" — **every single entry** is a `chrome-extension://` or extension-injected `blob:` URL. Zero first-party bytes.
- `errors-in-console` (Best Practices fail): the three 404s (`/api/v1/courses?per_page=2`, `/d2l/api/lp/1.0/enrollments/...`, `/login/token.php`) are an LMS-detector extension probing the origin. The `browser_polyfill_default(...).runtime.getManifest is not a function` exception is from an extension's injected `blob:` script. **None of these are Codoro's code.**
- `deprecations` (Best Practices fail): Shared Storage API warning, sourced to MetaMask's content script.
- ~1,400 ms of the mobile `mainthread-work-breakdown` (7.5 s total) and 4 of the top 5 long tasks after the first are extension work.

So: **Best Practices 0.73 is ~entirely noise**, and mobile TBT (1,130 ms) is inflated by an unknown but material amount.

Before any fix, add a repeatable clean-profile measurement path and record a real baseline:

1. Add a `pnpm perf:lighthouse` script that runs Lighthouse headless with `--chrome-flags="--headless=new --disable-extensions --no-sandbox"`, both form factors, against a configurable URL (default: a local `pnpm build && pnpm preview` server, with prod as an opt-in flag). Use the `lighthouse` npm package as a devDependency — don't shell out to a globally-installed binary.
2. Run it 3× per form factor and record the **median** of Perf / FCP / LCP / TBT / CLS. Single runs of TBT vary ±30%; do not report or compare single runs anywhere in this pass.
3. Commit the baseline numbers into `docs/perf-baseline-2026-08-24.md` (new file) as a table, alongside a one-line note that the attached JSONs were extension-polluted and are superseded by it.
4. **Expect the clean mobile score to land meaningfully above 46 before you fix anything.** That is the point of doing this first — otherwise you'll credit an extension removal to your own work. Report both numbers honestly in the final summary.

Everything below is scoped to issues confirmed as **first-party** in the reports. Verify each still reproduces against your clean baseline before fixing it; if one doesn't, say so and drop it rather than fixing a phantom.

---

## Confirmed first-party findings, in impact order

### 1. CLS — the footer, both form factors (mobile 0.196, desktop 0.245)

**Highest-confidence, cheapest fix in this pass, and desktop's _only_ real problem** (desktop is 0.85 purely because of this — every other desktop metric scores ≥0.93).

The `layout-shifts` audit reports exactly two shifts on each form factor, and **both attribute to the same element**: `body > div#root > div.app-shell > footer.flex` (nodeLabel "Settings\nLegal"), scoring 0.149 + 0.047 on mobile, 0.194 + 0.051 on desktop.

Root cause hypothesis to verify (from reading `src/app/AppShell.tsx` + `src/app/app.css`): `.app-shell` has **no layout rules below the `min-width: 1024px` media query** — on mobile it's a plain block box, so `<footer>` sits in normal flow immediately after `<main>`, and _any_ growth of `<main>`'s content pushes it down. Two shifts, two growth events:

- `RouteSkeleton` (`src/app/RouteSkeleton.tsx`) renders ~180 px of placeholder blocks; the real `PracticePage` that replaces it is several times taller.
- Then the puzzle card's own content (snippet, options) fills in.

Desktop scores _worse_ despite the `lg:` grid because the grid only sets `min-height: 100dvh` on `.app-shell` — nothing pins the footer to the bottom of that box, and `align-items: start` on `.app-shell__content` lets the content region size to its contents.

Fix direction (yours to design, but it must be layout-level, not a skeleton height tweak): make the shell a full-height column at **every** width — `min-height: 100dvh`, `<main>` as the `1fr` row — so the footer starts below the fold and content growth inside `<main>` cannot move it. A skeleton that merely _guesses_ the final height is not acceptable: puzzle cards vary in height by content, so it would fix the median case and leave a tail of shifts.

Watch the safe-area interaction: the footer's `pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+var(--space-4))]` and the top bar's `pt-[calc(var(--space-2)+env(safe-area-inset-top))]` are both load-bearing (see AppShell's 2b.9 comment — a previous fix in this area shipped a regression where the logo bar overlapped the iOS status bar). Don't unwind that.

**Target: CLS ≤ 0.05 on both form factors, `layout-shifts` reporting zero items.** Add a regression test in `AppShell.test.tsx` asserting the full-height layout contract (the classes/rules that guarantee it), so this can't silently regress.

### 2. Boot-path JavaScript — mobile TBT 1,130 ms, bootup 4.6 s, main thread 7.5 s

Mobile has a **single 1,171 ms long task starting at 990 ms**, attributed to the document. `bootup-time` attributes 3,046 ms total (1,348 ms scripting + 951 ms parse/compile) to `getcodoro.com/practice` itself. That's first-party and it is the whole ballgame for mobile TBT and for finding #3.

Three concrete contributors, confirmed against `dist/`:

**2a. The entire puzzle corpus is parsed _and zod-validated_ at module-eval time, on the critical path.**

`src/content/index.ts` does `import.meta.glob('./puzzles/**/*.json', { eager: true })` over **214 JSON files (335 KB of source)**, then runs `PuzzleSchema.safeParse()` on every one at import time, throwing on failure. Result in `dist/assets/`:

- `content-Bi4_iUoQ.js` — **286 KB raw / 68 KB transferred**
- `schemas-DZJ3kUEk.js` — **70 KB raw / 19 KB transferred**, confirmed to be zod (`content-*.js` statically imports from it)

Both are on the `/practice` critical path, and 214 `safeParse` calls run synchronously before first paint.

Two independent fixes, do both:

- **Skip runtime validation in production builds.** `pnpm validate:content` already validates the whole corpus at build time as part of `pnpm validate`, and content is a build-time constant — re-deriving that guarantee in every user's browser buys nothing. Gate the `safeParse` loop behind `import.meta.env.DEV` (Vite inlines it as a literal, so Rollup drops the branch — same dead-code-elimination pattern `App.tsx` already relies on for `ScrubberDebugPage`). This should remove the zod chunk from the boot path entirely; **verify by grepping `dist/` after a production build**, the way this repo's existing comments require, not by reasoning about it. If some prod path genuinely still needs zod, say so instead of forcing it.
- **Stop shipping all 214 puzzle bodies eagerly.** The selection engine needs _metadata_ (`id`, `pattern`, `difficulty_rating`, `interaction`) for the whole pool; it needs the _body_ (snippet, options, explanation) only for the puzzle actually being served. Generate a lightweight metadata index at build time and load bodies via non-eager `import.meta.glob` on demand. Before implementing, audit every consumer of `puzzlePool`/`quizPool`/`scrubberPool` (~30 files import from `src/content`) and confirm none of them needs a body synchronously — if one does, report it and scope around it rather than papering over it with a sync-looking async API.

  **Constraint: this must not break PWA offline.** `vite.config.ts`'s workbox `globPatterns` precaches all JS chunks; the split chunks must stay inside that glob so a fully-offline session still has every puzzle. Verify offline play after the change, don't assume.

**2b. posthog-js (220 KB raw / 72 KB transferred) is fetched and evaluated during first paint.**

`dist/assets/module-Cwtw1I8F.js` is posthog-js. `src/telemetry/client.ts` already loads it via dynamic `import()` (good), but `main.tsx` calls `initTelemetry()` + `trackSessionStart()` **synchronously at boot**, which kicks off that fetch and its ~220 KB parse right into the LCP window, competing for bandwidth and main thread with the app's own chunks.

Defer the posthog _load_ until after first paint — `requestIdleCallback` with a `setTimeout` fallback (Safari has no `requestIdleCallback`), or on first user interaction. `loadPosthog()`'s existing `posthogPromise` memoization means calls made before the module resolves already queue correctly, so `trackSessionStart()` can keep firing at boot as long as it lands in that queue rather than forcing the import. Confirm no event is _dropped_ — a deferred load that silently loses `session_start` is a worse outcome than the perf win, and `telemetry.test.ts` should cover the new ordering.

**2c. Report, don't necessarily fix:** `PuzzleCardShell-DnGtildr.js` is 153 KB raw and pulls framer-motion; `index-gVrbZmmE.js` is 203 KB (react-dom + wouter + framer refs). After 2a and 2b land, re-measure and tell me what the remaining boot cost actually is and where it sits, with numbers. Don't pre-emptively rip out framer-motion — animation is part of the product's feel, and I'd rather see the post-fix number first.

### 3. LCP 4.5 s mobile — 94 ms TTFB + 1,518 ms element render delay

`lcp-breakdown-insight` decomposes it: TTFB is fine (94 ms; server-response-time scores 1.00, Cloudflare is not the problem). **The entire cost is element render delay** — the LCP element is `div.puzzle-card > p.m-0`, the puzzle prompt text, which cannot paint until the app boots, the route chunk loads, and the puzzle is selected.

This is a symptom of #2, not an independent problem. Do not add an SSR/prerender layer for it — **v2 is locked local-first with no backend** (`docs/v2-build-plan.md`), and a prerender step is a real complexity increase for a page whose content is per-user-rating anyway. Fix #2, re-measure, and only then propose anything further.

`render-blocking-resources`, `font-display`, `document-latency`, and `duplicated-javascript` all pass — the earlier Phase 7b work on inlined critical CSS and cache headers is holding. Don't re-litigate it.

### 4. Fonts — 70 KB across 4 woff2 on the critical path

`space-grotesk-400/700` + `jetbrains-mono-400/700`, 70,750 bytes total, of which `index.html` preloads only the two 400s. Not flagged by any audit (`font-display` passes), so this is opportunistic, not a defect.

Investigate and report before changing: are both 700 weights actually used at first paint, and is the corpus Latin-only (it should be — snippets are ASCII code)? If so, subsetting to Latin and/or dropping a 700 file in favor of a variable font is worth ~30 KB on the critical path. **This is the lowest-priority item here — skip it if the earlier items eat the session.** Any font change must be checked against `--font-size-code` rendering; see the code-rendering invariant below.

---

## Accessibility — two real failures (0.96 mobile / 0.95 desktop)

Both are genuine first-party defects, both trivial, and neither is in the noise category:

1. **`color-contrast`** — the footer's Settings and Legal links: `#636773` on `#0e0f13` = **3.39:1**, at 13px/normal weight. WCAG AA needs 4.5:1. The color is the `--text-2` token, so a token change is global — audit every `text-text-2` call site for a regression before changing the token, or scope the fix to the footer if the token is right elsewhere. State which you chose and why.
2. **`label-content-name-mismatch`** — `<a aria-label="Home" href="/">` whose visible text is "Codoro" (AppShell's brand link). The accessible name must contain the visible text (WCAG 2.5.3). `aria-label="Codoro — Home"` or dropping the `aria-label` entirely both fix it; pick one and explain.

---

## Best Practices 0.73 — one real item, the rest is extension noise

`deprecations`, `errors-in-console`, and most of `inspector-issues` are the extensions from Task 0. Re-run clean and they should largely evaporate. The one substantive finding:

**`csp-xss` reports "No CSP found in enforcement mode" (High severity).** There is no `Content-Security-Policy` in `public/_headers`. Add one. Non-obvious constraints, all of which you must verify against a real build rather than guess:

- `vite.config.ts`'s `inlineCriticalCss` plugin inlines the app-shell stylesheet as a literal `<style>` block, so `style-src` needs `'unsafe-inline'` or a per-build hash. Prefer the hash if the plugin can emit it; if that turns into a rewrite of the plugin, take `'unsafe-inline'` for `style-src` only and say so.
- `connect-src` must allow the PostHog host (`VITE_POSTHOG_HOST`) and Cloudflare Insights (`static.cloudflareinsights.com`), or you will silently kill telemetry.
- The service worker, the PWA manifest, and `blob:`/`data:` usage all need checking against the policy.

**Ship it report-only first** (`Content-Security-Policy-Report-Only`) if you cannot verify every directive against a real deployed page in this session. A CSP that breaks telemetry or the SW in production is a strictly worse outcome than no CSP.

---

## Locked decisions — don't reopen

- **No SSR, no prerender, no framework migration.** Local-first, no backend, per `docs/v2-build-plan.md`.
- **The code-rendering invariant stands**: one fixed size (`--font-size-code`), soft-wrap, and **no horizontal scroll on any code surface**. Reintroducing `overflow-x: auto` on a snippet re-breaks swipe (see `docs/` and the OD-6 history — ~120 lines of scroll-arbitration were deleted on the strength of this invariant). Nothing in this perf pass should come near it.
- **Don't weaken the coverage thresholds** in `vite.config.ts` (100% statements/functions/lines on `engine/` and `storage/`, 96% branches) to make a refactor land. If a content-loading change makes a threshold unreachable, stop and tell me.
- **Don't delete the existing explanatory comments** in `vite.config.ts`, `main.tsx`, `AppShell.tsx`, or `public/_headers` while editing around them. They encode prior measurements and prior regressions; update them where your change makes them wrong, and add the same kind of note for what you change.

## Definition of done

- `pnpm validate` passes (typecheck, lint, test, content validation, build).
- `pnpm perf:lighthouse` exists, is documented in the README, and produces a 3-run median.
- `docs/perf-baseline-2026-08-24.md` contains: contaminated baseline → clean baseline → post-fix numbers, three columns, both form factors, for Perf / FCP / LCP / TBT / CLS.
- Offline PWA play verified by hand after any content-loading change.
- One PR per numbered finding where they're independent (CLS, telemetry defer, content lazy-load, a11y, CSP) — not one giant commit. If you sequence them differently, say why.

**Targets** (clean-profile median, mobile): Performance ≥ 0.80, CLS ≤ 0.05, TBT ≤ 300 ms, LCP ≤ 2.5 s. Desktop: Performance ≥ 0.95, CLS ≤ 0.05.

If you finish the analysis and conclude one of these targets isn't reachable without breaking a locked decision, **say so with the measurement that proves it** rather than shipping a partial fix and reporting success.
