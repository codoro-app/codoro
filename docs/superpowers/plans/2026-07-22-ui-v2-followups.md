# UI v2 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Exception: Task 4 (perf) is controller-executed directly, not dispatched to a subagent** — see that task's header note.

**Goal:** Five review-driven follow-ups on top of the v2 Arena skin: reachable filter-exit, a composed Home screen behind the logo, a diagnosed-then-fixed continue-lag, a collapsible desktop nav rail, and the inline icon set the rail and chip need.

**Architecture:** Pure composition on the existing v2 token/component system — no new dependencies, no new visual patterns invented outside Task 5's explicitly-flagged exceptions (none expected). `src/app/pwa/` stays untouched. Icons ship first since the collapsible rail consumes them.

**Tech Stack:** React 19, Vite 8, Vitest + Testing Library, CSS custom properties (no CSS-in-JS, no icon package).

## Global Constraints

- No new npm dependencies of any kind (icons are hand-copied inline SVG, not a package).
- No AI attribution in commits. Commit per task, in the order below, no batching.
- `src/app/pwa/` is hands-off — nothing in this plan touches it; if a task's implementer finds a reason to, they must stop and flag it instead.
- Zero hex colors outside `src/index.css` — icons use `stroke="currentColor"` / `fill="currentColor"` so they inherit tokens, never a literal color.
- `>=44px` tap targets everywhere touch-reachable, including the collapsed nav rail's icon-only buttons.
- `pnpm validate` (typecheck + lint + test + content-validate + build) must be green before each commit.
- Commit order is fixed: Task 1 (icons) → Task 2 (collapsible rail) → Task 3 (filter exit) → Task 4 (perf) → Task 5 (Home). Icons unblock the rail; filter-exit and perf are independent of everything else; Home goes last because it is the most likely to draw review feedback and nothing else should wait on it.
- `localStorage` key convention already established by `src/app/pwa/useIosInstallPrompt.ts`: `codoro:<kebab-name>`, read/write wrapped in `try { } catch { }` (Safari private-browsing can throw). Reuse this convention exactly for Task 2's collapse preference — do not route it through `src/storage/` (IndexedDB), which is for app data with a schema, not a device-level UI preference.

---

### Task 1: Icon set (`src/app/Icons.tsx`)

**Files:**

- Create: `src/app/Icons.tsx`
- Test: `src/app/Icons.test.tsx`

**Interfaces:**

