/**
 * Regression coverage for the mobile bottom-nav-clearance bug (live-
 * reported via screenshot, 2026-09-17): content flowing to the bottom of a
 * mobile route rendered underneath BottomNav's fixed bar instead of above
 * it — most visibly PracticePage's missedChallengeBanner, but structurally
 * a shell-level bug (`.app-shell__content` had no bottom padding reserving
 * BottomNav's height at all), so any route with enough content to reach the
 * bottom of the page was exposed to it. Fixed in src/app/app.css
 * (`.app-shell__content`'s `padding-bottom`); this spec is what catches a
 * future regression of that fix, or of BottomNav's own height changing
 * without app.css's `--bottom-nav-height` var following it.
 *
 * Route list: pulled from src/app/routes.ts's ROUTES (the app's own single
 * source of truth — see that file's doc comment) plus '/' and '/browse',
 * which routes.ts itself documents as real routes deliberately left out of
 * ROUTES. Not imported from src/app/routes.ts directly — e2e/ sits outside
 * tsconfig.app.json's project (see tsconfig.playwright.json), and reaching
 * into src/ from here hits the same cross-project problem vite.config.ts's
 * own navigateFallbackDenylist comment and tools/mockupCapture.ts's own
 * ROUTES comment already document and solve the same way: hand-copy, kept
 * in sync by hand (routes.test.ts's own drift guard is the belt-and-
 * suspenders check that ROUTES/ROUTE_META never drift from each other).
 * Excludes '/challenge' (payload lives in a URL fragment) and '/puzzle/:id'
 * (needs a real puzzle id) — both need a synthetic payload to render real
 * content and are skipped for the same reason tools/mockupCapture.ts's own
 * route list skips them; '/dev/scrubber' is dev-only tooling, not a real
 * player-facing route.
 *
 * Scope note: "every visible content element" is checked within
 * `#main-content` (AppShell's `<main class="app-shell__content">`) only,
 * restricted to leaf DOM nodes (no element children). `#main-content` is
 * exactly the region app.css's fix applies to, and BottomNav/the mobile top
 * bar/DevPuzzleToggle are its siblings, not descendants — scoping here is
 * what lets the assertion check "does this route's own content clear the
 * nav" without also flagging `<body>`/`<html>`/`#root`/`.app-shell`
 * themselves, whose layout boxes always span the full document height by
 * construction and would otherwise report a false violation on every
 * route, bug or not. Restricting to leaf nodes avoids the same
 * false-positive shape from any other wrapping element inside
 * `#main-content` (if a leaf's own pixels overlap the nav, that leaf itself
 * fails the assertion — a wrapper failing only because a descendant does
 * doesn't add information).
 */
import { test, expect, type Page } from '@playwright/test'

const MOBILE_VIEWPORT = { width: 390, height: 844 }

// Hand-copied from src/app/routes.ts's ROUTES + its '/'/'/browse' doc
// comment — see this file's header comment for why this isn't a live
// import. Keep in sync by hand if routes.ts's ROUTES ever changes.
const ROUTES_UNDER_TEST: readonly string[] = [
  '/',
  '/browse',
  '/practice',
  '/daily',
  '/rush',
  '/boss',
  '/compete',
  '/trace',
  '/missions',
  '/stats',
  '/legal',
  '/settings',
]

async function scrollMainToBottom(page: Page): Promise<void> {
  // index.css's `body` rule (see its own doc comment) deliberately scrolls
  // at the document level — there is no inner `overflow: auto` region for
  // any route to scroll instead (confirmed: no route/PageShell/PracticePage
  // css sets overflow-y on a content wrapper). window/document IS the
  // scrollable container this suite has to drive.
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  // A second pass after layout settles — entrance animations (framer-motion
  // puzzle-card transitions, auto-advance countdowns) can still be growing/
  // shrinking the page on the first pass.
  await page.waitForTimeout(150)
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
}

interface Violation {
  selector: string
  bottom: number
  navTop: number
}

async function findBottomNavOverlap(page: Page): Promise<Violation[]> {
  const nav = page.getByTestId('bottom-nav')
  await expect(nav).toBeVisible()
  const navBox = await nav.boundingBox()
  if (!navBox) throw new Error('bottom-nav has no bounding box')

  return page.evaluate((navTop: number) => {
    const found: { selector: string; bottom: number; navTop: number }[] = []
    const nodes = document.querySelectorAll('#main-content *')
    for (const el of Array.from(nodes)) {
      if (el.children.length > 0) continue // leaf nodes only — see spec header comment
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue // not on screen
      const style = window.getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      // 1px tolerance for subpixel layout rounding.
      if (rect.bottom > navTop + 1) {
        const classAttr = typeof el.className === 'string' ? el.className : ''
        const classSuffix = classAttr
          ? `.${classAttr.split(' ').filter(Boolean).slice(0, 3).join('.')}`
          : ''
        found.push({
          selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classSuffix}`,
          bottom: rect.bottom,
          navTop,
        })
      }
    }
    return found
  }, navBox.y)
}

async function assertNoOverlap(page: Page): Promise<void> {
  const violations = await findBottomNavOverlap(page)
  expect(
    violations,
    `Content overlapping BottomNav:\n${JSON.stringify(violations, null, 2)}`,
  ).toEqual([])
}

test.describe('mobile bottom-nav clearance', () => {
  test.use({ viewport: MOBILE_VIEWPORT })

  for (const path of ROUTES_UNDER_TEST) {
    test(`${path} — no content sits underneath BottomNav after scrolling to the bottom`, async ({
      page,
    }) => {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await scrollMainToBottom(page)
      await assertNoOverlap(page)
    })
  }

  // Named case (not just incidental route-loop coverage): this is the exact
  // bug from the live report — PracticePage's missedChallengeBanner, which
  // only appears once a puzzle has been answered and the *next* puzzle has
  // been served (see PracticePage.tsx's `missedChallenge` derivation).
  test('practice missedChallengeBanner — no overlap with BottomNav', async ({ page }) => {
    // Forces mcq puzzles: PuzzleCardShell's other interaction types
    // (swipe-binary/tap-line/drag-order) don't expose a plain "click a
    // choice button" answer path, and Mcq's own choice order is shuffled
    // per attempt, so a fixed click target can't assume which button is
    // right vs. wrong ahead of time either.
    await page.goto('/practice?interaction=mcq')
    await page.waitForLoadState('networkidle')

    let answeredWrong = false
    for (let attempt = 0; attempt < 15; attempt++) {
      await page.locator('.puzzle-card button').first().click()
      const status = page.getByRole('status')
      await expect(status).toBeVisible()
      const feedbackText = await status.innerText()
      if (feedbackText.includes('Not quite')) {
        answeredWrong = true
        break
      }
      await page.getByRole('button', { name: /next puzzle/i }).click()
    }
    expect(answeredWrong, 'Never landed a wrong MCQ answer within 15 attempts').toBe(true)

    // Advance past the wrong answer: the new puzzle's `answer` resets to
    // null while the wrong attempt still counts toward `challengeAttempts`
    // — exactly `missedChallenge`'s condition.
    await page.getByRole('button', { name: /next puzzle/i }).click()

    const banner = page.getByText('Missed it? Challenge your last answer:')
    await expect(banner).toBeVisible()

    await scrollMainToBottom(page)
    await assertNoOverlap(page)
  })
})
