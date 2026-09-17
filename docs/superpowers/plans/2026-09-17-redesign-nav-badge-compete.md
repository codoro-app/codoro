# SecondaryNav / StatBadge / Compete Layout-Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three reusable components (SecondaryNav, StatBadge, and a Compete-only layout-shell centering fix) matching the approved mockups in `docs/redesign/mockups/`, and apply them to Home, Practice, and Compete at both breakpoints.

**Architecture:** SecondaryNav wraps the existing BottomNav + NavRail into one mount point and removes AppShell's separate footer text-link row (Settings/Legal/Feedback fold behind the gear — Settings gains a Legal link since it didn't have one). StatBadge is a single pill primitive that StatusBar composes four ways (rating/streak/solved/sound); the combo badge is untouched (not one of the four listed variants, different visual treatment, no mockup coverage). CompetePage gets a centered menu header (icon + "Compete"), icon-badged door cards that lay out side-by-side at `lg:`, and a container that fills+centers within `.app-shell__content`'s existing grid/flex row without touching `app.css`.

**Tech Stack:** React + TypeScript, Tailwind v4 utilities (CSS-first tokens in `src/index.css`), Vitest + Testing Library.

**Spec:** `docs/redesign/mockups/{Home,Practice,Compete}{,-Desktop}.png` (approved targets) plus the task brief in this conversation.

## Global Constraints

