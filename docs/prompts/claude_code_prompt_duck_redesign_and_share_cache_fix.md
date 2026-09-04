# Prompt for Claude Code — duck redesign (rounder shape, shorter beak, fix "sad" reading angry) + fix the stale favicon/share-image cache

Paste everything below into Claude Code in the `codoro` repo.

---

## Context

Two separate things, both touching the same mascot assets, worth doing in one pass.

**1. The duck redesign.** The current `DuckMark`/`DuckMascot` (`src/app/Mascot.tsx`) are built from hexagonal/octagon polygons — geometrically clean but they don't read clearly as a duck, especially at small sizes. Replacing the construction with cubic-bezier curves: a rounded body+head silhouette instead of two abutting hexagons, a shorter/chunkier bill instead of a long thin one, and a proper "worried" brow on the sad pose instead of the angry one it currently has (see the bug explanation below — this isn't a style nitpick, the current sad pose is anatomically wrong).

**2. The share-link/favicon cache bug.** `public/_headers` marks `/favicon.svg` and `/og-image.png` `Cache-Control: public, max-age=31536000, immutable` — a full year, and neither filename is content-hashed, so the URL never changes when the file's content does. That header is fine for **SW-controlled visits** (workbox precaching revisions these by content hash, per that file's own comment) but favicons fetched by the browser chrome and OG images fetched by link-unfurl crawlers (Facebook, Twitter/X, Discord, iMessage, Slack) are **not** SW-controlled requests — they're direct HTTP fetches that never go through the app's service worker. Once any of those fetched the pre-duck asset (this project's Vite scaffold shipped with Vite's own bolt-shaped default favicon before Phase 6 replaced it — see `git log --oneline -- public/favicon.svg`), that `immutable` header tells every cache in the path (the crawler's own cache, Cloudflare's edge cache, the visitor's browser) to keep serving that exact response for up to a year without ever re-checking, even now that the file on disk is a duck. That's the literal mechanism behind "the bolt still comes up when I generate a share link."

---

## 0. Reference assets — already in the repo

`public/mascot/duck-{idle,happy,sad,debugging,celebrating,mark}.svg` are already committed — standalone, openable SVG files of the exact same redesign, colors baked as literal hex (the app's default dark-theme values) rather than `var(...)`. They exist so the design has a form independent of the React app: drop one into Figma, use it in the README, hand it to someone, post it somewhere — none of that works with a JSX component.

They are **not** a replacement for `Mascot.tsx` below, on purpose. The in-app component fills with `var(--mascot-yellow)`, `var(--surface-0)`, `var(--accent)`, etc. — two of those (the eye and its highlight) actually shift per theme (compare `--surface-0`/`--accent` across the four `[data-app-theme]` blocks in `src/index.css`). A static `<img src="/mascot/duck-happy.svg">` can't react to that; it'd bake in one theme's colors and look wrong in the other three. So: static files for anything outside the app, the CSS-var component for anything rendered inside it. Same path data either way — the JSX below is transcribed from these files, so if you ever touch one, update the other.

---

## 1. Redesigned `src/app/Mascot.tsx`

Same two exports, same CSS-var palette convention, new geometry. Five poses now (`sad` already existed; `celebrating` is new — see part 4 for where it might go, don't wire it anywhere without asking).

```tsx
/**
 * The Codoro duck mascot — rubber-duck debugging, illustrated. Two
 * exports: `DuckMark` (head only, legible down to favicon scale) for
 * brand-mark contexts, and `DuckMascot` (full body, five poses) for
 * actual expressive moments. Deliberately does NOT extend Icons.tsx's
 * `currentColor` stroke-icon convention (see that file's doc comment
 * for why that convention exists) — this is a multi-color filled
 * character mark, not a single-color stroke glyph.
 *
 * v2 redesign (2026-09): replaced the original hexagonal/low-poly
 * construction with a rounded rubber-duck silhouette (cubic-bezier body
 * + circular head) — reads more clearly as an actual duck at every size
 * this renders at, 16px favicon through 96px celebratory moments. Two
 * things this pass fixed, worth knowing if you touch this again:
 * (1) the beak was originally longer and thinner (read as a bird beak,
 * not a rubber-duck bill) — shortened and widened; (2) the original
 * "sad" pose used a single diagonally-sloped brow with its inner corner
 * LOWER than its outer corner — that's the anatomy for an angry/
 * furrowed brow, not a sad one, which is exactly why it read as angry
 * instead of sad. Sad's brow now curves the other way (inner corner
 * raised, outer corner drooped — true "worried" anatomy), paired with a
 * downcast eye and a frown. If you ever add another pose with a brow,
 * get the raised/drooped corners right on purpose, not by eyeballing a
 * diagonal line.
 *
 * Palette: body var(--mascot-yellow), wing var(--mascot-wing), beak/feet
 * var(--warn), eye var(--surface-0), eye highlight var(--accent) — the
 * one deliberate tie back to brand lime, kept small. Chosen over the
 * app's lime accent for the body specifically to avoid reading as a
 * green bird mascot next to Duolingo's owl.
 */
export interface DuckMarkProps {
  size?: number
}

export function DuckMark({ size = 28 }: DuckMarkProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 140 140">
      <circle cx="62" cy="70" r="46" fill="var(--mascot-yellow)" />
      <path
        d="M100,58 C118,50 138,54 140,64 C136,74 116,78 100,74 C98,68 99,63 100,58 Z"
        fill="var(--warn)"
      />
      <circle cx="64" cy="63" r="9" fill="var(--surface-0)" />
      <circle cx="67" cy="60" r="3.2" fill="var(--accent)" />
    </svg>
  )
}

export type DuckPose = 'idle' | 'happy' | 'debugging' | 'sad' | 'celebrating'

export interface DuckMascotProps {
  pose?: DuckPose
  size?: number
}

export function DuckMascot({ pose = 'idle', size = 96 }: DuckMascotProps) {
  const beakOpen = pose === 'celebrating'

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 200 200">
      <ellipse cx="100" cy="190" rx="46" ry="6" fill="#000000" opacity="0.22" />
      <path d="M76,176 Q73,190 80,192 Q87,190 84,176 Z" fill="var(--warn)" />
      <path d="M124,176 Q127,190 120,192 Q113,190 116,176 Z" fill="var(--warn)" />
      <path
        d="M62,166 C62,180 71,190 84,190 L116,190 C129,190 138,180 138,166 L138,114 C138,90 121,70 100,70 C79,70 62,90 62,114 Z"
        fill="var(--mascot-yellow)"
      />
      <path
        d="M128,120 C144,118 153,132 149,150 C145,164 130,167 121,158 C130,149 132,133 128,120 Z"
        fill="var(--mascot-wing)"
      />
      <circle cx="99" cy="54" r="36" fill="var(--mascot-yellow)" />

      {beakOpen ? (
        <>
          <path
            d="M127,42 C142,34 160,37 166,46 C164,50 156,53 148,54 L150,61 C142,60 133,57 127,52 Z"
            fill="var(--warn)"
          />
          <path
            d="M129,51 C138,55 147,57 153,57"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="1.6"
            opacity="0.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M127,46 C140,40 155,42 161,50 C158,58 144,62 127,60 C126,55 126,51 127,46 Z"
            fill="var(--warn)"
          />
          <path
            d="M129,53 Q143,52 156,52"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="1.6"
            opacity="0.5"
            strokeLinecap="round"
          />
        </>
      )}

      {pose === 'idle' && (
        <>
          <circle cx="101" cy="48" r="7" fill="var(--surface-0)" />
          <circle cx="103.5" cy="45.5" r="2.5" fill="var(--accent)" />
        </>
      )}

      {(pose === 'happy' || pose === 'celebrating') && (
        <>
          <path
            d={pose === 'celebrating' ? 'M89,40 Q100,28 111,40' : 'M90,44 Q100,34 110,44'}
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <rect
            x="26"
            y="26"
            width="8"
            height="8"
            fill="var(--accent)"
            transform="rotate(45 30 30)"
          />
          <rect
            x="150"
            y="16"
            width="6"
            height="6"
            fill="var(--accent)"
            transform="rotate(45 153 19)"
          />
          {pose === 'happy' ? (
            <rect
              x="152"
              y="42"
              width="5"
              height="5"
              fill="var(--accent)"
              transform="rotate(45 154.5 44.5)"
            />
          ) : (
            <>
              <rect
                x="172"
                y="70"
                width="6"
                height="6"
                fill="var(--warn)"
                transform="rotate(45 175 73)"
              />
              <rect
                x="24"
                y="80"
                width="6"
                height="6"
                fill="var(--accent)"
                transform="rotate(45 27 83)"
              />
              <rect
                x="160"
                y="90"
                width="5"
                height="5"
                fill="var(--accent)"
                transform="rotate(20 162.5 92.5)"
              />
              <rect
                x="150"
                y="10"
                width="7"
                height="7"
                fill="var(--danger)"
                transform="rotate(45 153.5 13.5)"
              />
            </>
          )}
        </>
      )}

      {pose === 'sad' && (
        <>
          {/* Worried anatomy, on purpose: the inner corner (x=111 end,
              nearer center) is RAISED and the outer corner (x=89 end) is
              DROOPED. Do not "simplify" this into a straight diagonal —
              that's the angry-brow bug this redesign fixed. */}
          <path
            d="M89,41 Q100,36 111,42"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="101" cy="52" r="7" fill="var(--surface-0)" />
          <circle cx="98.5" cy="54.5" r="2.5" fill="var(--accent)" />
          <path
            d="M91,72 Q101,64 111,72"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}

      {pose === 'debugging' && (
        <>
          <path
            d="M91,46 L110,50"
            stroke="var(--surface-0)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="101" cy="58" r="7" fill="var(--surface-0)" />
          <circle cx="104" cy="55" r="2.5" fill="var(--accent)" />
          <circle cx="160" cy="35" r="16" fill="none" stroke="var(--text-1)" strokeWidth="5" />
          <line
            x1="171"
            y1="46"
            x2="184"
            y2="59"
            stroke="var(--text-1)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <ellipse cx="160" cy="35" rx="6" ry="4" fill="var(--danger)" />
        </>
      )}
    </svg>
  )
}
```

Run `pnpm format` on this file after creating it — the spacing above is hand-typed, not prettier-formatted.

Update `Mascot.test.tsx`'s pose list to include the new pose:

```tsx
it.each(['idle', 'happy', 'debugging', 'sad', 'celebrating'] as const)(
```

---

## 2. New token: `src/index.css`

The wing needs a shade distinct from the body fill and from `--warn` (which is already the beak/feet color — reusing it for the wing would make them look like the same part). Add it right after `--mascot-yellow`, same block as before:

```css
--warn: #ffb020;
--warn-dim: #2e2408;
--mascot-yellow: #ffd23f;
--mascot-wing: #f0c236;
```

---

## 3. `public/favicon.svg` — regenerate from the new `DuckMark`

This file is rasterized standalone by `sharp` (`generatePwaIcons.ts`, `generateOgImage.ts`), outside any app CSS context, so it needs literal hex, not `var(...)`. Its contents are identical to the reference asset from part 0 — copy `public/mascot/duck-mark.svg` over it (or just point `SOURCE_SVG` in both generator scripts at `public/mascot/duck-mark.svg` directly and delete `favicon.svg`, if you'd rather not maintain two copies of the same file — either is fine, your call).

Then:

1. Run `pnpm generate:pwa-icons && pnpm generate:og-image`.
2. Look at the regenerated PNGs before committing. `rasterizeLogo()`'s seam-crop workaround in both scripts exists because an _earlier_ logo's clip-mask left a rasterization seam — this SVG has no mask at all, so that crop may now be trimming a clean render for nothing. If the icons look shaved or off-center, that's why; adjust or remove the crop rather than leaving it on autopilot.
3. `index.html`'s `theme-color` meta and both scripts' `BRAND_PURPLE` constant are already `#0e0f13` (fixed in a prior pass) — nothing to change there, just confirm they still match.

---

## 4. Fix `public/_headers` — the actual "bolt in my share link" bug

Change these two entries from a year of `immutable` caching to something that actually revalidates, since neither path is content-hashed:

```
/favicon.svg
  Cache-Control: public, max-age=3600

/og-image.png
  Cache-Control: public, max-age=3600
```

Add a comment above them explaining why (this repo's convention — every non-obvious cache/perf decision in this file has one already):

```
# 2026-09: previously `public, max-age=31536000, immutable`, same as
# /assets/* — wrong for these two specifically. That policy is safe for
# content-hashed paths and for anything workbox-precaches (the SW fetches
# revisioned entries with cache: 'reload', bypassing this header entirely
# — see /fonts/*'s comment below for the full version of this argument).
# But the browser's own favicon fetch and every OG/Twitter link-unfurl
# crawler (Facebook, X, Discord, iMessage, Slack) hit this path directly
# and are never SW-controlled, so an `immutable` year-long cache on an
# unhashed filename means a stale asset (this repo's original Vite-
# scaffold bolt favicon, pre-Phase-6 — see git log on this file) gets
# stuck in every crawler's and CDN edge's cache for up to a year after
# the file on disk changes. That's the actual mechanism behind old share
# links still showing the bolt. 1 hour keeps real caching value without
# that failure mode.
```

(Leave `/pwa-*.png`, `/icons.svg`, and `/fonts/*` alone — those are lower-risk: the PWA icons are fetched almost exclusively through SW-controlled or explicit-install flows, not automated crawlers, and `icons.svg`/fonts aren't the mascot.)

**This code fix only prevents _future_ staleness — it does not clear what's already cached.** After deploying:

- Cloudflare: purge cache for `getcodoro.com/favicon.svg` and `getcodoro.com/og-image.png` specifically (or a full purge) from the dashboard.
- Any platform you've already shared a getcodoro.com link on caches the unfurl independently of Cloudflare — force a re-scrape: Facebook Sharing Debugger (`developers.facebook.com/tools/debug/`) → Scrape Again, Twitter/X Card Validator, LinkedIn Post Inspector. iMessage/Discord previews typically refresh once the underlying image changes and their own short-lived cache expires — no manual tool for those.

---

## 5. Optional — don't wire silently, ask first

`StreakPause.tsx` (the streak-milestone dialog) currently uses `pose="happy"`. `celebrating` (open beak, bigger confetti burst) might be the better fit there specifically — `happy` is also what `BossPage.tsx` and `MissionComplete.tsx` use for an ordinary correct/cleared result, so giving the actual streak-milestone moment its own distinct pose would make it read as more of a big deal. Flag this to me; don't switch it without asking, same as this repo's existing convention for optional mascot placements.

---

## 6. Before you're done

- Run `pnpm validate` (typecheck + lint + test + content validation + build) and fix whatever it flags.
- Check `DuckMark` in the nav rail and mobile top bar, and `DuckMascot` at its smallest real usage (`StatsPage.tsx`'s `size={32}`) — confirm the shorter beak and rounder body still read clearly at that size, not just at 96px.
- Confirm the sad pose (`BossPage.tsx` on an uncleared run, `MissionComplete.tsx` on a failed boss stage) actually reads as sad now, not angry, at its real render size (`size={44}`).