- Produces: `PracticeIcon`, `DailyIcon`, `RushIcon`, `CollapseIcon`, `CloseIcon`, `RatingIcon`, `StreakIcon` — each `(props: { size?: number }) => JSX.Element`, default export none (named exports only). All render `aria-hidden="true"` internally (decorative; the consuming button/label supplies the accessible name, matching `StatusBar.tsx`'s existing convention) and use `stroke="currentColor"` so callers set color via CSS `color`, not a prop.
- Consumes: nothing — this is a leaf file with no imports beyond React types.

Paths are Lucide (ISC-licensed, commonly attributed as MIT-compatible in this codebase's existing convention) `target`, `calendar`, `zap` (already the established "Codoro house zap" per `StatusBar.tsx`'s combo icon — reuse that exact path for `RushIcon` for visual consistency rather than inventing a second lightning glyph), `chevron-left`, and `x`. `RatingIcon`/`StreakIcon` copy the exact paths already used by `StatusBar.tsx` (trophy/flame) so Home (Task 5) matches pixel-for-pixel without duplicating a third hand-drawn variant — `StatusBar.tsx` and `DailyPage.tsx` are NOT touched by this task; they keep their own inline copies (consistent with this codebase's existing "small inline duplication over a shared-component dependency" convention, e.g. `DailyPage.tsx` already duplicates `StatusBar.tsx`'s icons rather than importing them).

- [ ] **Step 1: Write the file**

```tsx
/**
 * Inline SVG icon set for the v2 Arena UI — no icon-library dependency, per
 * house convention (see StatusBar.tsx). Paths adapted from Lucide
 * (https://lucide.dev, ISC License) — geometric/stroke-based to match the
 * v2 Arena register at 20-24px. All icons are decorative (aria-hidden);
 * callers provide the accessible name via visible text, `title`, or
 * `aria-label` on the enclosing element. Color is inherited via
 * `currentColor` — set `color` in CSS, never pass a color prop.
 */
export interface IconProps {
  size?: number
}

export function PracticeIcon({ size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}

export function DailyIcon({ size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="m9 16 2 2 4-4" />
    </svg>
  )
}

// Same path as StatusBar.tsx's combo icon — the established "Codoro house
// zap" substitute (no lightning glyph exists in the design reference).
export function RushIcon({ size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

// Points left by default; consumers rotate 180deg via CSS (transform) for
// the expand direction rather than shipping two mirrored icon components.
export function CollapseIcon({ size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

export function CloseIcon({ size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// Path identical to StatusBar.tsx's rating pill icon.
export function RatingIcon({ size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}

// Path identical to StatusBar.tsx's streak pill icon. Color (warn vs muted)
// is the caller's responsibility via CSS `color`, same as StatusBar's own
// conditional `stroke` — this component doesn't know about streak count.
export function StreakIcon({ size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  )
}
```

- [ ] **Step 2: Write the test**

```tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import {
  CloseIcon,
  CollapseIcon,
  DailyIcon,
  PracticeIcon,
  RatingIcon,
  RushIcon,
  StreakIcon,
} from './Icons'

describe('Icons', () => {
  it.each([
    ['PracticeIcon', PracticeIcon],
    ['DailyIcon', DailyIcon],
    ['RushIcon', RushIcon],
    ['CollapseIcon', CollapseIcon],
    ['CloseIcon', CloseIcon],
    ['RatingIcon', RatingIcon],
    ['StreakIcon', StreakIcon],
  ])('%s renders an aria-hidden svg sized by the size prop', (_name, Icon) => {
    const { container } = render(<Icon size={32} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '32')
    expect(svg).toHaveAttribute('height', '32')
  })

  it('defaults size to 20 when omitted', () => {
    const { container } = render(<PracticeIcon />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '20')
  })
})
```

- [ ] **Step 3: Run tests, confirm pass**

Run: `pnpm test src/app/Icons.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 4: `pnpm validate`, then commit**

```bash
git add src/app/Icons.tsx src/app/Icons.test.tsx
git commit -m "Add shared inline icon set for nav rail, chip, and Home"
```

---

### Task 2: Collapsible nav rail (desktop only)

**Files:**

- Modify: `src/app/NavRail.tsx`
- Modify: `src/app/NavRail.test.tsx`
- Modify: `src/app/app.css`
- Modify: `src/index.css` (one new token)

**Interfaces:**

- Consumes: `CollapseIcon` from `./Icons` (Task 1).
- Produces: no new props on `NavRailProps` — collapse state is fully internal to `NavRail`, persisted to `localStorage['codoro:nav-rail-collapsed']`. Nothing outside this component needs to know the collapsed state (confirmed: `app.css` picks it up via a `:has()` selector on the rendered class, not a prop threaded from `AppShell`).

- [ ] **Step 1: Add the collapsed-width token**

In `src/index.css`, immediately after the existing `--nav-rail-width: 220px;` line (in the layout-widths block), add:

```css
--nav-rail-width-collapsed: 76px;
```

- [ ] **Step 2: Update `NavRail.tsx`**

Add collapse state (lazy-initialized from `localStorage`, same synchronous-read pattern `useMediaQuery.ts` uses to avoid a `set-state-in-effect` lint violation — no effect needed since `localStorage` is read directly in the initializer, not after mount), a toggle button pinned to the rail's bottom via `margin-top: auto`, and conditional class/label rendering:

```tsx
/**
 * ...(existing doc comment stays; append the two paragraphs below)...
 *
 * Collapse state: a device-level UI preference, not app data — persisted to
 * `localStorage` (key convention from pwa/useIosInstallPrompt.ts: `codoro:`
 * prefix, wrapped in try/catch for Safari private browsing), never routed
 * through src/storage/'s IndexedDB profile. Read synchronously in the
 * `useState` initializer (same pattern as useMediaQuery.ts's
 * useSyncExternalStore snapshot) so there's no flash-then-collapse on
 * mount and no effect-driven setState to trip the set-state-in-effect
 * lint rule.
 *
 * app.css picks up the collapsed state via a `:has(.nav-rail--collapsed)`
 * selector on `.app-shell` rather than a prop threaded down from AppShell —
 * nothing outside this component needs to know the rail is collapsed, so
 * there's no reason to lift the state up.
 */
import { useState } from 'react'
import type { AppMode } from './ModeSwitcher'
import { CollapseIcon } from './Icons'

const COLLAPSED_KEY = 'codoro:nav-rail-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Safari private browsing (and similar) can throw — worst case the
    // preference doesn't persist, which is fine.
  }
}

