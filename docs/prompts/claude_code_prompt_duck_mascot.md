# Prompt for Claude Code — roll out the duck mascot

Paste everything below into Claude Code in the `codoro` repo.

---

## Context

We picked a mascot direction: a geometric, faceted rubber duck (angular octagon construction, matching Space Grotesk's own letterforms), colored as an actual rubber duck — yellow body, amber beak — rather than the app's lime accent, specifically to avoid reading as a green bird mascot next to Duolingo's owl. Lime stays in the mark only as a small accent (the eye highlight), which is the one deliberate tie back to brand.

Do this in one pass:

1. Add a shared `DuckMark` / `DuckMascot` component.
2. Add the missing `--mascot-yellow` token to `src/index.css`.
3. Swap the "C" logomark for `DuckMark` in both places it renders.
4. Put `DuckMascot` in the places listed under "Where the full mascot goes" below — read the reasoning there before wiring it into the compact icon spots, two of those are a bad fit and I'm recommending against it.
5. Regenerate the favicon/PWA/OG assets through the repo's existing generator scripts — don't hand-edit any PNGs.
6. Update tests, run `pnpm validate`, fix whatever it flags.

---

## 1. New component: `src/app/Mascot.tsx`

Filled geometric shapes, not stroke icons — this deliberately does **not** extend `Icons.tsx`'s `currentColor` stroke-icon convention (see that file's doc comment for why that convention exists; it doesn't fit a multi-color character mark). Colors are the approved mascot palette, referenced as CSS vars so a future theme picker doesn't leave this hardcoded.

```tsx
/**
 * The Codoro duck mascot — rubber-duck debugging, illustrated. Two
 * exports: `DuckMark` (head only, legible down to favicon scale) for
 * brand-mark contexts, and `DuckMascot` (full body, three poses) for
 * actual expressive moments. See this file's own README/PR for the
 * design rationale (geometric construction, yellow-not-lime body to
 * avoid a Duolingo-owl read).
 *
 * Palette: body var(--mascot-yellow), beak/feet var(--warn), eye
 * var(--surface-0), eye highlight var(--accent) — the one deliberate tie
 * back to brand lime, kept small.
 */
export interface DuckMarkProps {
  size?: number
}

export function DuckMark({ size = 28 }: DuckMarkProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 140 140">
      <polygon
        points="112,92 87,117 53,117 28,92 28,58 53,33 87,33 112,58"
        fill="var(--mascot-yellow)"
      />
      <polygon points="100,60 138,72 100,86" fill="var(--warn)" />
      <circle cx="78" cy="58" r="8" fill="var(--surface-0)" />
      <circle cx="81" cy="55" r="3" fill="var(--accent)" />
    </svg>
  )
}

export type DuckPose = 'idle' | 'happy' | 'debugging'

export interface DuckMascotProps {
  pose?: DuckPose
  size?: number
}

export function DuckMascot({ pose = 'idle', size = 96 }: DuckMascotProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 200 200">
      <ellipse cx="100" cy="196" rx="50" ry="7" fill="#000000" opacity="0.25" />
      <polygon
        points="160,150 125,185 75,185 40,150 40,100 75,65 125,65 160,100"
        fill="var(--mascot-yellow)"
      />
      <polygon points="65,183 80,183 72,198" fill="var(--warn)" />
      <polygon points="105,183 120,183 112,198" fill="var(--warn)" />
      <polygon
        points="72,105 98,100 92,148 76,142"
        fill="none"
        stroke="var(--surface-0)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <polygon
        points="135,83 115,103 85,103 65,83 65,53 85,33 115,33 135,53"
        fill="var(--mascot-yellow)"
      />
      <polygon points="128,76 170,86 128,100" fill="var(--warn)" />
      {pose === 'idle' && (
        <>
          <circle cx="103" cy="70" r="7" fill="var(--surface-0)" />
          <circle cx="106" cy="67" r="2.5" fill="var(--accent)" />
        </>
      )}
      {pose === 'happy' && (
        <>
          <path
            d="M91,68 Q103,56 115,68"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <rect
            x="30"
            y="26"
            width="9"
            height="9"
            fill="var(--accent)"
            transform="rotate(45 34.5 30.5)"
          />
          <rect
            x="150"
            y="18"
            width="7"
            height="7"
            fill="var(--accent)"
            transform="rotate(45 153.5 21.5)"
          />
          <rect
            x="152"
            y="42"
            width="6"
            height="6"
            fill="var(--accent)"
            transform="rotate(45 155 45)"
          />
        </>
      )}
      {pose === 'debugging' && (
        <>
          <path
            d="M91,57 L112,61"
            stroke="var(--surface-0)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="103" cy="70" r="7" fill="var(--surface-0)" />
          <circle cx="106" cy="67" r="2.5" fill="var(--accent)" />
          <circle cx="162" cy="45" r="17" fill="none" stroke="var(--text-1)" strokeWidth="5" />
          <line
            x1="174"
            y1="57"
            x2="188"
            y2="71"
            stroke="var(--text-1)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <ellipse cx="162" cy="45" rx="7" ry="5" fill="var(--danger)" />
          <line x1="155" y1="42" x2="149" y2="38" stroke="var(--danger)" strokeWidth="2" />
          <line x1="155" y1="48" x2="149" y2="52" stroke="var(--danger)" strokeWidth="2" />
          <line x1="169" y1="42" x2="175" y2="38" stroke="var(--danger)" strokeWidth="2" />
          <line x1="169" y1="48" x2="175" y2="52" stroke="var(--danger)" strokeWidth="2" />
          <line x1="160" y1="40" x2="157" y2="34" stroke="var(--danger)" strokeWidth="1.5" />
          <line x1="164" y1="40" x2="167" y2="34" stroke="var(--danger)" strokeWidth="1.5" />
        </>
      )}
    </svg>
  )
}
```

Add a `Mascot.test.tsx` alongside it (repo convention — every component here has a sibling test file) covering: `DuckMark` renders at a given `size`; `DuckMascot` renders each of the three `pose` values without throwing.

---

## 2. Token: `src/index.css`

Add one token — `#ffd23f` isn't in the palette yet, and this file's own comments are explicit that token values live in exactly one place. Insert it right after the `--warn-dim` line, inside the existing `:root, [data-theme='dark']` block:

```css
--ok-dim: #1b2a0a;
--danger: #ff5470;
--danger-dim: #31121b;
--warn: #ffb020;
--warn-dim: #2e2408;
--mascot-yellow: #ffd23f;
```

Don't add a `--color-mascot-yellow` alias in the `@theme inline` block above unless you end up needing a Tailwind utility class for it — right now it's only ever consumed as `var(--mascot-yellow)` inside `Mascot.tsx`'s literal SVG fills, not as a Tailwind class.

---

## 3. Replace the "C" — top-left, both places

The current mark is duplicated verbatim in two files (desktop rail + mobile top bar). Both need to change together or they'll drift.

**`src/app/NavRail.tsx`** (~line 128, inside the brand `<Link>`):

```tsx
// before
<div
  className="flex items-center justify-center w-7 h-7 flex-none rounded-sm bg-accent text-accent-ink font-mono font-bold text-md"
  aria-hidden="true"
>
  C
</div>

// after
<DuckMark size={28} />
```

**`src/app/AppShell.tsx`** (~line 141, the mobile top bar's brand `<Link>`) — identical swap.

Add `import { DuckMark } from './Mascot'` to both files. Drop the `w-7 h-7 rounded-sm bg-accent` tile — that container existed to give the flat single-color "C" glyph a branded background to sit on; `DuckMark` is already chromatic (yellow/amber/dark), so a lime square behind it competes with it rather than framing it. `DuckMark`'s own `size={28}` matches the tile's old footprint, so layout/spacing around it (the `gap-2.5`, the "Codoro" wordmark next to it) shouldn't need to change.

Update `NavRail.test.tsx` / `AppShell.test.tsx` if either asserts on the literal `"C"` text content anywhere (I didn't find one when I checked, but confirm) — they do assert `getByText('Codoro')` for the wordmark, which is unaffected.

---

## 4. Where the full mascot goes — and where it deliberately doesn't

You asked for the duck on: streak, correct/wrong feedback, empty states, loading screens, and the top-left mark. Top-left is above. For the rest, read this before wiring it in — two of these spots are genuinely a bad fit for `DuckMascot` at the size it'd have to render, and I'd rather flag that than ship something that reads as noise or, worse, illegible.

**Streak — `src/app/StreakPause.tsx`, not the `StatusBar` pill.**
`StatusBar.tsx`'s streak indicator is a 14px flame icon inside a compact pill — `DuckMascot` was built and tested at 96px+; shrunk to 14px the facets and details (magnifying glass, feet, sparkles) turn into a smear, and it'll look worse than the flame it replaced. Leave that pill's flame icon alone. `StreakPause.tsx` is the actual streak-milestone moment — a centered dialog ("N in a row" / "New best streak") with real room. Add `<DuckMascot pose="happy" size={96} />` above the `{streak} in a row` text there. That's the genuine "streak → duck" moment; the pill icon was never going to be it.

**Correct/wrong feedback — recommend keeping the checkmark/✕ in `PuzzleCardShell.tsx`'s `FeedbackIcon`, same reasoning.**
That icon renders at 20px inline, read at a glance mid-session, over and over, fast. A checkmark/✕ is instant and unambiguous at that size and that repetition; a small duck silhouette is neither, especially for "wrong" where a subtle expression change is easy to miss and a misread costs the player the rating-delta context. My default: leave `FeedbackIcon` as-is. If you still want the duck here after seeing it in the other spots, the right move is a _purpose-built_ small glyph (e.g. `DuckMark` with a tiny check or slash badge), not `DuckMascot` shrunk down — that's follow-up design work, not a straight swap, so don't improvise it inline; ask first.

**Empty states — `src/app/stats/StatsPage.tsx`'s `emptyBanner`.**
This is the real empty state (zero attempts yet) — add `<DuckMascot pose="idle" size={56} />` into the existing banner (~line 148), to the left of the "You haven't solved any puzzles yet" copy, inside the `flex items-center justify-between` row. `PracticePage.tsx`'s "No puzzles available yet" text (~line 491) is a _filter_-empty state (an active filter combination matched nothing), not a new-user empty state — lower value for a mascot moment and easy to skip.

**Loading screens — leave `RouteSkeleton.tsx` alone.**
Read its doc comment before touching it: this app is local-first (IndexedDB reads resolve in single-digit ms), so the only genuine loading boundary is the lazy route-chunk `Suspense` fallback — every other "loading" state in this app is instant and was deliberately _not_ given a skeleton, because a fake loading state makes the app feel slower, not faster. That reasoning applies just as much to a mascot animation as to a skeleton shimmer. Don't add `DuckMascot` here without new evidence of an actual perceived delay — this was already litigated once (see the file's own comment and `docs/v2-build-plan.md`'s Phase 7 amendment).

**Optional, not in the original ask — flag it, don't just do it:** `src/app/missions/MissionComplete.tsx` is another real celebratory moment (mission win) that's a natural fit for `pose="happy"` at a decent size. Mention it to me before adding it; don't fold it in silently.

---

## 5. Favicon / PWA icons / OG image

Don't touch any `.png` by hand — this repo already has scripted generators that rasterize a single source SVG:

- `public/favicon.svg` is the one source of truth.
- `src/app/pwa/generatePwaIcons.ts` reads it → writes `pwa-192.png`, `pwa-512.png`, `pwa-maskable-192.png`, `pwa-maskable-512.png`.
- `src/app/og/generateOgImage.ts` reads it → writes `og-image.png`.
- Both scripts hardcode `const BRAND_PURPLE = '#863bff'` as the maskable/OG canvas background — that's stale (left over from before the dark/lime redesign, unrelated to this mascot work, but you're already in these files). Change it to `'#0e0f13'` (the app's actual `--surface-0`) in **both** files — that's the real dark background the duck will sit on everywhere else, and it'll contrast far better with the yellow mark than purple did.

Steps:

1. Replace `public/favicon.svg`'s contents with the `DuckMark` shape as flat SVG (transparent background, same three-color palette, no `currentColor`/CSS vars — this file is rasterized standalone by `sharp`, outside any app CSS context, so use literal hex: `#ffd23f` body, `#ffb020` beak, `#0e0f13` eye, `#c6f83c` highlight). Keep it simple — flat polygons/circles, no filters or clip masks.
2. Update `BRAND_PURPLE` to `'#0e0f13'` in both `generatePwaIcons.ts` and `generateOgImage.ts`.
3. Run `pnpm generate:pwa-icons && pnpm generate:og-image`.
4. Look at the output PNGs before committing. `rasterizeLogo()`'s seam-crop workaround in both scripts exists specifically because the _old_ purple-bolt SVG's clip-mask left a rasterization seam — the new flat-shape SVG likely has no mask edge to seam in the first place, so that crop may now be trimming a clean image for no reason. If the regenerated icons look shaved/off-center, that's why — remove or adjust the crop, don't just leave it because it's already there.
5. Update `index.html`'s `theme-color` meta (currently `#863bff`, same stale purple) to `#0e0f13`.

---

## 6. Before you're done

- Update the six sibling test files for anything you touch: `NavRail.test.tsx`, `AppShell.test.tsx`, `StreakPause.test.tsx`, `PuzzleCardShell.test.tsx` (only if you end up changing it — default above is "don't"), `StatusBar.test.tsx` (should be untouched — confirm), `StatsPage.test.tsx`.
- Run `pnpm validate` (typecheck + lint + test + content validation + build) and fix whatever it flags.
- Check the mobile top bar and desktop nav rail side by side after the swap — `DuckMark` at `size={28}` should sit at the same visual weight the old tile did; adjust only if it visibly doesn't.
