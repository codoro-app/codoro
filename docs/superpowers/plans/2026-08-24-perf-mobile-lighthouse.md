# Practice-page perf pass (mobile Lighthouse 46 → clean baseline → targeted fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-measure `/practice` with a clean (extension-free) Lighthouse profile, then land the confirmed first-party fixes — footer CLS, dead-weight zod validation in prod, deferred telemetry load, two real a11y defects, and a CSP header — each independently shippable, ending with an honest post-fix re-measure.

**Architecture:** No SSR/prerender, no framework change (locked — see Global Constraints). Fixes are CSS-layout (CLS), a `import.meta.env.DEV`-gated dead-code-elimination (validation), an idle-deferred dynamic `import()` (telemetry), two isolated markup/CSS tweaks (a11y), and a static response header (CSP). A new `tools/perfLighthouse.ts` + `pnpm perf:lighthouse` gives every later task a real, repeatable, extension-free number to check itself against instead of trusting the two contaminated JSON reports this pass started from.

**Tech Stack:** Vite 8 / React 19 / TypeScript / Tailwind v4 (CSS-first) / Vitest / `lighthouse` + `chrome-launcher` (new devDependencies) / Cloudflare Pages `_headers`.

**Spec:** `docs/prompts/claude_code_prompt_perf_mobile_lighthouse.md` (the original ask). This plan also depends on two source Lighthouse reports the spec references, found during planning at `C:\Users\tshor\Downloads\codoro lighthouse mobile.json` and `codoro lighthouse desktop.json` (NOT in the repo root, despite the spec saying so) — every number cited below was independently re-verified against those two files during planning, not copied from the spec's own prose.

## Scope note — read before executing Task 3

The spec's finding #2 asks for **two** independent fixes to the boot-path content module: (a) skip runtime zod validation in production, and (b) stop shipping all 214 puzzle bodies eagerly (a metadata/body lazy-load split). Task 3 below implements **only (a)**.

(b) was audited during planning (grepping every real, non-test call site of `puzzlePool`/`quizPool`/`scrubberPool` — 47 files matched) and found to be **not safely achievable within this pass's "no new features, no UI redesign" constraint**:

- `computeMastery()` (4 call sites: `Home.tsx`, `StatsPage.tsx`, `MasteryTeaser.tsx`, `PatternPicker.tsx`) only reads `puzzle.id`/`puzzle.pattern` — those alone would split cleanly onto a metadata-only array. But splitting _only_ those four call sites doesn't shrink the bundle at all, because `puzzlePool` would still be eagerly constructed for every other consumer below — so it's not worth doing in isolation.
- `usePracticeSession.ts` / `useDailySession.ts` / `useRushSession.ts` (the actual `/practice`, `/daily`, `/rush` selection engines) currently select a puzzle from `quizPool` and return its **full body synchronously** — the whole session state machine, and its exhaustive test suites, assume a puzzle is available the instant one is selected. Making body-fetch async here means the play loop would show a real loading transition on every puzzle serve, which is a user-facing behavior change the spec explicitly locks out of scope ("No new features, no UI redesign"). It would also touch `engine/`'s test suite, which sits under this repo's locked 100%-statement/function/line coverage gate — a non-trivial risk to force through in a perf-only pass.
- `useChallengeSession.ts`, `useBossSession.ts`, and `PuzzlePage.tsx` all do a synchronous `puzzlePool.find(id)` / `Map` build for an **arbitrary** id (a shared-link puzzle, or all ten of a boss set) — converting these is lower-risk (their routes are already separately code-split from `/practice`, so an async hop there doesn't touch `/practice`'s own boot path), but doing it alone still leaves `puzzlePool` eagerly built for the selection engines above, so it wouldn't move `/practice`'s measured numbers either.
- ~15 test files (`content/index.test.ts`, `bossRun.test.ts`, `ChallengePage.test.tsx`, `PuzzlePage.test.tsx`, `*.pool.test.tsx`, `shareText.test.ts` × 3, ...) import `puzzlePool`/`quizPool`/`scrubberPool` directly and iterate the **real, full corpus** (`it.each(puzzlePool.map(...))`) — these keep working unchanged only because Task 3's `import.meta.env.DEV` branch still builds the full eager array in dev/test; they'd need a parallel rewrite if the underlying data source ever stopped existing synchronously in that branch too.

Net: the byte/parse-time win the spec wants from (b) requires converting the selection engines, and that conversion is a real UI/product-behavior decision (an unavoidable loading transition on puzzle serve), not a pure perf refactor. **Recommendation, not executed here:** scope (b) as its own follow-up with an explicit product call on whether a brief per-puzzle loading state is acceptable. Task 3 (validation skip) still ships independently and for real — see its own numbers below — but expect the post-fix mobile Performance score in Task 8 to land short of 0.80 specifically because `content-*.js`'s ~286 KB raw / 68 KB transferred stays on the critical path. State this plainly in Task 8's report; do not claim the target was hit if it wasn't.

## Global Constraints