export interface NavRailProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function NavRail({ mode, onChange }: NavRailProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const itemLabel = (label: string) => (collapsed ? undefined : label)

  return (
    <nav className={`nav-rail${collapsed ? ' nav-rail--collapsed' : ''}`} aria-label="Mode">
      <div className="nav-rail__brand">
        <div className="nav-rail__logo-mark" aria-hidden="true">
          C
        </div>
        {!collapsed && <span className="nav-rail__wordmark">Codoro</span>}
      </div>
      <button
        type="button"
        className={`nav-rail__item${mode === 'practice' ? ' nav-rail__item--active' : ''}`}
        aria-pressed={mode === 'practice'}
        aria-label="Practice"
        title="Practice"
        onClick={() => {
          onChange('practice')
        }}
      >
        {itemLabel('Practice')}
      </button>
      <button
        type="button"
        className={`nav-rail__item${mode === 'daily' ? ' nav-rail__item--active' : ''}`}
        aria-pressed={mode === 'daily'}
        aria-label="Daily"
        title="Daily"
        onClick={() => {
          onChange('daily')
        }}
      >
        {itemLabel('Daily')}
      </button>
      <button
        type="button"
        className="nav-rail__item nav-rail__item--disabled"
        disabled
        aria-disabled="true"
        aria-label="Rush — coming soon"
        title="Rush — coming soon"
      >
        {itemLabel('Rush — coming soon')}
      </button>
      <button
        type="button"
        className="nav-rail__collapse-toggle"
        aria-pressed={collapsed}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        onClick={() => {
          setCollapsed((prev) => {
            const next = !prev
            writeCollapsed(next)
            return next
          })
        }}
      >
        <span
          className="nav-rail__collapse-icon"
          style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}
        >
          <CollapseIcon size={18} />
        </span>
      </button>
    </nav>
  )
}
```

- [ ] **Step 3: Rail + collapsed-state CSS in `app.css`**

Replace the existing `.nav-rail` rule block with (append the new rules after it, keep everything else in the file as-is):

```css
.nav-rail {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-4);
  height: 100%;
  box-sizing: border-box;
  border-right: 1px solid var(--border);
  width: var(--nav-rail-width);
  transition: width 0.15s ease-out;
}

.nav-rail--collapsed {
  width: var(--nav-rail-width-collapsed);
  padding-left: var(--space-2-5);
  padding-right: var(--space-2-5);
}

.nav-rail--collapsed .nav-rail__item {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
}

.nav-rail--collapsed .nav-rail__brand {
  justify-content: center;
  padding: 0 0 var(--space-4);
}

.nav-rail__collapse-toggle {
  margin-top: auto;
  min-width: var(--tap-target-min);
  min-height: var(--tap-target-min);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
}

.nav-rail__collapse-icon {
  display: inline-flex;
  transition: transform 0.15s ease-out;
}

@media (min-width: 1024px) {
  .app-shell:has(.nav-rail--collapsed) {
    grid-template-columns: var(--nav-rail-width-collapsed) 1fr;
  }
}
```

- [ ] **Step 4: Update `NavRail.test.tsx`**

Add tests for the toggle, covering both the interaction and label collapse:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavRail } from './NavRail'

describe('NavRail', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('calls onChange with the clicked mode', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<NavRail mode="practice" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Daily' }))
    expect(onChange).toHaveBeenCalledWith('daily')
  })

  it('renders a disabled Rush entry', () => {
    render(<NavRail mode="practice" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /rush/i })).toBeDisabled()
  })

  it('renders the Codoro logo/wordmark', () => {
    render(<NavRail mode="practice" onChange={vi.fn()} />)
    expect(screen.getByText('Codoro')).toBeInTheDocument()
  })

  it('starts expanded by default and collapses on toggle click', async () => {
    const user = userEvent.setup()
    render(<NavRail mode="practice" onChange={vi.fn()} />)

    expect(screen.getByText('Codoro')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))

    expect(screen.queryByText('Codoro')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument()
  })

  it('persists the collapsed preference to localStorage and restores it on remount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<NavRail mode="practice" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    expect(localStorage.getItem('codoro:nav-rail-collapsed')).toBe('1')
    unmount()

    render(<NavRail mode="practice" onChange={vi.fn()} />)
    expect(screen.queryByText('Codoro')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `pnpm test src/app/NavRail.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: `pnpm validate`, then commit**

```bash
git add src/app/NavRail.tsx src/app/NavRail.test.tsx src/app/app.css src/index.css
git commit -m "Add collapsible desktop nav rail with persisted preference"
```

---

### Task 3: Pattern-filter exit chip

**Files:**

- Modify: `src/app/practice/PracticePage.tsx`
- Modify: `src/app/practice/practicePage.css`
- Modify: `src/app/practice/PracticePage.test.tsx`

**Interfaces:**