- No new colors/spacing/radius values — every className must resolve to an existing token in `src/index.css` (`--space-*`, `--radius-*`, `--color-*` aliases) or an already-used Tailwind default (e.g. `w-10`/`h-10`, already used by `Home.tsx`'s `ICON_SECONDARY`).
- Icon set unchanged in spirit: only additive icons in the existing `Icons.tsx` Lucide-derived stroke style (`MonitorIcon`, `PeopleIcon`) — no new icon family, no `DuckMascot` placement, no `ProgressIndicator` use.
- No framer-motion/animation changes. No changes to Daily/Rush/Boss/Trace/Missions/Browse/Stats/Settings page _content_ beyond the one Settings addition below (needed so Legal stays reachable once the footer is removed).
- Do not modify `app.css`'s `.app-shell`/`.app-shell__content` shared grid rules — the Compete centering fix lives entirely in `CompetePage.tsx`'s own className string.
- `Play Human`'s existing click wiring (`setDoor({kind:'human-level'})` → `LevelPicker` → `useCompeteSession` → `ChallengeButton`) is a real, working flow already — do not change any handler, only the surrounding markup/classes.
- Run `pnpm lint` and `pnpm test` before committing; single commit at the end.

---

### Task 1: StatBadge primitive

**Files:**

- Create: `src/app/StatBadge.tsx`
- Modify: `src/app/practice/StatusBar.tsx`

**Interfaces:**

- Produces: `StatBadge({ icon: ReactNode, children?: ReactNode, title?: string, compact?: boolean, as?: 'button', ariaLabel?: string, ariaPressed?: boolean, onClick?: () => void })` — a `rounded-full bg-surface-1 border border-border` pill, `min-h-11`, `py-1.5 px-3` (or `px-2.5` when `compact`), rendered as a `<div>` normally or a `<button type="button">` when `as === 'button'`.

- [ ] **Step 1: Create `StatBadge.tsx`**

```tsx
/**
 * Shared status-pill shape (rating/streak/solved-count/sound) — StatusBar.tsx
 * used to render each as its own one-off markup (a rounded-full pill for
 * rating/streak, bare icon+text for solved, a differently-padded pill for
 * sound); this is the one shape all four now share. The combo badge stays
 * bespoke (bg-ok-dim, shield pips) — it isn't one of the four variants the
 * redesign mockups (docs/redesign/mockups/Practice*.png) actually show.
 */
import type { ReactNode } from 'react'

export interface StatBadgeProps {
  icon: ReactNode
  children?: ReactNode
  title?: string
  /** Tighter horizontal padding for icon-only badges (the sound toggle). */
  compact?: boolean
  as?: 'button'
  ariaLabel?: string
  ariaPressed?: boolean
  onClick?: () => void
}

const BASE =
  'flex items-center gap-1.5 min-h-11 rounded-full bg-surface-1 border border-border text-text-0 font-bold tabular-nums'
const PADDING = 'py-1.5 px-3'
const PADDING_COMPACT = 'py-1.5 px-2.5'

export function StatBadge({
  icon,
  children,
  title,
  compact,
  as,
  ariaLabel,
  ariaPressed,
  onClick,
}: StatBadgeProps) {
  const className = `${BASE} ${compact ? PADDING_COMPACT : PADDING}`
  if (as === 'button') {
    return (
      <button
        type="button"
        className={className}
        title={title}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        onClick={onClick}
      >
        {icon}
        {children}
      </button>
    )
  }
  return (
    <div className={className} title={title}>
      {icon}
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Compose StatusBar's rating/streak/solved/sound badges from StatBadge**

In `StatusBar.tsx`, import `StatBadge` and replace the four corresponding blocks:

- Rating: `<StatBadge title="Rating" icon={<svg .../>}>{Math.round(tweenedRating)}</StatBadge>` (keep the existing inline rating SVG exactly — same `stroke="var(--accent)"` markup, just moved inside `icon`).
- Streak: `<StatBadge title="Daily streak" icon={<svg .../>}>{streak}</StatBadge>` (keep the existing conditional-stroke SVG as-is).
- Solved: `<StatBadge title="Solved this session" icon={<svg .../>}>{solvedThisSession} solved this session</StatBadge>` (keep the existing checkmark SVG).
- Sound: `<StatBadge as="button" compact icon={soundEnabled ? <SpeakerIcon /> : <SpeakerMutedIcon />} ariaLabel={soundEnabled ? 'Mute sound' : 'Unmute sound'} ariaPressed={!soundEnabled} onClick={onToggleSound} />`.
- Leave the combo badge (`status-bar__combo` div + shield pips) exactly as it is — do not route it through StatBadge.
- Remove the now-unused local `pillClass` constant once nothing references it.

- [ ] **Step 3: Run StatusBar's existing tests**

Run: `pnpm vitest run src/app/practice/StatusBar.test.tsx`
Expected: PASS, unchanged (assertions are text/role/testid/aria based, not class-based).

---

### Task 2: SecondaryNav wrapper + AppShell footer removal

**Files:**

- Create: `src/app/SecondaryNav.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `src/app/FeedbackLink.tsx`
- Modify: `src/telemetry/events.ts`
- Modify: `src/app/settings/SettingsPage.tsx`
- Modify: `src/app/settings/SettingsPage.test.tsx`

**Interfaces:**

- Produces: `SecondaryNav()` — renders `<div className="hidden lg:block app-shell__nav"><NavRail /></div>` then `<BottomNav />`, i.e. the exact same DOM AppShell already produces for its nav today, just from one component.

- [ ] **Step 1: Create `SecondaryNav.tsx`**

```tsx
/**
 * Single shared secondary-navigation mount point. BottomNav (mobile icon
 * bar) and NavRail (desktop rail) stay separate components — see each of
 * their own doc comments for why one component rendering both shapes via
 * className soup was rejected — but every route only ever needs to mount
 * ONE thing for "app navigation", not manage both plus a duplicate footer
 * link row itself. AppShell renders this once; later routes reuse it the
 * same way instead of re-wiring BottomNav+NavRail by hand.
 */
import { BottomNav } from './BottomNav'
import { NavRail } from './NavRail'

export function SecondaryNav() {
  return (
    <>
      <div className="hidden lg:block app-shell__nav">
        <NavRail />
      </div>
      <BottomNav />
    </>
  )
}
```

- [ ] **Step 2: Wire SecondaryNav into AppShell, remove the footer**

In `AppShell.tsx`:

- Replace the import of `NavRail`/`BottomNav` with `import { SecondaryNav } from './SecondaryNav'`.
- Remove the `FeedbackLink` import (no longer used here).
- Replace:
  ```tsx
  <div className="hidden lg:block app-shell__nav">
    <NavRail />
  </div>
  <BottomNav />
  ```
  with:
  ```tsx
  <SecondaryNav />
  ```
- Delete the entire `<footer className="app-shell__footer ...">...</footer>` block (Settings/Legal/Feedback links).
- Leave `PAGES_WITH_OWN_H1` (still references `ROUTES.legal.path`/`ROUTES.settings.path` for the sr-only-h1 skip logic — unrelated to the footer) and the mobile top-bar gear untouched.

- [ ] **Step 3: Fold Legal behind Settings (it had no other entry point)**

`grep -rn "ROUTES.legal" src` before this change shows only `AppShell.tsx` (the footer link, now deleted) — Settings never linked to Legal. Add a small section to `SettingsPage.tsx` so Legal stays reachable via the gear icon → Settings → Legal chain:

- Add imports: `import { Link } from 'wouter'` and `import { ROUTES } from '../routes'`.
- Add a new `<section>` right after the existing `Feedback` section, matching that section's exact style:
  ```tsx
  <section>
    <h2 className={SECTION_HEADING_CLASS}>Legal</h2>
    <p className={SECTION_COPY_CLASS}>
      Terms of service and privacy policy:{' '}
      <Link href={ROUTES.legal.path} className={LINK_CLASS}>
        Legal
      </Link>
    </p>
  </section>
  ```
- Update this file's own top doc comment: it currently says "on top of the original footer link (still there, next to Legal)" — replace with a short note that the footer is gone and this section is now the only in-app path to `/legal` besides typing the URL.

- [ ] **Step 4: Drop the unused `'footer'` FeedbackLink surface**

  - `src/app/FeedbackLink.tsx`: narrow `surface: 'footer' | 'settings' | 'daily_nudge' | 'home_nudge'` to `surface: 'settings' | 'daily_nudge' | 'home_nudge'`.
  - `src/telemetry/events.ts:458`: same narrowing on the matching event-payload type.

- [ ] **Step 5: Update `AppShell.test.tsx`** for the new nav/no-footer shape

  - Delete: `'the footer link goes to /legal'`, `'the footer has a Feedback link, after Settings and Legal, to the external Tally form'`, `'clicking the footer Feedback link fires feedback_link_clicked with surface: "footer"'`.
  - Update `'the mobile top bar has a Settings gear link, in addition to NavRail and the footer link'` → rename to `'the mobile top bar has a Settings gear link, in addition to NavRail'`, change `expect(settingsLinks.length).toBe(3)` to `.toBe(2)`.

- [ ] **Step 6: Add a SettingsPage test for the new Legal section**

In `SettingsPage.test.tsx`, check its existing render helper/setup at the top of the file first, then add (matching that helper):

```tsx
it('links to Legal, now that AppShell no longer has a footer link', () => {
  // use whatever render helper the rest of this file already uses
  expect(screen.getByRole('link', { name: 'Legal' })).toHaveAttribute('href', '/legal')
})
```

- [ ] **Step 7: Run the affected test files**

Run: `pnpm vitest run src/app/AppShell.test.tsx src/app/settings/SettingsPage.test.tsx src/app/BottomNav.test.tsx src/app/NavRail.test.tsx`
Expected: PASS.

---

### Task 3: Compete icons (Monitor, People)

**Files:**

- Modify: `src/app/Icons.tsx`

- [ ] **Step 1: Add `MonitorIcon` and `PeopleIcon`**, appended after `CompeteIcon`, matching the file's existing style exactly (same `aria-hidden`, `viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth="2"`, round caps/joins):

```tsx
// Authored for Compete's "Play Computer" door card badge (Lucide `monitor`)
// — a synthetic-opponent glyph distinct from CompeteIcon's crossed-swords
// "duel" mark used for the mode itself.
export function MonitorIcon({ size = 20 }: IconProps) {
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
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

// Authored for Compete's "Play Human" door card badge (Lucide `users`).
export function PeopleIcon({ size = 20 }: IconProps) {
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
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
```

---

### Task 4: CompetePage — icon-badged door cards, centered menu header, side-by-side desktop, layout-shell centering

**Files:**

- Modify: `src/app/compete/CompetePage.tsx`

- [ ] **Step 1: Update imports and constants**

Add `MonitorIcon, PeopleIcon` to the existing `import { CloseIcon } from '../Icons'` line (→ `import { CloseIcon, CompeteIcon, MonitorIcon, PeopleIcon } from '../Icons'`).

Replace `PAGE_SHELL_CLASS` and `DOOR_CARD_CLASS`, and add `ICON_BADGE_CLASS`:

```tsx
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col justify-center gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto min-h-full lg:min-h-0 lg:self-stretch pt-[var(--space-4)] px-4 pb-4'

const DOOR_CARD_CLASS =
  'flex flex-col items-start gap-2 min-h-11 w-full lg:flex-1 p-5 rounded-md border border-border bg-surface-1 text-left text-text-0 cursor-pointer lg:transition-[transform,border-color] lg:duration-150 lg:hover:-translate-y-0.5 lg:hover:border-border-strong active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const ICON_BADGE_CLASS =
  'flex items-center justify-center flex-none w-10 h-10 rounded-md bg-accent-dim text-accent'
```

(`border-accent` → `border-border`: the mockups show a plain neutral border on both door cards, not the lime accent border currently hardcoded. `justify-center`/`min-h-full`/`lg:min-h-0 lg:self-stretch`: the centering fix — mobile relies on `<main class="app-shell__content">` already being flex-grown to fill the viewport (see `app.css`'s `flex: 1 0 auto` on that class, untouched), so `min-h-full` on this div resolves against that; desktop relies on `.app-shell__content`'s existing grid row already sizing to the available height, so `lg:self-stretch` fills it instead of the grid's default `align-items: start` behavior.)

- [ ] **Step 2: Restructure the `'menu'` branch — centered icon+title header, icon-badged cards, side-by-side on desktop**

Change:

```tsx
const showHeading =
  door.kind === 'menu' || door.kind === 'computer-level' || door.kind === 'human-level'
```

to:

```tsx
const showHeading = door.kind === 'computer-level' || door.kind === 'human-level'
```

Replace the `{showHeading && <p ...>Compete</p>}` + `door.kind === 'menu'` block with:

```tsx
{
  showHeading && <p className="m-0 text-xl font-bold text-text-0">Compete</p>
}
{
  door.kind === 'menu' && (
    <div className="flex flex-col items-center gap-6 w-full">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-accent">
          <CompeteIcon size={32} />
        </span>
        <p className="m-0 text-2xl font-bold text-text-0">Compete</p>
      </div>
      <div className="flex flex-col gap-3 w-full lg:flex-row lg:gap-4">
        <button
          type="button"
          className={DOOR_CARD_CLASS}
          onClick={() => {
            setDoor({ kind: 'computer-level' })
          }}
        >
          <span className={ICON_BADGE_CLASS}>
            <MonitorIcon size={20} />
          </span>
          <span className="text-lg font-bold">Play Computer</span>
          <span className="text-sm text-text-2">Race a synthetic opponent right now</span>
        </button>
        <button
          type="button"
          className={DOOR_CARD_CLASS}
          onClick={() => {
            setDoor({ kind: 'human-level' })
          }}
        >
          <span className={ICON_BADGE_CLASS}>
            <PeopleIcon size={20} />
          </span>
          <span className="text-lg font-bold">Play Human</span>
          <span className="text-sm text-text-2">
            Solve 5 puzzles, then send the link to a friend
          </span>
        </button>
      </div>
    </div>
  )
}
```

(`onClick` handlers are copied verbatim from the current code — `Play Human` still goes through `human-level` → `LevelPicker` → `useCompeteSession` → `ChallengeButton`, unchanged, confirming it's the real wired flow, not a stub.)

- [ ] **Step 3: Run CompetePage/LevelPicker tests**

Run: `pnpm vitest run src/app/compete/CompetePage.test.tsx src/app/compete/LevelPicker.test.tsx`
Expected: PASS unchanged (assertions use `getByRole('button', { name: /play computer/i })` etc. — accessible names are unaffected by the added icon spans, which are `aria-hidden`).

---

### Task 5: Manual verification pass (dev server + browser)

- [ ] **Step 1: Start the dev server** — `pnpm dev` (background).

- [ ] **Step 2: Screenshot Home/Practice/Compete at 390×844 (mobile) and 1440×900 (desktop)**, compare against `docs/redesign/mockups/*.png`:
  - Home: unchanged visually except the mobile bottom bar/desktop rail no longer have a footer link row beneath them.
  - Practice: rating/streak/solved/sound badges now share one pill shape.
  - Compete: centered icon+"Compete" header, icon-badged cards, side-by-side at desktop width, content vertically centered (no big empty band below the cards).
  - Confirm Settings page shows the new Legal link and still has Feedback.
  - Click "Play Human" on Compete to confirm the click still leads into the existing LevelPicker → puzzle flow (behavior unchanged, container only).

- [ ] **Step 3: Fix any visual deltas found**, re-screenshot, then stop the dev server.

---

### Task 6: Full verification + single commit

- [ ] **Step 1: Run the full test suite** — `pnpm test`, expect 0 failures.
- [ ] **Step 2: Run lint and typecheck** — `pnpm lint && pnpm typecheck`, expect 0 errors.
- [ ] **Step 3: Stage and commit as one commit** covering every file touched above plus `docs/redesign/`.

## Self-Review Notes

- Spec coverage: SecondaryNav (Task 2), StatBadge (Task 1), Compete layout-shell + side-by-side desktop cards (Task 4), applied to Home (Task 2's shell change is global), Practice (Task 1), Compete (Tasks 3-4). Icon-set/DuckMascot/ProgressIndicator/animation/other-routes explicitly left untouched. Play Human wiring confirmed unchanged (Task 4 note).
- Placeholder scan: no TBDs; every step has real code.
- Type consistency: `StatBadge` props used identically in Step 2 of Task 1; `SecondaryNav` has no props; `MonitorIcon`/`PeopleIcon` follow `IconProps` already defined in `Icons.tsx`.