- No SSR, no prerender, no framework migration — v2 is locked local-first, no backend (`docs/v2-build-plan.md`).
- The code-rendering invariant stands: one fixed `--font-size-code`, soft-wrap, no `overflow-x: auto` on any code surface. Nothing in this plan touches code-snippet rendering.
- Do not weaken `vite.config.ts`'s coverage thresholds (100% statements/functions/lines on `engine/`/`storage/`, 96% branches). No task here touches those directories.
- Do not delete existing explanatory comments in `vite.config.ts`, `main.tsx`, `AppShell.tsx`, or `public/_headers` while editing around them — update them where a change makes them wrong, and match their density/style for anything new.
- The safe-area `calc()` expressions on `AppShell`'s top bar (`pt-[calc(var(--space-2)+env(safe-area-inset-top))]`) and footer (`pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+var(--space-4))]`) are load-bearing (2b.9 regression history) — Task 2 changes layout mode only, never touches these expressions.
- `pnpm validate` (typecheck, lint, test, content validation, build) must pass at the end of every task.
- One PR per task below where the task says so (matches the spec's "one PR per numbered finding where independent" — CLS, content-validation-skip, telemetry-defer, a11y, CSP are five independent PRs; Task 1 (tooling) and Task 8 (re-measure/report) bookend them).

---

### Task 1: Clean-profile Lighthouse tooling + baseline doc

**Files:**

- Create: `tools/perfLighthouse.ts`
- Modify: `package.json` (new script + two devDependencies)
- Modify: `README.md:25-34` (Scripts table)
- Create: `docs/perf-baseline-2026-08-24.md`

**Interfaces:**

- Produces: `pnpm perf:lighthouse` (local build+preview target, default) and `pnpm perf:lighthouse -- --prod` (audits `https://getcodoro.com/practice` directly) — both print a mobile/desktop median table to stdout. Every later task's "did this actually help" check runs this.

- [ ] **Step 1: Install the two new devDependencies**

Run: `pnpm add -D lighthouse chrome-launcher`

(Don't hand-write version numbers into `package.json` — let `pnpm add` resolve and lock real, currently-installable versions.)

- [ ] **Step 2: Write the runner script**

Create `tools/perfLighthouse.ts`:

```ts
/**
 * Clean-profile Lighthouse runner for /practice (perf pass 2026-08-24,
 * Task 0). The two JSON reports this pass started from were captured in a
 * Chrome profile with ~12 extensions loaded (MetaMask, Adobe Acrobat,
 * AdBlock, an LMS-detector, others) — every `unused-javascript` entry but
 * two, all four `errors-in-console` items, and the `deprecations` warning
 * traced straight back to those extensions, not to this app (see
 * docs/perf-baseline-2026-08-24.md). This script launches a genuinely clean
 * headless Chrome (`--disable-extensions`) so every number it reports is
 * first-party.
 *
 * Usage:
 *   pnpm perf:lighthouse                 # pnpm build, then serves+audits localhost
 *   pnpm perf:lighthouse -- --prod       # audits https://getcodoro.com/practice directly
 *   pnpm perf:lighthouse -- --url=<url>  # audits an arbitrary URL, no local build/serve
 *
 * Runs each form factor (mobile, desktop) 3x and reports the MEDIAN of
 * Performance score / FCP / LCP / TBT / CLS — a single run's TBT in
 * particular varies +/-30% run to run; never report or compare a single run
 * anywhere in this pass.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import * as chromeLauncher from 'chrome-launcher'
import lighthouse from 'lighthouse'

const PORT = 4173
const RUNS_PER_FORM_FACTOR = 3

interface FormFactorSettings {
  formFactor: 'mobile' | 'desktop'
  screenEmulation: {
    mobile: boolean
    width: number
    height: number
    deviceScaleFactor: number
    disabled: boolean
  }
  throttling: {
    rttMs: number
    throughputKbps: number
    cpuSlowdownMultiplier: number
    requestLatencyMs: number
    downloadThroughputKbps: number
    uploadThroughputKbps: number
  }
}

// Lighthouse's own default mobile ("Slow 4G" + Moto G4-class CPU) and
// desktop (effectively unthrottled) presets, written out explicitly rather
// than imported from Lighthouse's internal desktop-config module (that
// module's path has moved across major versions — these throttling numbers
// are the stable, publicly-documented part of the config API). VERIFY these
// still match node_modules/lighthouse/core/config/constants.js after
// `pnpm install` runs Step 1 above — don't just trust this comment.
const MOBILE: FormFactorSettings = {
  formFactor: 'mobile',
  screenEmulation: {
    mobile: true,
    width: 412,
    height: 823,
    deviceScaleFactor: 1.75,
    disabled: false,
  },
  throttling: {
    rttMs: 150,
    throughputKbps: 1638.4,
    cpuSlowdownMultiplier: 4,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
}

const DESKTOP: FormFactorSettings = {
  formFactor: 'desktop',
  screenEmulation: {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  },
  throttling: {
    rttMs: 40,
    throughputKbps: 10240,
    cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
}

interface RunMetrics {
  performance: number
  fcp: number
  lcp: number
  tbt: number
  cls: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number)
}

async function runOnce(
  url: string,
  port: number,
  settings: FormFactorSettings,
): Promise<RunMetrics> {
  const result = await lighthouse(
    url,
    { port, output: 'json', logLevel: 'error' },
    { extends: 'lighthouse:default', settings },
  )
  if (!result) {
    throw new Error(`Lighthouse run returned no result for ${url}`)
  }
  const { audits, categories } = result.lhr
  const performance = categories.performance?.score
  if (performance === null || performance === undefined) {
    throw new Error('Lighthouse run produced no performance score')
  }
  return {
    performance,
    fcp: audits['first-contentful-paint']?.numericValue ?? NaN,
    lcp: audits['largest-contentful-paint']?.numericValue ?? NaN,
    tbt: audits['total-blocking-time']?.numericValue ?? NaN,
    cls: audits['cumulative-layout-shift']?.numericValue ?? NaN,
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch {
      // not up yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(
    `Local preview server at ${url} did not become ready within ${String(timeoutMs)}ms`,
  )
}

function reportTable(label: string, runs: RunMetrics[]): RunMetrics {
  const med: RunMetrics = {
    performance: median(runs.map((r) => r.performance)),
    fcp: median(runs.map((r) => r.fcp)),
    lcp: median(runs.map((r) => r.lcp)),
    tbt: median(runs.map((r) => r.tbt)),
    cls: median(runs.map((r) => r.cls)),
  }
  console.log(`\n${label} — median of ${String(runs.length)} runs`)
  console.log(`  Performance: ${(med.performance * 100).toFixed(0)}`)
  console.log(`  FCP:         ${med.fcp.toFixed(0)} ms`)
  console.log(`  LCP:         ${med.lcp.toFixed(0)} ms`)
  console.log(`  TBT:         ${med.tbt.toFixed(0)} ms`)
  console.log(`  CLS:         ${med.cls.toFixed(3)}`)
  return med
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const useProd = args.includes('--prod')
  const urlArg = args.find((a) => a.startsWith('--url='))
  const explicitUrl = urlArg?.slice('--url='.length)

  let previewProcess: ChildProcess | null = null
  let targetUrl: string

  if (explicitUrl) {
    targetUrl = explicitUrl
  } else if (useProd) {
    targetUrl = 'https://getcodoro.com/practice'
  } else {
    console.log('Building production bundle...')
    execFileSync('pnpm', ['build'], { stdio: 'inherit', shell: true })
    console.log(`Starting local preview server on port ${String(PORT)}...`)
    previewProcess = spawn('pnpm', ['preview', '--port', String(PORT), '--strictPort'], {
      stdio: 'inherit',
      shell: true,
    })
    targetUrl = `http://localhost:${String(PORT)}/practice`
    await waitForServer(targetUrl, 30_000)
  }

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--disable-extensions', '--no-sandbox'],
  })

  try {
    const mobileRuns: RunMetrics[] = []
    for (let i = 0; i < RUNS_PER_FORM_FACTOR; i++) {
      mobileRuns.push(await runOnce(targetUrl, chrome.port, MOBILE))
    }
    const desktopRuns: RunMetrics[] = []
    for (let i = 0; i < RUNS_PER_FORM_FACTOR; i++) {
      desktopRuns.push(await runOnce(targetUrl, chrome.port, DESKTOP))
    }

    console.log(`\nTarget: ${targetUrl}`)
    reportTable('Mobile', mobileRuns)
    reportTable('Desktop', desktopRuns)
    console.log(
      '\nCopy these medians into docs/perf-baseline-2026-08-24.md by hand — this script deliberately does not auto-write the committed baseline doc.',
    )
  } finally {
    await chrome.kill()
    if (previewProcess) {
      previewProcess.kill()
    }
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
```

- [ ] **Step 3: Wire up the script**

In `package.json`'s `"scripts"` block, add (keep alphabetical-ish placement near the other `pnpm` scripts, e.g. right after `"preview"`):

```json
    "perf:lighthouse": "tsx tools/perfLighthouse.ts",
```

- [ ] **Step 4: Run it once locally to confirm it works end to end**

Run: `pnpm perf:lighthouse`
Expected: builds, starts a preview server, runs 6 Lighthouse passes (3 mobile + 3 desktop), prints two median tables, exits 0. If the MOBILE/DESKTOP throttling constants in Step 2 don't match `node_modules/lighthouse/core/config/constants.js`, update them now and note the correction in the script's own comment.

- [ ] **Step 5: Document it in the README**

In `README.md`'s Scripts table (`README.md:27-33`), add a row:

```markdown
| `pnpm perf:lighthouse` | Clean-profile (extension-free) Lighthouse audit of `/practice`, median of 3 runs per form factor — see `docs/perf-baseline-2026-08-24.md` |
```

- [ ] **Step 6: Write the baseline doc — contaminated vs. clean, pre-fix**

Create `docs/perf-baseline-2026-08-24.md`:

```markdown
# Practice-page perf baseline — 2026-08-24

## Contaminated baseline (superseded)

Two Lighthouse runs against production `https://getcodoro.com/practice`,
captured in a Chrome profile with ~12 extensions loaded (MetaMask, Adobe
Acrobat, AdBlock, an LMS-detector, others). **Not a clean measurement** —
kept here only as the historical starting point this pass worked from.

|         | Perf | A11y | Best Practices | SEO  |
| ------- | ---- | ---- | -------------- | ---- |
| Mobile  | 0.46 | 0.96 | 0.73           | 1.00 |
| Desktop | 0.85 | 0.95 | 0.73           | 1.00 |

Confirmed extension noise in these reports (re-verified against the raw
JSON during planning, not just the summary numbers above):

- `unused-javascript`: "Est. savings of 4,741 KiB" mobile / "4,718 KiB"
  desktop — all but two entries are `chrome-extension://` or
  extension-injected `blob:` URLs. The two first-party entries
  (`module-*.js`/posthog, `index-*.js`/main bundle) total ~53 KiB of the
  4,741 KiB figure — genuinely small next to the extension noise, but not
  literally zero as an earlier draft of this finding claimed.
- `errors-in-console` (mobile): 3 network 404s (`/api/v1/courses`,
  `/d2l/api/...`, `/login/token.php`) are an LMS-detector extension probing
  the origin; the `browser_polyfill_default(...).runtime.getManifest is not
a function` exception is from an extension's injected `blob:` script.
  None are Codoro's code.
- `deprecations`: the Shared Storage API warning traces to MetaMask's
  content script (`chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/...`).
- mobile `mainthread-work-breakdown` total 7,492 ms; of the top 5 long
  tasks after the first (first-party, 1,171 ms), 4 are extension scripts.

## Clean baseline (`pnpm perf:lighthouse --prod`, run <DATE>)

<Fill in after Step 4/7: 3-run median per form factor, before any fix in
this plan lands.>

| Metric      | Mobile | Desktop |
| ----------- | ------ | ------- |
| Performance |        |         |
| FCP         |        |         |
| LCP         |        |         |
| TBT         |        |         |
| CLS         |        |         |

## Post-fix (after Tasks 2–7 land)

<Fill in during Task 8.>

| Metric      | Mobile | Desktop |
| ----------- | ------ | ------- |
| Performance |        |         |
| FCP         |        |         |
| LCP         |        |         |
| TBT         |        |         |
| CLS         |        |         |
```

- [ ] **Step 7: Capture the real clean baseline and fill in the doc**

Run: `pnpm perf:lighthouse -- --prod`
Fill the "Clean baseline" table in `docs/perf-baseline-2026-08-24.md` with the printed medians. This is the number every later task's "did this help" check compares against — not the contaminated 0.46.

- [ ] **Step 8: Commit**

```bash
git add tools/perfLighthouse.ts package.json pnpm-lock.yaml README.md docs/perf-baseline-2026-08-24.md
git commit -m "perf: add clean-profile Lighthouse tooling + real baseline"
```

---

### Task 2: Fix footer CLS (mobile 0.196, desktop 0.245) — `.app-shell` full-height layout

**Files:**

- Modify: `src/app/app.css`
- Modify: `src/app/AppShell.test.tsx`

**Interfaces:**

- Produces: `.app-shell` is a full-height flex column below 1024px and a full-height grid with an explicit `1fr auto` row split at/above 1024px, at every width — so `<footer>` never moves when `<main>`'s content grows.

- [ ] **Step 1: Confirm the current failure mode still reproduces**

Read `src/app/app.css` — confirm `.app-shell` has no rule at all outside the `@media (min-width: 1024px)` block (as found during planning). If this has changed, stop and re-diagnose before continuing — the fix below assumes this exact starting shape.

- [ ] **Step 2: Add the base (mobile-first) full-height rule**

In `src/app/app.css`, insert this new block immediately before the existing `.app-shell__main { grid-area: main; }` rule (near the top of the file, after the header comment):

```css
/* 2026-08-24 perf pass: .app-shell had no rule at all below 1024px — the
 * footer sat in plain block flow directly after <main>, so any growth of
 * <main>'s content (RouteSkeleton -> real page, then the puzzle card's own
 * content filling in) pushed it down. Lighthouse's layout-shifts audit
 * (clean profile) attributed both mobile shifts to exactly this element
 * (0.149 + 0.047 = 0.196 CLS). A full-height flex column pins the footer
 * below the fold on a short page instead — see .app-shell__content below
 * for the other half (main growing to fill the remaining space), and the
 * >=1024px block further down for the grid equivalent. */
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.app-shell__content {
  flex: 1 0 auto;
}
```

- [ ] **Step 3: Add the desktop row split**

In the existing `@media (min-width: 1024px)` block, add `grid-template-rows: 1fr auto;` to `.app-shell`'s grid declaration:

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--nav-rail-width) 1fr;
  grid-template-rows: 1fr auto;
  min-height: 100dvh;
}
```

(Same root cause as mobile — desktop CLS 0.245 — because the grid's rows were implicitly `auto`-sized to content with no explicit split, so row 1 (holding `<main>`) grew with content and pushed row 2 (the footer) down instead of the footer staying pinned at the bottom of a short page.)

- [ ] **Step 4: Visually sanity-check**

Run: `pnpm dev`, open `/practice` at a mobile width and at >=1024px. Confirm: the footer sits at the bottom of the viewport (not immediately under a short puzzle card) on a short page, and scrolls normally below the fold on a page taller than one viewport. Confirm the top-bar/footer safe-area padding is unchanged (no new gap or overlap at the notch or home-indicator edge).

- [ ] **Step 5: Write the regression test**

In `src/app/AppShell.test.tsx`, add near the top (after existing imports):

```tsx
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
```

Add a new `describe` block at the end of the file, before the final closing `})`:

```tsx
describe('AppShell — full-height layout contract (CLS regression, 2026-08-24 perf pass)', () => {
  // jsdom doesn't compute real CSS layout or media queries, so this can't
  // assert "the footer never moves" via computed style the way a real
  // browser (or `pnpm perf:lighthouse`) can. It instead asserts app.css
  // itself still declares the full-height contract that keeps the footer
  // pinned below the fold regardless of <main>'s content height — see
  // app.css's own comment for the mechanism. This only catches someone
  // silently deleting/reordering the rule that makes that true; the real
  // verification is `pnpm perf:lighthouse` reporting zero layout-shifts
  // items on /practice.
  it('declares .app-shell as a full-height column at every width, with <main> growing to fill it', () => {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'app.css')
    const css = readFileSync(cssPath, 'utf-8').replace(/\s+/g, ' ')

    expect(css).toContain(
      '.app-shell { display: flex; flex-direction: column; min-height: 100dvh; }',
    )
    expect(css).toContain('.app-shell__content { flex: 1 0 auto; }')
    expect(css).toContain('grid-template-rows: 1fr auto;')
  })
})
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test src/app/AppShell.test.tsx`
Expected: all tests pass, including the new one.

- [ ] **Step 7: Full validate + commit**

Run: `pnpm validate`

```bash
git add src/app/app.css src/app/AppShell.test.tsx
git commit -m "fix: pin AppShell footer below the fold at every width (CLS)"
```

This is its own PR — open it against `main` before starting Task 3.

---

### Task 3: Skip runtime puzzle-content validation in production builds

**Files:**

- Modify: `src/content/index.ts`

**Interfaces:**

- Produces: `puzzlePool` unchanged in shape (`Puzzle[]`) and unchanged in dev/test (still eagerly zod-validated) — production builds skip the 214 `safeParse` calls and, if Rollup's DCE fully removes the now-unreachable zod import, the `schemas-*.js` chunk.

- [ ] **Step 1: Confirm nothing else in the browser bundle needs zod at runtime**

Already confirmed during planning: grepping every reference to `PuzzleSchema`/`ScrubberSchema`/`McqSchema`/`SwipeBinarySchema`/`TapLineSchema`/`DragOrderSchema` across `*.ts`/`*.tsx` turned up real imports only in `src/content/index.ts` (the validation loop below), `src/content/tools/*` (Node-only CLI, not bundled), and `src/content/schema.test.ts` (test-only). `PuzzleCardShell.tsx`/`TraceRunner.tsx`/`devPuzzles.ts`/`engine/scrubber.ts` only mention these names in comments. Re-run this grep before proceeding if any of those files have changed since planning:

Run: `grep -rn "PuzzleSchema\|ScrubberSchema\|McqSchema\|SwipeBinarySchema\|TapLineSchema\|DragOrderSchema" --include="*.ts" --include="*.tsx" src/app src/engine`
Expected: no matches, or only comment references (no `import` lines).

- [ ] **Step 2: Gate the validation loop behind `import.meta.env.DEV`**

In `src/content/index.ts`, replace the `puzzlePool` construction:

```ts
export const puzzlePool: Puzzle[] = Object.entries(modules)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([filePath, raw]) => {
    const result = PuzzleSchema.safeParse(raw)
    if (!result.success) {
      throw new Error(`Invalid puzzle content at ${filePath}: ${result.error.message}`)
    }
    return result.data
  })
```

with:

```ts
// Perf pass (2026-08-24): `pnpm validate:content` (CI-enforced, see
// package.json) already zod-validates every puzzle file at build time —
// content is a build-time constant, so re-deriving that same guarantee
// inside every user's browser on every page load buys nothing in
// production and costs 214 safeParse calls plus the whole zod runtime
// (confirmed on the critical path: schemas-*.js, ~70 KB raw / 19 KB
// transferred, statically imported by this module) before first paint. In
// DEV, still validate eagerly — a bad puzzle file should fail loudly the
// moment `pnpm dev`/`pnpm test` picks it up, not silently ship; every test
// that reads `puzzlePool`/`quizPool`/`scrubberPool` directly (see
// content/index.test.ts, bossRun.test.ts, and the *.pool.test.tsx files)
// depends on this branch staying eager and validated.
// import.meta.env.DEV is a Vite build-time constant, inlined as literal
// `false` in a production build, so Rollup dead-code-eliminates the
// unreachable branch below — same pattern App.tsx already relies on for
// ScrubberDebugPage (see that file's own comment). Verified by grepping
// dist/ after a production build (Step 4 below), not just by reasoning
// about it.
export const puzzlePool: Puzzle[] = Object.entries(modules)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([filePath, raw]) => {
    if (import.meta.env.DEV) {
      const result = PuzzleSchema.safeParse(raw)
      if (!result.success) {
        throw new Error(`Invalid puzzle content at ${filePath}: ${result.error.message}`)
      }
      return result.data
    }
    return raw as Puzzle
  })
```

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all pass, unchanged — Vitest's `import.meta.env.DEV` is `true`, so `content/index.test.ts` and every other test reading `puzzlePool`/`quizPool`/`scrubberPool` still exercises the validated branch.

- [ ] **Step 4: Build and verify the zod chunk is actually gone**

Run: `pnpm build`
Then: `grep -rl "safeParse\|ZodError" dist/assets/*.js` (or open the `content-*.js`/any `schemas-*.js` chunk and search by hand)
Expected: no `schemas-*.js` chunk in `dist/assets/` at all, and no `safeParse`/zod internals reachable from `content-*.js`. If zod is still present, the DCE assumption in Step 1 was wrong somewhere — find the real reachable import before declaring this done, don't just leave the comment claiming it was verified.

- [ ] **Step 5: Full validate + commit**

Run: `pnpm validate`

```bash
git add src/content/index.ts
git commit -m "perf: skip redundant runtime content validation in production builds"
```

Own PR. See the "Scope note" above the task list for what this does _not_ cover (the full metadata/body lazy-load split) and why.

---

### Task 4: Defer posthog-js load past first paint

**Files:**

- Modify: `src/telemetry/client.ts`
- Modify: `src/telemetry/telemetry.test.ts`

**Interfaces:**

- Consumes: nothing new — `initTelemetry()`, `safeCapture()`, `registerAnonId()` keep their existing synchronous-looking signatures; `main.tsx`'s boot-time calls (`initTelemetry()` then `trackSessionStart()`) are unchanged.
- Produces: the underlying `import('posthog-js')` no longer fires the instant `loadPosthog()` is first called — it's scheduled for the browser's idle period (or a `setTimeout` fallback where `requestIdleCallback` doesn't exist, e.g. Safari), while calls made before that still queue correctly against the same memoized promise and fire once it resolves. No event is dropped.

- [ ] **Step 1: Replace the eager-trigger memoization with an idle-scheduled one**

In `src/telemetry/client.ts`, replace:

```ts
let posthogPromise: Promise<PostHogInstance> | null = null

function loadPosthog(): Promise<PostHogInstance> | null {
  if (!env.VITE_POSTHOG_KEY) {
    return null
  }
  posthogPromise ??= import('posthog-js').then((mod) => mod.default)
  return posthogPromise
}
```

with:

```ts
let posthogPromise: Promise<PostHogInstance> | null = null

// Perf pass (2026-08-24): the underlying import('posthog-js') fetch+parse
// (~220 KB raw / 72 KB transferred, confirmed via a real production
// Lighthouse run) used to start the instant loadPosthog() was first
// called — which was main.tsx's initTelemetry()/trackSessionStart() at
// boot, competing for bandwidth and main thread with the app's own chunks
// right inside the LCP window. Scheduling the *import itself* onto the
// browser's idle period (falling back to a macrotask where
// requestIdleCallback doesn't exist — Safari has none) moves that fetch out
// of the critical path without changing when callers THINK the module is
// ready: posthogPromise is still created and memoized exactly once, on
// first call, so every caller (however many, however soon after each
// other) still awaits the same single promise and queues correctly even if
// they call in before the idle callback has fired — no event is dropped,
// it's just captured a little later than it used to be.
function scheduleIdle(run: () => void): void {
  const idle: (cb: () => void) => void =
    typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? (cb) => {
          window.requestIdleCallback(cb)
        }
      : (cb) => {
          setTimeout(cb, 0)
        }
  idle(run)
}

function loadPosthog(): Promise<PostHogInstance> | null {
  if (!env.VITE_POSTHOG_KEY) {
    return null
  }
  posthogPromise ??= new Promise<PostHogInstance>((resolve, reject) => {
    scheduleIdle(() => {
      import('posthog-js')
        .then((mod) => {
          resolve(mod.default)
        })
        .catch((error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)))
        })
    })
  })
  return posthogPromise
}
```

- [ ] **Step 2: Add a regression test for the deferred ordering**

In `src/telemetry/telemetry.test.ts`, add a new `describe` block (after the `initTelemetry` block is fine):

```ts
describe('loadPosthog deferral (perf pass, 2026-08-24)', () => {
  it('does not call posthog.init synchronously — only after the idle callback fires', async () => {
    vi.useFakeTimers()
    try {
      const { initTelemetry } = await loadTelemetry('phc_test_key')
      initTelemetry()
      // jsdom has no requestIdleCallback, so client.ts's fallback schedules
      // a setTimeout(..., 0) — nothing has run it yet.
      expect(posthogMock.init).not.toHaveBeenCalled()
      await vi.runAllTimersAsync()
      expect(posthogMock.init).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a call made before the idle callback fires still queues and captures once it resolves', async () => {
    vi.useFakeTimers()
    try {
      const { trackSessionStart } = await loadTelemetry('phc_test_key')
      trackSessionStart()
      expect(posthogMock.capture).not.toHaveBeenCalled()
      await vi.runAllTimersAsync()
      expect(posthogMock.capture).toHaveBeenCalledWith('session_start', undefined)
    } finally {
      vi.useRealTimers()
    }
  })
})
```

- [ ] **Step 3: Run the full telemetry test file**

Run: `pnpm test src/telemetry/telemetry.test.ts`
Expected: every existing test still passes unchanged (they already `await flushPromises()`, a real macrotask, which drains the fallback `setTimeout` the same way `vi.runAllTimersAsync()` does in the two new tests), plus the two new tests pass.

- [ ] **Step 4: Manual check — no dropped `session_start`**

Run: `pnpm dev`, open `/practice` with devtools open on the Network tab, confirm a request to the configured PostHog host fires shortly after load (not blocking first paint) and that `session_start` still shows up (check via PostHog's own live-events view if available, or temporarily log the capture call locally).

- [ ] **Step 5: Full validate + commit**

Run: `pnpm validate`

```bash
git add src/telemetry/client.ts src/telemetry/telemetry.test.ts
git commit -m "perf: defer posthog-js load until browser idle, past first paint"
```

Own PR.

---

### Task 5: Accessibility — footer link contrast + brand-link label mismatch

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`

**Interfaces:**

- Produces: footer `Settings`/`Legal` links pass WCAG AA contrast (4.5:1); the mobile top-bar brand link's accessible name contains its visible text (WCAG 2.5.3).

- [ ] **Step 1: Fix the footer contrast — scoped to the footer, not the shared token**

`--text-2` (`#636773`) is used in 14 other component files beyond the footer (`ShareMenu.tsx`, `ChallengeComparison.tsx`, `RushPage.tsx`, `DailyPage.tsx`, `StatsPage.tsx`, `LegalPage.tsx`, `BossPage.tsx`, `Home.tsx`, `Scrubber.tsx`, `CodeSnippet.tsx`, `CheckpointPanel.tsx`, `StageTracker.tsx`, `MissionCheckpoint.tsx`, `PatternPicker.tsx`) — bumping the token globally risks a visual regression across all of them without auditing each call site's own background/font-size context, which is out of scope for this pass. **Scoping the fix to the footer**, the only place Lighthouse actually flagged: swap `text-text-2` for `text-text-1` (`#a3a6b0`) on the two footer links only. `--text-1` against `--surface-0` (`#0e0f13`, the confirmed background) computes to ~7.9:1 — well clear of the 4.5:1 AA floor — and it's an existing token already used elsewhere in the app for secondary text, not a new color.

In `src/app/AppShell.tsx`, in the `<footer>` block, change both `<Link>` elements' `className`:

```tsx
<footer className="flex justify-center p-4 pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+var(--space-4))] lg:pb-4 border-t border-border lg:col-span-full">
  <Link
    href={ROUTES.settings.path}
    className="min-h-11 px-3 py-2 bg-transparent text-text-1 text-sm no-underline cursor-pointer inline-flex items-center"
  >
    Settings
  </Link>
  <Link
    href={ROUTES.legal.path}
    className="min-h-11 px-3 py-2 bg-transparent text-text-1 text-sm no-underline cursor-pointer inline-flex items-center"
  >
    Legal
  </Link>
</footer>
```

(Only the two `text-text-2` → `text-text-1` changes; everything else in that block is unchanged.)

- [ ] **Step 2: Fix the brand-link label mismatch**

The mobile top-bar brand link (`<a aria-label="Home" href="/">`) has visible text "Codoro" that its `aria-label` doesn't contain — WCAG 2.5.3 requires the accessible name to contain the visible label. Change `aria-label="Home"` to `aria-label="Codoro — Home"` (keeps "Home" discoverable for a screen-reader user scanning link names, while satisfying 2.5.3 since "Codoro" — the visible text — is contained in the new name). BottomNav's Home tab and NavRail's logo link are icon-only (no visible text next to their own `aria-label="Home"`), so 2.5.3 doesn't apply to them — leave those two untouched; this is a single-file, single-attribute change:

In `src/app/AppShell.tsx`:

```tsx
        <Link
          href="/"
          className="flex items-center gap-2 min-h-11 py-2 bg-transparent no-underline cursor-pointer"
          aria-label="Codoro — Home"
        >
```

- [ ] **Step 3: Update the test that asserts on the old accessible name**

`AppShell.test.tsx`'s `'the logo/brand links home from the mobile bar, the bottom nav, and the desktop rail'` test currently expects exactly 3 links named `'Home'`. With Step 2's change, the mobile top-bar link's accessible name is now `'Codoro — Home'`, dropping the exact-`'Home'` count to 2. Replace that test:

```tsx
it('the logo/brand links home from the mobile bar, the bottom nav, and the desktop rail', () => {
  render(
    <AppShell>
      <p>page content</p>
    </AppShell>,
  )
  // Mobile topbar's brand link carries visible "Codoro" text next to the
  // logo mark, so its accessible name must contain that text (WCAG
  // 2.5.3) — aria-label="Codoro — Home" replaces the old label-content
  // mismatch (aria-label="Home" alone, visible text "Codoro") flagged by
  // Lighthouse's label-content-name-mismatch audit. BottomNav's Home tab
  // and NavRail's logo are icon-only (no visible text label), so WCAG
  // 2.5.3 doesn't apply to them — they keep their plain aria-label="Home".
  const topbarBrandLink = screen.getByRole('link', { name: 'Codoro — Home', hidden: true })
  expect(topbarBrandLink).toHaveAttribute('href', '/')

  const homeLinks = screen.getAllByRole('link', { name: 'Home', hidden: true })
  expect(homeLinks.length).toBe(2)
  homeLinks.forEach((link) => {
    expect(link).toHaveAttribute('href', '/')
  })
})
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test src/app/AppShell.test.tsx`
Expected: all pass.

- [ ] **Step 5: Full validate + commit**

Run: `pnpm validate`

```bash
git add src/app/AppShell.tsx src/app/AppShell.test.tsx
git commit -m "fix: footer link contrast (AA) + brand-link accessible-name mismatch"
```

Own PR.

---

### Task 6: Add a Content-Security-Policy header (report-only)

**Files:**

- Modify: `public/_headers`

**Interfaces:**

- Produces: `Content-Security-Policy-Report-Only` on every response, addressing the `csp-xss` "No CSP found in enforcement mode" (High severity) finding without risking breaking telemetry/the service worker in production before it's been observed against real traffic.

- [ ] **Step 1: Confirm the real PostHog host**

Run: `grep -rn "VITE_POSTHOG_HOST" .env* 2>/dev/null` (and check whatever Cloudflare Pages environment-variable configuration is available to you). If a real deployed value exists and differs from `env.ts`'s default (`https://us.i.posthog.com`), use the real one in Step 2 instead. If you can't confirm it in this session, use the schema default and flag that explicitly in the commit message / Task 8's report — an unconfirmed `connect-src` host is exactly the kind of thing that must not silently ship in enforcing mode (hence report-only for this whole task).

- [ ] **Step 2: Add the header**

Report-only, not enforcing — this pass has no way to verify every directive against a real deployed page in this session (per the constraint below), and a CSP that silently breaks telemetry or the service worker in production is worse than no CSP. Add this block to `public/_headers` (place it before the existing `/sw.js` block, at the top of the file):

```
# 2026-08-24 perf pass: `csp-xss` (Lighthouse Best Practices, High
# severity) flagged "No CSP found in enforcement mode" — there was no
# Content-Security-Policy at all. Report-Only, not enforcing: this can't be
# verified against a real deployed page in this session, and a CSP that
# silently breaks telemetry or the service worker in production is a
# strictly worse outcome than no CSP. Flip to `Content-Security-Policy`
# (dropping `-Report-Only`) only after confirming reports are clean against
# real traffic.
#
# style-src 'unsafe-inline': vite.config.ts's inlineCriticalCss plugin
# inlines the app-shell stylesheet as a literal <style> block with no
# nonce/hash mechanism (see that plugin's own comment) — a hash-based
# style-src would require the plugin to emit a matching per-build hash,
# which is a real rewrite this pass doesn't take on. Taking 'unsafe-inline'
# for style-src only (not script-src) is the documented, narrower trade the
# spec asked for.
# script-src: 'self' plus static.cloudflareinsights.com — Cloudflare Pages'
# own Web Analytics beacon script (confirmed in network-requests: a <script>
# load from that host, not something this app's own code injects).
# connect-src: 'self' plus the PostHog host (see Step 1) and
# static.cloudflareinsights.com (the beacon's own reporting endpoint) — a
# missing entry here silently kills telemetry, not a loud failure, so this
# is exactly the directive to double-check before ever dropping
# Report-Only.
# worker-src 'self': the Workbox-generated service worker (vite.config.ts's
# VitePWA plugin).
/*
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://us.i.posthog.com https://static.cloudflareinsights.com; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests

```

(If Step 1 found a different real PostHog host, substitute it in place of `https://us.i.posthog.com` in the `connect-src` directive above.)

- [ ] **Step 2: Local sanity check**

Run: `pnpm build && pnpm preview`, open `/practice`, confirm the app loads, the service worker registers, and telemetry still fires (Network tab, or PostHog's live-events view). Cloudflare Pages' local preview doesn't apply `_headers`, so this only confirms the app still works _unrelated_ to the header — the header itself can only really be verified post-deploy (hence Report-Only).

- [ ] **Step 3: Full validate + commit**

Run: `pnpm validate`

```bash
git add public/_headers
git commit -m "security: add Content-Security-Policy-Report-Only header"
```

Own PR. Note in the PR description: after this deploys, check the browser console / any configured CSP report endpoint for violations before ever flipping this to enforcing mode.

---

### Task 7: Font weight/subset investigation (report-only — lowest priority, skip if time-constrained)

**Files:** none (investigation task; only proceed to a code change if Step 1 finds a real, low-risk win)

- [ ] **Step 1: Check whether both 700 weights are used at first paint on `/practice`**

Run: `grep -rn "font-bold\|font-weight:\s*700\|--font-weight-bold" src/app/practice src/app/AppShell.tsx src/index.css`
Determine: does anything visible in `/practice`'s above-the-fold render (top bar, puzzle prompt, puzzle card chrome) actually use the 700-weight faces (`space-grotesk-700.woff2`, `jetbrains-mono-700.woff2`), or only the 400s that `index.html` already preloads?

- [ ] **Step 2: Check whether the puzzle corpus is Latin-only**

Run: `grep -rlP "[^\x00-\x7F]" src/content/puzzles/**/*.json` (or equivalent) to check for any non-ASCII characters across the puzzle corpus (snippets should be plain ASCII code per the spec's own assumption).

- [ ] **Step 3: Report, don't implement unless trivial**

If Step 1 shows the 700 weights aren't needed at first paint on `/practice` specifically, and Step 2 confirms Latin-only content, note in Task 8's report that ~20-30 KB is available by subsetting to Latin and/or deferring the 700-weight files off the critical-path preload — but do not implement a font subsetting pipeline in this pass (this task is explicitly the lowest priority in the spec; skip the implementation if Tasks 1-6 have consumed the session). If you do implement anything here, it must be checked against the code-rendering invariant (`--font-size-code`, no `overflow-x: auto`) per the Global Constraints — do not touch `CodeSnippet`/`Scrubber`/`DragOrder` rendering to chase this.

---

### Task 8: Post-fix re-measure, baseline doc update, PWA offline check, final report

**Files:**

- Modify: `docs/perf-baseline-2026-08-24.md`

- [ ] **Step 1: Re-measure clean, post-fix**

Run: `pnpm perf:lighthouse -- --prod` (after Tasks 2, 3, 4, 5, 6 have all deployed — this must run against the real deployed site, not local preview, to match the original methodology). Fill in the "Post-fix" table in `docs/perf-baseline-2026-08-24.md` with the 3-run medians.

- [ ] **Step 2: Verify PWA offline play still works**

With the deployed site open once (so the service worker installs), go offline (devtools Network tab → Offline, or airplane mode on a real device) and confirm `/practice` still loads and serves a puzzle. This specifically checks that Task 3's production/dev branch split in `content/index.ts` didn't change what the service worker precaches — it shouldn't have (the eager glob's _output_ shape is unchanged in production, only the validation step was skipped), but verify by hand rather than assuming.

- [ ] **Step 3: Report the remaining boot cost honestly (spec finding 2c)**

With Tasks 3 and 4 landed, re-check `dist/assets/` chunk sizes for `PuzzleCardShell-*.js` (pulls in framer-motion) and the main `index-*.js` (react-dom + wouter + framer-motion references). Report their actual sizes in the PR/final summary — do not propose ripping out framer-motion; per the spec, that's a product/animation decision, not something this pass makes unilaterally.

- [ ] **Step 4: Report on LCP (spec finding 3)**

Confirm via the Step 1 numbers whether LCP moved meaningfully. Per the spec, LCP's ~1,500 ms "element render delay" was a symptom of the boot-path JS cost (finding #2), not independent — report what actually happened to it now that Task 3 (and only Task 3, per the Scope note) shipped from finding #2, without re-litigating the "no SSR/prerender" decision.

- [ ] **Step 5: State plainly whether the targets were hit**

Targets (clean-profile median, mobile): Performance ≥ 0.80, CLS ≤ 0.05, TBT ≤ 300 ms, LCP ≤ 2.5 s. Desktop: Performance ≥ 0.95, CLS ≤ 0.05. Given the Scope note above (the harder half of finding #2 — the metadata/body lazy-load split — was reported, not implemented, because it requires a real loading-state UI change to the core play loop that's out of scope for this pass), **expect mobile Performance to land short of 0.80** — say so plainly with the actual measured number if that's what happens, rather than reporting success. CLS ≤ 0.05 and desktop Performance ≥ 0.95 should both be reachable from Task 2 alone (the spec's own analysis: desktop's _only_ real problem was the footer CLS).

- [ ] **Step 6: Commit the final baseline doc**

```bash
git add docs/perf-baseline-2026-08-24.md
git commit -m "docs: record post-fix perf numbers, report remaining boot-path cost"
```