- Consumes: `CloseIcon` from `../Icons` (Task 1); `session.patternFilter` / `session.setPatternFilter` (already exist on `usePracticeSession`'s return — see `usePracticeSession.ts:63-64`, unchanged by this task).
- No new interfaces produced — this is presentation-only. `setPatternFilter(null)` already restores the full pool without touching `profile`/`combo`/`solvedThisSession`/`recentIdsRef` (confirmed by reading `usePracticeSession.ts:266-286`), and `onSelectPattern` already replaces rather than stacks the filter (same call, single argument) — both requirements from the brief are already true of the existing hook; this task only needs to make the state visible and clearable in the UI, plus a test that pins the behavior down.

- [ ] **Step 1: Add the clear-chip CSS**

The `.practice-page__filter-banner` class in `practicePage.css` (lines 39-46) is currently dead — defined but never referenced from any `.tsx` file. Replace its body (keep the same class name) with a pill-chip treatment matching `.status-bar__pill`'s existing visual language, and add a clear-button rule:

```css
.practice-page__filter-banner {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--tap-target-min);
  padding: var(--space-1-5) var(--space-2) var(--space-1-5) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--accent-dim);
  border: 1px solid var(--accent);
  color: var(--text-0);
  font-size: var(--font-size-sm);
}

.practice-page__filter-clear {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 32px;
  padding: var(--space-1) var(--space-2-5);
  border: none;
  border-radius: var(--radius-full);
  background: var(--surface-0);
  color: var(--text-0);
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 2: Render the chip in `PracticePage.tsx`**

Import `CloseIcon`. Insert the chip immediately after the `.practice-page__nav` block (after its closing `</div>`, before the `session.status === 'empty'` branch) — it must be visible on mobile and desktop alike, so it is not gated on `isDesktop`:

```tsx
{
  session.patternFilter && (
    <div className="practice-page__filter-banner">
      <span>Filtering: {PATTERN_LABELS[session.patternFilter]}</span>
      <button
        type="button"
        className="practice-page__filter-clear"
        onClick={() => {
          session.setPatternFilter(null)
        }}
      >
        <CloseIcon size={12} />
        All patterns
      </button>
    </div>
  )
}
```

Also simplify the browse button's label back to a static `"Browse patterns"` (it currently reads `Pattern: {label}` — now redundant with the new chip and would show the active pattern twice):

```tsx
<span>Browse patterns</span>
```

(replacing the existing ternary at `PracticePage.tsx:144-147`).

- [ ] **Step 3: Add the test**

Append to `PracticePage.test.tsx` (the exact mock setup for `usePracticeSession`/storage already exists in this file from prior phases — follow its established mocking pattern; the new test drives the filter through `session.setPatternFilter` the same way existing tests drive other session actions). Read the top of the file first and adapt the call shape to its real mock factory (helper/mock names below are illustrative, not literal, if the file's existing convention differs):

```tsx
it('shows a clearable filter chip when a pattern filter is active, and clears it without resetting session stats', async () => {
  const user = userEvent.setup()
  renderPracticePage({ patternFilter: 'off-by-one', solvedThisSession: 3 })

  expect(screen.getByText(/filtering: /i)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /all patterns/i }))

  expect(mockSetPatternFilter).toHaveBeenCalledWith(null)
  expect(screen.queryByText(/filtering: /i)).not.toBeInTheDocument()
  expect(screen.getByText(/3 solved this session/i)).toBeInTheDocument()
})
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `pnpm test src/app/practice/PracticePage.test.tsx`
Expected: PASS, all existing tests plus the new one.

- [ ] **Step 5: `pnpm validate`, then commit**

```bash
git add src/app/practice/PracticePage.tsx src/app/practice/practicePage.css src/app/practice/PracticePage.test.tsx
git commit -m "Add clearable pattern-filter chip to Practice"
```

---

### Task 4: Continue-lag diagnosis and fix

**This task is executed directly by the controller, not dispatched to a subagent** — the brief explicitly asks for the strongest available reasoning here since a wrong guess ships a placebo fix. No browser Performance panel is reachable in this environment (confirmed unavailable all session — no connected Chrome extension or Playwright bridge); the substitute is a real, honest measurement using `fake-indexeddb` (already a dependency, used by `src/storage/*.test.ts`) to reproduce the actual code paths at realistic scale and get real wall-clock numbers, not a guess.

**Files (provisional — the fix step only touches whichever file the measurement implicates):**

- Create (temporary, not committed unless kept as a permanent regression guard): a `*.bench.test.ts` under `src/storage/` or `src/app/practice/`.
- Likely candidates for the actual fix, pending measurement: `src/storage/attempts.ts`, `src/storage/exportImport.ts`.

**Procedure:**

1. **Instrument, don't guess.** Write a Vitest test file that seeds `fake-indexeddb` with a realistic large attempt history (e.g. 1500 attempts across the pattern set — several months of daily practice, well past what a single-pattern grind session would produce) via direct `appendAttempt` calls or a bulk seed, then measures with `performance.now()`:
   - `selectNext()`'s cost when called against a pattern-filtered pool with a full 20-entry `recentIds` window and a populated `requeueState` (the actual shape of "pool exhausted" — small pool, everything recently served, window fully widened).
   - `listAttempts()`'s cost alone (the IndexedDB `getAll` + validate + sort).
   - `computeMastery(attempts, puzzlePool)`'s cost alone, given the array `listAttempts()` returns.
   - The combined `listAttempts()` → `computeMastery()` chain, matching exactly what `MasteryView.tsx`'s effect (`MasteryView.tsx:61-71`, refetching on every `attemptVersion` bump — i.e. on every single answered puzzle, not just Continue) actually does.

2. **Compare against a small-history baseline** (e.g. 20 attempts) for the same four measurements, to see which one scales with total lifetime attempt count rather than staying flat.

