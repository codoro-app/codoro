# Phase 2b.1 — Design Tokens + Layout Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out `docs/v3-build-plan.md`'s 2b.1 — verify the token file is already the single source of truth for color, and build+prove a shared `dvh`-based layout shell (`PageShell`) with an anchored/sticky primary-action pattern, applied end-to-end on Home.

**Architecture:** A new `PageShell` component (`src/app/PageShell.tsx`) wraps a page's content with an optional `header` slot (`position: sticky; top: 0`) and an optional `stickyAction` slot (`position: sticky; bottom: 0`), both riding the page's existing normal document scroll — no restructuring of `AppShell`/`<body>`/`#root` into a fixed-height, internally-scrolling shell (lower blast radius, and `sticky` alone is sufficient to satisfy the plan's "anchored/sticky primary action" wording). Three known `100vh` sites become `100dvh` (fixes the mobile-Safari address-bar viewport-jump bug as a side effect). `Home.tsx` is the one screen that adopts `PageShell` this phase: its rating/streak header + Practice card (the primary action) move into the `header` slot; the Daily/Rush/Trace/Boss/Missions grid becomes the scrollable body. `stickyAction` stays unused this phase (Home has no natural single bottom CTA) — it's a reasonable no-op that only pays off once 2b.2 wires a real "Continue" button into it on Practice/Trace/Daily/Rush/Boss.

**Tech Stack:** React (component + slots), Tailwind v4 utility classes (no new CSS file — matches 2b.0's convention of pushing everything expressible as utilities onto the JSX), Vitest + Testing Library (tests).

## Global Constraints

- `pnpm validate` (typecheck + lint + test + validate:content + build) must stay green after every task.
- No hardcoded hex/rgb color values anywhere touched by this plan — every color reference uses an existing Tailwind color utility (`bg-surface-0`, `border-border`, etc.), which is already aliased onto `src/index.css`'s `:root` tokens via `@theme inline`.
- `.home` (Home's root marker class) and `.home__card-title` (the Practice link's title span, both used by `src/app/App.test.tsx` — `container.querySelector('.home')` and `screen.findByText('Practice', { selector: '.home__card-title' })`, plus `.closest('a')` navigation) must keep working unchanged. Neither classname's element, nor its role (`link`) or accessible name, may move in a way that breaks those queries.
- No new hardcoded pixel/rem literals for spacing — reuse existing `--space-*`/Tailwind spacing utilities and `env(safe-area-inset-*)`, matching the codebase's existing convention (see `AppShell.tsx`'s mobile nav wrapper: `pt-[calc(var(--space-2)+env(safe-area-inset-top))]`).
- This phase does **not** touch the theme picker, skeleton loaders, or optimistic rendering — all three are explicitly out of scope per `docs/v3-build-plan.md`'s Phase 2b preamble ("Explicitly not touched by this phase").

---

## Design record (write this down before Task 1 touches code)

**Build item 1 (palette formalization) needs no code — verify and close only.** `src/index.css`'s `:root` block already defines the full `docs/design/codoro-v2-arena.html` palette (surfaces, `--accent: #c6f83c`, danger/warn, syntax-highlight tokens) and both fonts (Space Grotesk / JetBrains Mono), all aliased through `@theme inline` per 2b.0's own setup. A grep across every component CSS file except `index.css`/`tokens.css` (`grep -rn "#[0-9a-fA-F]\{3,8\}\b" src --include="*.css"`, excluding those two files) already returns zero matches. Task 4 below re-runs that grep as the closing verification instead of editing tokens that don't need editing — direct user decision, 2026-08-12.

**Why `position: sticky`, not a fixed-height/`overflow: hidden` app shell.** The plan's wording ("dvh-based page shell, primary action anchored/sticky") doesn't require a fully bounded-viewport shell with one internal scroll region (the Slack/Discord-style pattern) — it requires the primary action to not need scrolling to reach. `position: sticky` achieves that inside the app's _existing_ scroll model (the whole page scrolls today, via normal `<body>` flow) with zero changes to `AppShell.tsx`, `app.css`'s grid, or `<body>`'s box model beyond the `dvh` swap. The heavier pattern would touch every page in the app (all currently assume page-level scroll) for a single-screen proof — out of proportion for this phase and a real regression risk to defer, not something this plan's own scope should absorb.

**Why Home's `header` slot carries the Practice card, not just the rating/streak row.** Direct user decision, 2026-08-12 (see brainstorming transcript): Home has no natural bottom CTA to exercise `stickyAction`, so proving the primitive end-to-end on Home means pinning Home's actual primary action (the Practice card) rather than leaving `stickyAction` unproven. This is a small, visible layout change to Home ahead of its full 2b.5 redesign — accepted as in-scope, not deferred, because it's the only way this phase's DoD ("no scroll needed to reach the primary action") is actually exercised rather than trivially true by accident (Home's content is currently short enough to fit most viewports unscrolled anyway, which would make the DoD meaningless without this).

**Safe-area-inset handling stays the caller's responsibility, not `PageShell`'s.** `PageShell` itself adds no padding beyond a small visual gap + border between its sticky regions and the scrolling body — it does not inject `env(safe-area-inset-top/bottom)` itself. This matches the existing convention (`AppShell.tsx`'s mobile nav div applies `pt-[calc(var(--space-2)+env(safe-area-inset-top))]` directly to itself, not through a shared wrapper) and keeps `PageShell` generic: a future consumer with a `stickyAction` slot near the bottom of the screen supplies its own `pb-[env(safe-area-inset-bottom)]` on the content it passes in, same as Home's `header` content supplies its own `pt-[...+env(safe-area-inset-top)]` below.

**Known, accepted spacing delta on Home.** Today, Home's outer container carries `pt-[calc(var(--space-4)+env(safe-area-inset-top))]` (1rem + safe-area) _and_ its rating row carries its own `pt-5` (1.25rem) — a redundant double top-gap. Moving the safe-area handling onto the rating row itself (Task 3) collapses this to `pt-[calc(var(--space-5)+env(safe-area-inset-top))]`, a `~1rem` reduction in top whitespace. This is directionally aligned with Thomas's own "empty space on every page" complaint (`docs/v3-build-plan.md` Phase 2b origin), not a regression to flag — recorded here so it isn't mistaken for an accidental diff.

---

## Task 1: `PageShell` component

**Files:**

- Create: `src/app/PageShell.tsx`
- Test: `src/app/PageShell.test.tsx`

**Interfaces:**

- Produces: `PageShellProps { header?: ReactNode; stickyAction?: ReactNode; children: ReactNode; className?: string }`, `export function PageShell(props: PageShellProps): JSX.Element`. Task 3 (Home) is this component's first consumer.

- [ ] **Step 1: Write the failing tests**

Create `src/app/PageShell.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageShell } from './PageShell'

describe('PageShell', () => {
  it('always renders children', () => {
    render(
      <PageShell>
        <p>Body content</p>
      </PageShell>,
    )
    expect(screen.getByText('Body content')).toBeInTheDocument()
  })

  it('renders header content, pinned via sticky positioning, when provided', () => {
    const { container } = render(
      <PageShell header={<p>Header content</p>}>
        <p>Body content</p>
      </PageShell>,
    )
    const headerEl = screen.getByText('Header content')
    expect(headerEl.closest('.sticky.top-0')).not.toBeNull()
    expect(container.querySelectorAll('.sticky.top-0')).toHaveLength(1)
  })

  it('renders no sticky top-0 wrapper when header is omitted', () => {
    const { container } = render(
      <PageShell>
        <p>Body content</p>
      </PageShell>,
    )
    expect(container.querySelector('.sticky.top-0')).toBeNull()
  })

  it('renders stickyAction content, pinned to the bottom, when provided', () => {
    const { container } = render(
      <PageShell stickyAction={<button type="button">Continue</button>}>
        <p>Body content</p>
      </PageShell>,
    )
    expect(screen.getByRole('button', { name: 'Continue' }).closest('.sticky.bottom-0')).not.toBe(
      null,
    )
    expect(container.querySelectorAll('.sticky.bottom-0')).toHaveLength(1)
  })

  it('renders no sticky bottom-0 wrapper when stickyAction is omitted', () => {
    const { container } = render(
      <PageShell>
        <p>Body content</p>
      </PageShell>,
    )
    expect(container.querySelector('.sticky.bottom-0')).toBeNull()
  })

  it('applies className to the root element', () => {
    const { container } = render(
      <PageShell className="my-page-class">
        <p>Body content</p>
      </PageShell>,
    )
    expect(container.querySelector('.my-page-class')).toBe(container.firstElementChild)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/PageShell.test.tsx`
Expected: FAIL — `Cannot find module './PageShell'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/app/PageShell.tsx`:

```tsx
/**
 * Shared viewport-fit layout primitive (v3 Phase 2b.1). Renders an optional
 * `header` pinned to the top of the page's scroll container and an optional
 * `stickyAction` pinned to the bottom, with `children` scrolling normally
 * between them. Built on `position: sticky` within the existing page-level
 * scroll (no `overflow: hidden`/fixed-height restructuring of AppShell,
 * `<body>`, or `#root`) so it composes into any existing page without
 * touching the rest of the app's scroll behavior.
 *
 * Neither slot injects `env(safe-area-inset-*)` padding itself — that stays
 * the caller's responsibility on the content it passes in, matching how
 * AppShell.tsx's own mobile nav wrapper already handles its top safe area
 * directly rather than through a shared wrapper. See this plan's own
 * "Design record" (docs/superpowers/plans/2026-08-12-phase-2b1-layout-shell.md)
 * for why.
 *
 * `stickyAction` is unused by Home (2b.1's own proof screen — Home's
 * primary action lives in `header`, not a bottom action) but is the slot
 * 2b.2 will wire Practice/Daily/Rush/Trace/Boss's post-answer "Continue"
 * button into.
 */
import type { ReactNode } from 'react'

export interface PageShellProps {
  /** Pinned to the top of the scroll container. Omit for no pinned header. */
  header?: ReactNode
  /** Pinned to the bottom of the scroll container. Omit for no pinned action. */
  stickyAction?: ReactNode
  /** Scrolls normally between `header` and `stickyAction`. */
  children: ReactNode
  /** Applied to the outermost element — pass layout/sizing classes here. */
  className?: string
}

export function PageShell({ header, stickyAction, children, className }: PageShellProps) {
  return (
    <div className={className}>
      {header !== undefined && (
        <div className="sticky top-0 z-10 pb-3 bg-surface-0 border-b border-border">{header}</div>
      )}
      {children}
      {stickyAction !== undefined && (
        <div className="sticky bottom-0 z-10 pt-3 bg-surface-0 border-t border-border">
          {stickyAction}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/PageShell.test.tsx`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/PageShell.tsx src/app/PageShell.test.tsx
git commit -m "v3 Phase 2b.1: add PageShell layout primitive (sticky header/action slots)"
```

---

## Task 2: `dvh` sweep

**Files:**

- Modify: `src/index.css:206` (`body { min-height: 100vh }`)
- Modify: `src/app/app.css:36` (`.app-shell { min-height: 100vh }`, inside the `@media (min-width: 1024px)` block)
- Modify: `src/app/ErrorBoundary.tsx:40` (inline `style={{ minHeight: '100vh' }}`)

**Interfaces:** None — pure value substitution, no signature changes.

- [ ] **Step 1: Confirm no test pins the literal `100vh` value**

Run: `grep -rn "100vh" src --include="*.test.tsx" --include="*.test.ts"`
Expected: no output (already confirmed during planning — recorded here so the implementer re-verifies against the live tree before editing, in case something changed).

- [ ] **Step 2: Swap `src/index.css`**

In `src/index.css`, change:

```css
body {
  margin: 0;
  min-height: 100vh;
}
```

to:

```css
body {
  margin: 0;
  min-height: 100dvh;
}
```

- [ ] **Step 3: Swap `src/app/app.css`**

In `src/app/app.css`, inside the `@media (min-width: 1024px)` block, change:

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--nav-rail-width) 1fr;
  min-height: 100vh;
}
```

to:

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--nav-rail-width) 1fr;
  min-height: 100dvh;
}
```

- [ ] **Step 4: Swap `src/app/ErrorBoundary.tsx`**

Change the `minHeight: '100vh'` line inside the `style={{ ... }}` object (around line 40) to `minHeight: '100dvh'`.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm vitest run`
Expected: PASS, same test count as before this task (no test asserts the literal `100vh`/`100dvh` string, confirmed in Step 1).

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/app/app.css src/app/ErrorBoundary.tsx
git commit -m "v3 Phase 2b.1: 100vh -> 100dvh (fixes mobile Safari address-bar viewport jump)"
```

---

## Task 3: Apply `PageShell` to `Home.tsx`

**Files:**

- Modify: `src/app/Home.tsx`
- Modify: `src/app/Home.test.tsx` (one new test added, none removed/changed)

**Interfaces:**

- Consumes: `PageShell` from `./PageShell` (Task 1) — `<PageShell header={...} className={...}>{...}</PageShell>`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/Home.test.tsx`, inside the existing `describe('Home', ...)` block (after the last `it(...)`):

```tsx
it('pins the rating/streak header and Practice card in the sticky header region, above the scrollable Modes list', async () => {
  vi.mocked(loadProfile).mockResolvedValue(baseProfile())
  const { container } = render(<Home />)

  const practiceLink = await screen.findByRole('link', { name: /practice/i })
  const stickyHeader = container.querySelector('.sticky.top-0')
  expect(stickyHeader).not.toBeNull()
  expect(stickyHeader?.contains(practiceLink)).toBe(true)
  expect(stickyHeader?.textContent).toContain('1250')

  // "Modes" and the secondary-card grid render outside the sticky region,
  // in the scrollable body.
  const modesLabel = screen.getByText('Modes')
  expect(stickyHeader?.contains(modesLabel)).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/app/Home.test.tsx`
Expected: FAIL — the new test fails because `Home.tsx` doesn't use `PageShell` yet, so `container.querySelector('.sticky.top-0')` is `null`.

- [ ] **Step 3: Restructure `Home.tsx`**

In `src/app/Home.tsx`, add the import (alongside the existing imports):

```tsx
import { PageShell } from './PageShell'
```

Replace the `homeShellClass` declaration and the comment above it — currently:

```tsx
// 2b.0: `.home`'s own rules (max-width var(--content-width-mobile), lg:
// var(--content-width-desktop) — breakpoint matches Tailwind's `lg`
// exactly) moved to utilities, but the bare `home` classname itself stays
// literal — App.test.tsx's boot-mode tests use it (and PracticePage's
// `.practice-page`) as a root-container marker to tell the two pages
// apart, since both can render the same "1200" text on a fresh profile.
// Repeated on both early-return branches, same as the original CSS
// applied regardless of loading state.
const homeShellClass =
  'home app-shell__main flex flex-col gap-3 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[calc(var(--space-4)+env(safe-area-inset-top))] px-4 pb-4'
```

with (note: the loading-state branch below keeps its own top-padding since it renders no `PageShell`/header; the loaded branch's padding moves onto the rating row itself in Step 4 — see this plan's Design record for why):

```tsx
// 2b.0: `.home`'s own rules (max-width var(--content-width-mobile), lg:
// var(--content-width-desktop) — breakpoint matches Tailwind's `lg`
// exactly) moved to utilities, but the bare `home` classname itself stays
// literal — App.test.tsx's boot-mode tests use it (and PracticePage's
// `.practice-page`) as a root-container marker to tell the two pages
// apart, since both can render the same "1200" text on a fresh profile.
//
// 2b.1: the loading branch below has no PageShell/header (nothing to pin
// yet), so it keeps its own top safe-area padding directly. The loaded
// branch passes HOME_SHELL_CLASS to PageShell instead — no top padding of
// its own, since the rating row inside `header` now owns that (see the
// 2b.1 Design record's "known, accepted spacing delta").
const homeShellClass =
  'home app-shell__main flex flex-col gap-3 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[calc(var(--space-4)+env(safe-area-inset-top))] px-4 pb-4'
const HOME_SHELL_CLASS =
  'home app-shell__main flex flex-col gap-3 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto px-4 pb-4'
```

Replace the entire loaded-state `return` block — currently:

```tsx
  return (
    <div className={homeShellClass}>
      <div className="flex items-baseline justify-between flex-wrap gap-3 pt-5 pb-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-text-1 uppercase tracking-[0.04em]">Rating</span>
          <span className="text-4xl font-bold text-text-0 leading-none tabular-nums">
            {Math.round(profile.rating)}
          </span>
        </div>
        <div
          className={`flex items-center gap-1.5 text-md font-bold ${streakActive ? 'text-warn' : 'text-text-2'}`}
        >
          <StreakIcon size={16} />
          <span>{profile.streak.currentStreak}</span>
          <span className="text-text-1 font-semibold">day streak</span>
        </div>
      </div>

      <p className="m-0 text-xs font-bold text-text-2 uppercase tracking-[0.04em]">Modes</p>

      <div className="flex flex-col gap-3">
        <Link href={ROUTES.practice.path} className={CARD_PRIMARY}>
          <span className={ICON_PRIMARY}>
            <PracticeIcon size={24} />
          </span>
          <span className={TITLE_PRIMARY}>Practice</span>
          <span className="text-sm text-inherit opacity-85">Endless rating-matched puzzles</span>
        </Link>

        {/* 2b.0: was `.home__cards-secondary` — grid only kicks in >=640px
         * (Tailwind `sm`, exact match), auto-fit/minmax(75px,1fr) so
         * Daily/Rush/Trace/Boss/Missions (5 same-tier cards) share one row
         * evenly instead of a fixed 2-column split. The 75px floor is tuned
         * to this card's own container: 480px (--content-width-mobile) minus
         * 2x16px (px-4) padding = 448px, minus 4x12px (gap-3) column gaps =
         * 400px for 5 tracks, i.e. 80px/track — 75px leaves ~25px slack for
         * rounding. Re-derive this number if a 6th mode card is ever added;
         * at >=1024px (--content-width-desktop, 608px available) 5 tracks
         * still fit and grow evenly via `1fr` regardless of this floor. */}
        <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(75px,1fr))]">
          <Link href={ROUTES.daily.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <DailyIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Daily #{dayNumber}</span>
            <span className="text-sm text-inherit opacity-85">One puzzle, once a day</span>
            <span className={doneToday ? BADGE_MASTERED : BADGE_NEW}>
              {doneToday ? 'Done today' : 'Not done yet'}
            </span>
          </Link>

          <Link href={ROUTES.rush.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <RushIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Rush</span>
            <span className="text-sm text-inherit opacity-85">
              Escalating puzzles — 3 strikes and you&apos;re out
            </span>
            {profile.rushStats && (
              <span className={BADGE_MASTERED}>Best {profile.rushStats.bestScore}</span>
            )}
          </Link>

          <Link href={ROUTES.trace.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <TraceIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Trace</span>
            <span className="text-sm text-inherit opacity-85">
              Step through code, predict each line
            </span>
          </Link>

          <Link href={ROUTES.boss.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <BossIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Boss</span>
            <span className="text-sm text-inherit opacity-85">
              10 puzzles, escalating — how deep can you get?
            </span>
            {profile.bossStats && (
              <span className={BADGE_MASTERED}>Best depth {profile.bossStats.bestDepth}</span>
            )}
          </Link>

          <Link href={ROUTES.missions.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <MissionIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Missions</span>
            <span className="text-sm text-inherit opacity-85">Three modes, one directed run</span>
            {profile.missionStats && (
              <span className={BADGE_MASTERED}>{profile.missionStats.completions} completed</span>
            )}
          </Link>
        </div>
      </div>
    </div>
  )
}
```

with (2b.1: `header` now carries the rating/streak row + the Practice card — Home's primary action — pinned via `PageShell`; the "Modes" label + secondary-card grid become the scrollable body):

```tsx
  return (
    <PageShell
      className={HOME_SHELL_CLASS}
      header={
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between flex-wrap gap-3 pt-[calc(var(--space-5)+env(safe-area-inset-top))]">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-bold text-text-1 uppercase tracking-[0.04em]">
                Rating
              </span>
              <span className="text-4xl font-bold text-text-0 leading-none tabular-nums">
                {Math.round(profile.rating)}
              </span>
            </div>
            <div
              className={`flex items-center gap-1.5 text-md font-bold ${streakActive ? 'text-warn' : 'text-text-2'}`}
            >
              <StreakIcon size={16} />
              <span>{profile.streak.currentStreak}</span>
              <span className="text-text-1 font-semibold">day streak</span>
            </div>
          </div>

          <Link href={ROUTES.practice.path} className={CARD_PRIMARY}>
            <span className={ICON_PRIMARY}>
              <PracticeIcon size={24} />
            </span>
            <span className={TITLE_PRIMARY}>Practice</span>
            <span className="text-sm text-inherit opacity-85">Endless rating-matched puzzles</span>
          </Link>
        </div>
      }
    >
      <p className="m-0 text-xs font-bold text-text-2 uppercase tracking-[0.04em]">Modes</p>

      {/* 2b.0: was `.home__cards-secondary` — grid only kicks in >=640px
       * (Tailwind `sm`, exact match), auto-fit/minmax(75px,1fr) so
       * Daily/Rush/Trace/Boss/Missions (5 same-tier cards) share one row
       * evenly instead of a fixed 2-column split. The 75px floor is tuned
       * to this card's own container: 480px (--content-width-mobile) minus
       * 2x16px (px-4) padding = 448px, minus 4x12px (gap-3) column gaps =
       * 400px for 5 tracks, i.e. 80px/track — 75px leaves ~25px slack for
       * rounding. Re-derive this number if a 6th mode card is ever added;
       * at >=1024px (--content-width-desktop, 608px available) 5 tracks
       * still fit and grow evenly via `1fr` regardless of this floor. */}
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(75px,1fr))]">
        <Link href={ROUTES.daily.path} className={CARD_SECONDARY}>
          <span className={ICON_SECONDARY}>
            <DailyIcon size={20} />
          </span>
          <span className={TITLE_SECONDARY}>Daily #{dayNumber}</span>
          <span className="text-sm text-inherit opacity-85">One puzzle, once a day</span>
          <span className={doneToday ? BADGE_MASTERED : BADGE_NEW}>
            {doneToday ? 'Done today' : 'Not done yet'}
          </span>
        </Link>

        <Link href={ROUTES.rush.path} className={CARD_SECONDARY}>
          <span className={ICON_SECONDARY}>
            <RushIcon size={20} />
          </span>
          <span className={TITLE_SECONDARY}>Rush</span>
          <span className="text-sm text-inherit opacity-85">
            Escalating puzzles — 3 strikes and you&apos;re out
          </span>
          {profile.rushStats && (
            <span className={BADGE_MASTERED}>Best {profile.rushStats.bestScore}</span>
          )}
        </Link>

        <Link href={ROUTES.trace.path} className={CARD_SECONDARY}>
          <span className={ICON_SECONDARY}>
            <TraceIcon size={20} />
          </span>
          <span className={TITLE_SECONDARY}>Trace</span>
          <span className="text-sm text-inherit opacity-85">
            Step through code, predict each line
          </span>
        </Link>

        <Link href={ROUTES.boss.path} className={CARD_SECONDARY}>
          <span className={ICON_SECONDARY}>
            <BossIcon size={20} />
          </span>
          <span className={TITLE_SECONDARY}>Boss</span>
          <span className="text-sm text-inherit opacity-85">
            10 puzzles, escalating — how deep can you get?
          </span>
          {profile.bossStats && (
            <span className={BADGE_MASTERED}>Best depth {profile.bossStats.bestDepth}</span>
          )}
        </Link>

        <Link href={ROUTES.missions.path} className={CARD_SECONDARY}>
          <span className={ICON_SECONDARY}>
            <MissionIcon size={20} />
          </span>
          <span className={TITLE_SECONDARY}>Missions</span>
          <span className="text-sm text-inherit opacity-85">Three modes, one directed run</span>
          {profile.missionStats && (
            <span className={BADGE_MASTERED}>{profile.missionStats.completions} completed</span>
          )}
        </Link>
      </div>
    </PageShell>
  )
}
```

Also update this file's top-of-file doc comment (the block starting `/** * Home screen...`) — append a paragraph noting the 2b.1 change:

```
 * 2b.1: rating/streak header + the Practice card (primary action) now
 * render inside PageShell's sticky `header` slot, pinned above the
 * scrollable Daily/Rush/Trace/Boss/Missions grid — see PageShell.tsx and
 * docs/superpowers/plans/2026-08-12-phase-2b1-layout-shell.md's Design
 * record for why. The loading-state early return is untouched (no header
 * to pin yet).
 */
```

(Insert it as the last paragraph before the closing `*/` of that doc comment.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/app/Home.test.tsx`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Run the full suite (regression check for `App.test.tsx`'s `.home`/`.home__card-title` assertions)**

Run: `pnpm vitest run`
Expected: PASS, same test count as before this task. Specifically confirm `src/app/App.test.tsx`'s `"boots straight into Home on every visit after the first"` and `"opens Home when the logo is clicked, and can navigate back to Practice from there"` tests still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/app/Home.tsx src/app/Home.test.tsx
git commit -m "v3 Phase 2b.1: apply PageShell to Home (pins rating/streak + Practice card)"
```

---

## Task 4: Close out the DoD

**Files:** None modified — verification only.

- [ ] **Step 1: Verify no hardcoded hex/rgb remains outside the token files**

Run:

```bash
grep -rn "#[0-9a-fA-F]\{3,8\}\b" src --include="*.css" | grep -v "src[\\/]index.css" | grep -v "tokens.css"
grep -rn "rgba\?(" src --include="*.css" | grep -v "src[\\/]index.css" | grep -v "tokens.css"
```

Expected: both commands return no output. (This is 2b.1's first DoD checkbox — "Token file is the single source of truth — grep confirms no hardcoded hex/rgb color values remain in component CSS.")

- [ ] **Step 2: Run `pnpm validate`**

Run: `pnpm validate`
Expected: PASS (typecheck + lint + test + validate:content + build all green).

- [ ] **Step 3: Manual/visual check — no scroll needed to reach the primary action**

Run `pnpm dev`, open `/` (Home) at a standard mobile viewport (375×667, the iPhone SE floor — the tightest common real-device height) and at desktop width. Confirm the rating/streak row and the Practice card are both visible without scrolling, and that scrolling the Daily/Rush/Trace/Boss/Missions grid leaves the header pinned in place. This is 2b.1's second DoD checkbox and is inherently a real-viewport check (jsdom doesn't compute layout/sticky), not something the test suite can assert — record the result (pass/fail + any adjustment made) as a note on this task when checked off.

- [ ] **Step 4: Update `docs/v3-build-plan.md`**

Check off 2b.1's two DoD boxes (lines ~213–214) once Steps 1–3 above are confirmed:

```markdown
- [x] Token file is the single source of truth — grep confirms no hardcoded hex/rgb color values remain in component CSS.
- [x] Shell primitive in use on ≥1 real screen, no scroll needed to reach the primary action on a standard mobile viewport.
```

- [ ] **Step 5: Commit**

```bash
git add docs/v3-build-plan.md
git commit -m "v3 Phase 2b.1: close out DoD"
```

---

## Branch

Base off `origin/main` (2b.0/PR #58 is merged there) — not the current `ui-redesign-2b0-tailwind` branch, which is already merged and stale. Suggested branch name: `ui-redesign-2b1-shell`.