3. **Name the actual cause** before writing any fix. Based on reading `usePracticeSession.ts` (`handleContinue` at line 260 is a synchronous, non-async call chain — it does not itself call `listAttempts` or any IndexedDB read) and `MasteryView.tsx` (its effect fires on _every_ `attemptVersion` bump, which happens on every answered puzzle, and is always mounted in the desktop sidebar alongside Practice), the leading hypothesis is: the hitch is not literally inside the Continue click handler, but the sidebar `MasteryView`'s full-history `listAttempts()` + `computeMastery()` recompute — triggered by the answer _just before_ the Continue click — lands (resolves its promise, sets state, re-renders) at roughly the same moment the user clicks Continue, and it's this unrelated, unbounded, ever-growing (grows with _total lifetime_ attempts, not just the current pattern) synchronous JS + re-render that blocks the main thread and reads as "clicking Continue is slow." A single-pattern grind session is exactly the scenario where a user accumulates enough attempts in one sitting to first notice a threshold effect that was already present. Confirm or refute this with the actual numbers from steps 1-2 before proceeding — if the numbers don't support it, report the real bottleneck instead of forcing this fix.

4. **If confirmed** (listAttempts + computeMastery dominates and scales with total attempt count): the fix must preserve `listAttempts()`'s exact contract (chronologically-sorted, full history, corrupt-row-filtering — `mastery.ts` and `attempts.test.ts` both depend on this) rather than truncating or reordering results, since truncating the read window would silently change `computeMastery`'s output for any pattern practiced unevenly relative to total history — a semantics change the brief explicitly bars. The safe fix is an in-memory cache inside `src/storage/attempts.ts` that is correctly invalidated on **both** of the store's two write paths — `appendAttempt` (this file) and `exportImport.ts`'s `importData` (a raw `ATTEMPTS_STORE` transaction that bypasses `appendAttempt` entirely, confirmed by reading `exportImport.ts:56-65`):

   ```ts
   // in src/storage/attempts.ts
   let cache: Attempt[] | null = null

   export function invalidateAttemptsCache(): void {
     cache = null
   }

   export async function appendAttempt(attempt: Attempt): Promise<void> {
     const validated = AttemptSchema.parse(attempt)
     const db = await getDb()
     try {
       await db.put(ATTEMPTS_STORE, validated)
     } finally {
       db.close()
     }
     // Attempts are appended in increasing createdAt order in practice, so
     // pushing preserves the sort invariant listAttempts() promises without
     // re-sorting the whole array on every write.
     if (cache) {
       cache = [...cache, validated]
     }
   }

   export async function listAttempts(): Promise<Attempt[]> {
     if (cache) {
       return cache
     }
     const db = await getDb()
     try {
       const raw: unknown[] = await db.getAll(ATTEMPTS_STORE)
       const attempts = raw
         .map((row) => AttemptSchema.safeParse(row))
         .filter((result) => result.success)
         .map((result) => result.data)
       attempts.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
       cache = attempts
       return attempts
     } finally {
       db.close()
     }
   }
   ```

   And in `exportImport.ts`, call the invalidation hook right after the raw transaction commits (`importData`, after `await tx.done`):

   ```ts
   import { invalidateAttemptsCache } from './attempts'
   // ...
   await tx.done
   invalidateAttemptsCache()
   ```

   `src/storage/attempts.test.ts` writes directly to `ATTEMPTS_STORE` via `db.put` (bypassing `appendAttempt`) to test corrupt-row handling, and every storage test file calls `deleteDB(DB_NAME)` in `afterEach` to reset state between tests — **both bypass this cache**, which would silently return stale cached data across tests within the same file and break the corrupt-row test specifically. Guard against this: add `invalidateAttemptsCache()` calls alongside the existing `deleteDB` calls in `attempts.test.ts`'s and `exportImport.test.ts`'s `beforeEach`/`afterEach` (any storage test file that calls `deleteDB` and also calls `listAttempts` across multiple tests in the same file needs this), so each test starts with a cold cache, matching the fresh-DB guarantee `deleteDB` already provides.

5. **If not confirmed**, do not apply the fix above. Instead: measure `selectNext`/`pickFromWindow`/`widenedEligible` directly (these operate on tiny per-pattern pools — dozens of puzzles at most — so are unlikely to be the cause, but confirm with real numbers rather than assuming), and if neither the storage layer nor selection explains a ~1s hitch, report that the delay is most likely a rendering/animation artifact (e.g. the `AnimatePresence`/`framer-motion` spring transition in `PracticePage.tsx:180-197`, or layout thrash from the sidebar re-render) rather than a JS-compute bottleneck this environment's tooling can diagnose, and stop — do not ship a guessed fix for a cause the measurements didn't support.

- [ ] **Step 1: Write and run the timing harness** (not committed unless the numbers are stable and useful as a permanent regression guard — controller's call at execution time).

- [ ] **Step 2: Record before/after numbers.** Report the exact measured milliseconds (baseline small-history vs. large-history, for each of the four measurements in step 1) — this is what goes in the PR description per the brief's explicit ask.

- [ ] **Step 3: Apply the fix matching the confirmed cause** (see branch 4 above, or the appropriate alternative from branch 5).

- [ ] **Step 4: Re-measure after the fix**, confirming the large-history case now matches the small-history baseline (or is at minimum imperceptible, <16ms — one frame budget).

- [ ] **Step 5: Run the full existing storage + practice test suites, confirm nothing broke**

Run: `pnpm test src/storage src/app/practice`
Expected: PASS, all existing tests including `attempts.test.ts`'s corrupt-row handling.

- [ ] **Step 6: `pnpm validate`, then commit**

```bash
git add src/storage/attempts.ts src/storage/exportImport.ts src/storage/attempts.test.ts src/storage/exportImport.test.ts
git commit -m "Fix continue-lag: stop refetching+resorting full attempt history on every attempt"
```

(adjust the file list to whatever the measurement actually implicated — this is provisional pending step 1-3's real findings.)

---

### Task 5: Home screen behind the logo

**Files:**

- Create: `src/app/Home.tsx`
- Create: `src/app/home.css`
- Create: `src/app/Home.test.tsx`
- Modify: `src/app/ModeSwitcher.tsx` (widen `AppMode`, no visual change)
- Modify: `src/app/NavRail.tsx` (make the brand block clickable)
- Modify: `src/app/AppShell.tsx` (add a mobile app-bar brand block; there is currently no visible "Codoro" logo on mobile at all — only `ModeSwitcher`'s tab strip — so this is a small necessary addition, not a refactor of existing chrome)
- Modify: `src/app/App.tsx` (route the new `'home'` mode)
- Modify or create `src/app/App.test.tsx` — check first with `Glob src/app/App.test.tsx`; add a boot-lands-on-Practice regression test either there or in a new file if none exists.

**Interfaces:**

- Consumes: `loadProfile()` from `../storage` directly — Home is not nested under `PracticePage`/`DailyPage`, so it loads the profile itself, mirroring `usePracticeSession.ts`'s own `loadProfile`/`cancelledRef` mount pattern (copy that shape, don't invent a new one). `getDailyNumber` from `../engine` (already used by `useDailySession.ts:18,68`). `PracticeIcon`/`DailyIcon`/`RushIcon`/`RatingIcon`/`StreakIcon` from `./Icons` (Task 1).
- Produces: `AppMode` widens from `'practice' | 'daily'` to `'practice' | 'daily' | 'home'` (single source of truth stays `ModeSwitcher.tsx`, already imported by both `App.tsx` and `NavRail.tsx`).

**Composition constraint (from the brief — verified against the existing CSS below, zero new visual patterns needed):**

- Rating + streak: exact reuse of `.status-bar` / `.status-bar__pill` markup and classes (same shape as `DailyPage.tsx`'s sidebar copy at `DailyPage.tsx:185-221`).
- Daily status (done/not-done + streak) is composed into the Daily mode card's badge rather than a fourth standalone element — the badge reuses `.pattern-picker__badge--mastered` (accent-dim background, accent text — "Done today") / `.pattern-picker__badge--new` (muted text — "Not done yet") exactly as `PatternPicker.tsx` already uses them for accuracy state, just with different label text. This is a deliberate compositional reading of the brief's three content bullets, not a fourth invented block — **flag this specific call in the final summary** so Thomas can confirm or ask for a separate status element instead.
- Three mode cards reuse `.pattern-picker__button`'s existing card shape (border, `--radius-md`, `--surface-1` background, flex column, padding) verbatim as the base card class. The Practice card (primary CTA) layers on `.pattern-picker__all`'s existing solid-accent-fill treatment as a modifier — recombining two already-existing button treatments, not inventing a third. The Rush card reuses `.mode-switcher__tab--disabled`'s existing opacity/cursor/`disabled` treatment.

- [ ] **Step 1: Widen `AppMode` in `ModeSwitcher.tsx`**

```tsx
export type AppMode = 'practice' | 'daily' | 'home'
```

No other change to this file — the mobile tab strip intentionally gets no Home tab (logo is the only entry point, per the brief).

- [ ] **Step 2: Make `NavRail.tsx`'s brand block clickable**

Wrap the existing brand `<div>` in a `<button>` (keep the inner logo-mark/wordmark markup and classes exactly as-is), calling `onChange('home')`:

```tsx
<button
  type="button"
  className="nav-rail__brand nav-rail__brand--button"
  aria-label="Home"
  onClick={() => {
    onChange('home')
  }}
>
  <div className="nav-rail__logo-mark" aria-hidden="true">
    C
  </div>
  {!collapsed && <span className="nav-rail__wordmark">Codoro</span>}
</button>
```

Add a matching reset rule to `app.css` right after `.nav-rail__brand`:

```css
.nav-rail__brand--button {
  border: none;
  background: transparent;
  cursor: pointer;
  min-height: var(--tap-target-min);
}
```

- [ ] **Step 3: Add the mobile app bar to `AppShell.tsx`**

```tsx
export function AppShell({ mode, onModeChange, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__mobile-nav">
        <button
          type="button"
          className="app-shell__mobile-brand"
          aria-label="Home"
          onClick={() => {
            onModeChange('home')
          }}
        >
          <div className="nav-rail__logo-mark" aria-hidden="true">
            C
          </div>
          <span className="nav-rail__wordmark">Codoro</span>
        </button>
        <ModeSwitcher mode={mode} onChange={onModeChange} />
      </div>
      <div className="app-shell__rail">
        <NavRail mode={mode} onChange={onModeChange} />
      </div>
      <main className="app-shell__content">{children}</main>
    </div>
  )
}
```

Add to `app.css` (reuses `.nav-rail__logo-mark`/`.nav-rail__wordmark` classes as-is — only the new flex wrapper is new CSS):

```css
.app-shell__mobile-brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--tap-target-min);
  padding: var(--space-2) 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
```

- [ ] **Step 4: Route `'home'` in `App.tsx`**

```tsx
import { Home } from './Home'
// ...
;<AppShell mode={mode} onModeChange={setMode}>
  {mode === 'practice' ? (
    <PracticePage />
  ) : mode === 'daily' ? (
    <DailyPage />
  ) : (
    <Home onNavigate={setMode} />
  )}
</AppShell>
```

Initial state stays `useState<AppMode>('practice')` — unchanged, so boot still lands on Practice.

- [ ] **Step 5: Write `Home.tsx`**

```tsx
/**
 * Home screen — reachable only via the logo (desktop rail / mobile app
 * bar), never the boot path (App.tsx's initial mode stays 'practice', so
 * the "solving within ~10 seconds" cold start is untouched). Composed
 * entirely from existing v2 patterns: rating/streak reuse StatusBar's pill
 * markup, the three mode cards reuse PatternPicker's card shape (plus
 * pattern-picker__all's accent-fill for the Practice primary CTA and
 * mode-switcher's disabled treatment for Rush), and Daily's done/not-done
 * state is folded into its card's badge (pattern-picker__badge--mastered/
 * --new) rather than a separate status element — see the plan's Task 5
 * composition-constraint note for why, and flag to Thomas if a standalone
 * status block was actually wanted.
 */
import { useEffect, useRef, useState } from 'react'
import { loadProfile } from '../storage'
import type { UserProfile } from '../storage'
import { getDailyNumber } from '../engine'
import { DailyIcon, PracticeIcon, RatingIcon, RushIcon, StreakIcon } from './Icons'
import type { AppMode } from './ModeSwitcher'
import './home.css'

export interface HomeProps {
  onNavigate: (mode: AppMode) => void
}

function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export function Home({ onNavigate }: HomeProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      const loaded = await loadProfile()
      if (cancelledRef.current) return
      setProfile(loaded)
    })()
    return () => {
      cancelledRef.current = true
    }
  }, [])

  if (profile === null) {
    return (
      <div className="home app-shell__main">
        <p className="home__status">Loading…</p>
      </div>
    )
  }

  const today = todayDateString()
  const dayNumber = getDailyNumber(today)
  const doneToday = profile.dailyCompletion?.date === today

  return (
    <div className="home app-shell__main">
      <div className="status-bar">
        <div className="status-bar__pill status-bar__pill--rating" title="Rating">
          <RatingIcon size={14} />
          <span>{Math.round(profile.rating)}</span>
        </div>
        <div className="status-bar__pill status-bar__pill--streak" title="Daily streak">
          <span className="home__streak-icon" data-active={profile.streak.currentStreak > 0}>
            <StreakIcon size={14} />
          </span>
          <span>{profile.streak.currentStreak}</span>
        </div>
      </div>

      <div className="home__cards">
        <button
          type="button"
          className="home__card home__card--primary"
          onClick={() => {
            onNavigate('practice')
          }}
        >
          <PracticeIcon size={22} />
          <span className="home__card-title">Practice</span>
          <span className="home__card-desc">Endless rating-matched puzzles</span>
        </button>

        <button
          type="button"
          className="home__card"
          onClick={() => {
            onNavigate('daily')
          }}
        >
          <DailyIcon size={22} />
          <span className="home__card-title">Daily #{dayNumber}</span>
          <span className="home__card-desc">One puzzle, once a day</span>
          <span
            className={`pattern-picker__badge pattern-picker__badge--${doneToday ? 'mastered' : 'new'}`}
          >
            {doneToday ? 'Done today' : 'Not done yet'}
          </span>
        </button>

        <div className="home__card home__card--disabled" aria-disabled="true">
          <RushIcon size={22} />
          <span className="home__card-title">Rush</span>
          <span className="home__card-desc">Timed sprint mode</span>
          <span className="pattern-picker__badge pattern-picker__badge--new">Coming soon</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write `home.css`**

```css
/*
 * Home screen: composed entirely from existing v2 tokens/classes (see
 * Home.tsx's doc comment) — this file only adds the layout grid and the
 * two card modifiers (primary/disabled) that don't already exist on
 * pattern-picker__button.
 */

.home {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  width: 100%;
  max-width: var(--content-width-mobile);
  margin: 0 auto;
  padding: calc(var(--space-4) + env(safe-area-inset-top)) var(--space-4) var(--space-4);
  box-sizing: border-box;
}

@media (min-width: 1024px) {
  .home {
    max-width: var(--content-width-desktop);
  }
}

.home__status {
  text-align: center;
  color: var(--text-1);
  padding: 2rem 0;
}

.home__streak-icon {
  display: inline-flex;
  color: var(--text-2);
}

.home__streak-icon[data-active='true'] {
  color: var(--warn);
}

.home__cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

@media (min-width: 640px) {
  .home__cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }
}

.home__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  min-height: var(--tap-target-min);
  width: 100%;
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--text-0);
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}

.home__card--primary {
  background: var(--accent);
  color: var(--accent-ink);
  border-color: var(--accent);
}

.home__card--disabled {
  opacity: 0.55;
  cursor: default;
}

.home__card-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
}

.home__card-desc {
  font-size: var(--font-size-sm);
  color: inherit;
  opacity: 0.85;
}
```

- [ ] **Step 7: Write `Home.test.tsx`**

Mock `loadProfile` from `../storage` the same way this codebase's other page-level tests already mock it (check `PracticePage.test.tsx`'s existing storage mock for the exact shape — reuse its convention, don't invent a new mock factory). Field names in `baseProfile()` below must match `UserProfile`'s actual shape from `src/storage/schema.ts` — read that file first and adjust if it differs from the shape shown here.

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Home } from './Home'
import { loadProfile } from '../storage'

vi.mock('../storage', async () => {
  const actual = await vi.importActual('../storage')
  return { ...actual, loadProfile: vi.fn() }
})

function baseProfile() {
  return {
    schema_version: 1,
    rating: 1250,
    ratedAttemptCount: 40,
    streak: { currentStreak: 3, longestStreak: 5, lastActiveDate: '2026-07-21' },
    requeueState: [],
    dailyCompletion: null,
  }
}

describe('Home', () => {
  beforeEach(() => {
    vi.mocked(loadProfile).mockReset()
  })

  it('shows rating and streak once the profile loads', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile() as never)
    render(<Home onNavigate={vi.fn()} />)

    expect(await screen.findByText('1250')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows "Not done yet" on the Daily card when today has no completion', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile() as never)
    render(<Home onNavigate={vi.fn()} />)

    expect(await screen.findByText('Not done yet')).toBeInTheDocument()
  })

  it('shows "Done today" when dailyCompletion matches today', async () => {
    const today = new Date().toISOString().slice(0, 10)
    vi.mocked(loadProfile).mockResolvedValue({
      ...baseProfile(),
      dailyCompletion: { date: today, attemptId: 'a1', correct: true },
    } as never)
    render(<Home onNavigate={vi.fn()} />)

    expect(await screen.findByText('Done today')).toBeInTheDocument()
  })

  it('navigates to practice when the Practice card is clicked', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile() as never)
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<Home onNavigate={onNavigate} />)

    await user.click(await screen.findByRole('button', { name: /practice/i }))
    expect(onNavigate).toHaveBeenCalledWith('practice')
  })

  it('renders Rush as non-interactive', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile() as never)
    render(<Home onNavigate={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Coming soon')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /rush/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Add/confirm the cold-start regression test**

Check for an existing `App.test.tsx` via `Glob src/app/App.test.tsx`. If one exists, add a test asserting the app boots on Practice, not Home. If none exists, create one:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App', () => {
  it('boots directly into Practice, not Home', () => {
    render(<App />)
    expect(screen.queryByText(/loading your practice session/i)).toBeInTheDocument()
  })
})
```

(This asserts the Practice loading state renders on first paint — the fastest reliable signal that Home's own async profile load isn't in the initial render path. If `App.tsx` already has a richer smoke test, extend it instead of duplicating.)

- [ ] **Step 9: Run tests, confirm pass**

Run: `pnpm test src/app/Home.test.tsx src/app/App.test.tsx src/app/NavRail.test.tsx`
Expected: PASS.

- [ ] **Step 10: `pnpm validate`, then commit**

```bash
git add src/app/Home.tsx src/app/home.css src/app/Home.test.tsx src/app/ModeSwitcher.tsx src/app/NavRail.tsx src/app/AppShell.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "Add Home screen behind the logo, composed from existing v2 patterns"
```

---

## Definition of Done (mirrors the brief)

- [ ] Filtered practice always shows the active-pattern chip; clearing it restores the all-patterns pool without a reload; component test covers filter → clear → serving from full pool (Task 3).
- [ ] Logo click opens Home on desktop and mobile; every element on Home traces to an existing v2 pattern (or is explicitly flagged); boot still lands on Practice (Task 5).
- [ ] Continue after pool exhaustion: root cause named, measured before/after, no perceptible hitch; selection-semantics tests untouched and green (Task 4).
- [ ] Nav collapses/expands, preference survives reload, icon-only state keeps 44px targets (Task 2).
- [ ] `pnpm validate` green; zero new dependencies; no hex colors outside `index.css` (Task 1-5, checked at each commit).
- [ ] Screenshots: filter chip active, Home (1440 + 390), collapsed + expanded rail — **blocked by the same no-connected-browser-tool constraint that affected the prior ui-v2-arena session; flag to Thomas for his own local verification, same as before.**
