/**
 * Codoro — full-site screenshot crawl for AI mockup input.
 *
 * Captures every real route at both a mobile and a desktop viewport, plus
 * the interaction-only surfaces that don't show up on first load (share
 * menu, challenge flow, Compete's two doors), and writes full-page PNGs to
 * ./codoro-mockup-shots/. Feed the PNGs straight to whatever AI model you're
 * using for mockups, along with a short brief telling it to treat these as
 * structure/content reference only and design the visual system fresh —
 * don't ask it to "clean up" the screenshots, or it'll anchor on the
 * current styling instead of inventing a real one.
 *
 * Dev tooling only — never imported by app code, never shipped.
 *
 * Setup (one time):
 *   pnpm add -D playwright
 *   npx playwright install chromium
 *
 * Run:
 *   pnpm mockup:capture
 *   (optional) BASE_URL=http://localhost:5173 pnpm mockup:capture
 *
 * Pulled from src/app/routes.ts + a grep pass over src/app on 2026-09-17
 * (compete-qa-fixes branch). That pass found the original click-chain
 * selectors had already drifted from the live components — see the
 * per-entry comments on CLICK_EXTRAS below for what changed and why.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE_URL = process.env.BASE_URL ?? 'https://getcodoro.com'
const OUT_DIR = './codoro-mockup-shots'

interface RouteEntry {
  slug: string
  path: string
}

// Static routes (ROUTES + the three routes that exist but aren't in
// ROUTES per routes.ts's own comment: '/', '/browse', '/challenge').
const ROUTES: readonly RouteEntry[] = [
  { slug: 'home', path: '/' },
  { slug: 'practice', path: '/practice' },
  { slug: 'daily', path: '/daily' },
  { slug: 'rush', path: '/rush' },
  { slug: 'boss', path: '/boss' },
  { slug: 'compete', path: '/compete' },
  { slug: 'trace', path: '/trace' },
  { slug: 'missions', path: '/missions' },
  { slug: 'browse', path: '/browse' },
  { slug: 'stats', path: '/stats' },
  { slug: 'settings', path: '/settings' },
  { slug: 'legal', path: '/legal' },
  // '/challenge' and '/puzzle/:id' need real payloads/ids to render
  // anything meaningful — paste a live link's path below if you want them
  // captured too, e.g. { slug: 'puzzle-sample', path: '/puzzle/abc123' }.
]

interface ViewportSpec {
  name: 'mobile' | 'desktop'
  width: number
  height: number
}

const VIEWPORTS: readonly ViewportSpec[] = [
  { name: 'mobile', width: 390, height: 844 }, // iPhone 12/13-ish
  { name: 'desktop', width: 1440, height: 900 },
]

interface ClickExtra {
  slug: string
  routes: readonly string[]
  steps: readonly string[]
}

// Interaction-only surfaces. Each entry re-loads its route fresh (so
// chains don't interfere with each other), then clicks through `steps` in
// order, screenshotting after each successful click. A step that can't be
// found just ends the chain there — expected on routes where that surface
// doesn't exist, not a bug in the script.
const CLICK_EXTRAS: readonly ClickExtra[] = [
  {
    slug: 'share-menu',
    // Boss dropped out of this list (grep-confirmed): BossPage.tsx's own
    // comment says Boss never had a ShareMenu ("no share/challenge cards
    // this phase" survived the challenge redesign) — just ChallengeButton.
    // Missions dropped too — neither ShareMenu nor ChallengeButton appears
    // anywhere in src/app/missions; MissionComplete.tsx is the one payoff
    // screen that could carry one, and it's already on the manual
    // checklist below since it needs a finished run to reach.
    routes: ['practice', 'daily', 'rush'],
    // Was `button[aria-label="Share"]` — that only matches ShareMenu's
    // `trigger="icon"` variant (PuzzleCardShell's mobile drawer footer).
    // Practice/Daily/Rush all mount ShareMenu with the default
    // `trigger="button"` variant instead (confirmed by grep — none of the
    // three pass a `trigger` prop), which has no aria-label, just an icon
    // + visible "Share" text. Matching on that text works for both
    // variants and is what's actually reachable from these three routes.
    steps: ['button:has-text("Share")'],
  },
  {
    slug: 'challenge-friend',
    // ChallengeButton.tsx's trigger text — confirmed selector. Route list
    // trimmed from the original grep-era guess: Missions never renders
    // ChallengeButton (same search as share-menu above, same conclusion),
    // and Compete's copy of it only exists deep inside Play Human's
    // post-run screen (CompeteHumanDone in CompetePage.tsx) — unreachable
    // by reloading /compete and clicking once, so it's covered by the
    // play-human chain below instead, not here. Practice/Daily's buttons
    // are gated behind an answered puzzle (`answer && challengeButton`),
    // so those two routes are expected to come back empty from a fresh
    // load — same "step not found, chain ends" behavior, not a bug.
    routes: ['practice', 'daily', 'rush', 'boss'],
    steps: ['button:has-text("Challenge a friend")'],
  },
  {
    slug: 'play-computer',
    // Menu -> level picker -> the actual race screen. Screenshots after
    // both clicks, so you get the tier-select state and the race itself.
    routes: ['compete'],
    steps: ['button:has-text("Play Computer")', 'button:has-text("Novice")'],
  },
  {
    slug: 'play-human',
    // LevelPicker.tsx's module comment still says Play Human wiring is
    // "a later task" — stale as of this branch. CompetePage.tsx's
    // `human-level` -> `human-play` doors are fully built (commit
    // 81a55ff, #146): the same LevelPicker used for Play Computer, then a
    // real PuzzleCardShell/TraceRunnerPuzzle run via useCompeteSession.
    // Mirrors play-computer's two-step chain for the same reason — the
    // level-picker state alone isn't worth much for mockups next to the
    // actual puzzle screen. Doesn't chase it all the way to
    // CompeteHumanDone (the post-run share screen); reaching that needs
    // the puzzle actually answered, not just clicked into, which is out
    // of scope for a menu-click crawl.
    routes: ['compete'],
    steps: ['button:has-text("Play Human")', 'button:has-text("Novice")'],
  },
]

async function run() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()

  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    })

    for (const route of ROUTES) {
      const url = `${BASE_URL}${route.path}`
      const outPath = `${OUT_DIR}/${route.slug}--${viewport.name}.png`
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 })
        await page.waitForTimeout(400) // let entrance animations settle
        await page.screenshot({ path: outPath, fullPage: true })
        console.log(`ok    ${viewport.name.padEnd(7)} ${route.path}`)
      } catch (err) {
        const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
        console.log(`FAIL  ${viewport.name.padEnd(7)} ${route.path} — ${message}`)
        continue
      }

      for (const extra of CLICK_EXTRAS) {
        if (!extra.routes.includes(route.slug)) continue
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 })
          await page.waitForTimeout(300)
        } catch {
          continue
        }
        for (let i = 0; i < extra.steps.length; i++) {
          try {
            await page.locator(extra.steps[i]).first().click({ timeout: 1500 })
            await page.waitForTimeout(300)
            const stepSuffix = extra.steps.length > 1 ? `-step${String(i + 1)}` : ''
            const extraPath = `${OUT_DIR}/${route.slug}--${viewport.name}--${extra.slug}${stepSuffix}.png`
            await page.screenshot({ path: extraPath, fullPage: true })
            console.log(
              `  +   ${viewport.name.padEnd(7)} ${route.path} (${extra.slug}${stepSuffix})`,
            )
          } catch {
            // Step not found/clickable — expected on routes where this
            // surface doesn't exist, or where an earlier step didn't
            // actually open what the next step expects. Stop the chain.
            break
          }
        }
      }
    }

    await page.close()
  }

  await browser.close()
  console.log(`\nDone. Screenshots in ${OUT_DIR}/`)
  console.log('See the manual checklist at the bottom of this script for the')
  console.log("state-gated surfaces this crawl can't reach on its own.")
}

run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

// ---------------------------------------------------------------------
// Manual checklist — surfaces found by grepping src/app that only appear
// under real app state, timing, or device conditions. Not worth faking
// with seeded IndexedDB/localStorage for a one-off mockup pass; faster to
// screenshot these by hand during a normal play session:
//
//   - StreakPause.tsx        — shown when a streak is about to lapse
//   - SignInSheet.tsx /
//     SignupPromptSheet.tsx  — auth prompts (src/auth/ — Clerk-backed and
//                              live, gated behind SignupPromptTrigger's own
//                              conditions, not "mid-build" scaffolding)
//   - IosInstallSheet.tsx    — PWA install prompt, iOS UA only
//   - MissionComplete.tsx    — end-of-chain payoff screen on /missions
//   - FirstRunComplete.tsx   — end of the curated first-run flow (needs a
//                              clean localStorage/incognito session)
//   - ComboSurge.tsx         — in-practice streak micro-feedback, needs a
//                              real answer streak to trigger
//   - CheckpointPanel.tsx    — Trace's side panel; may already be in the
//                              base /trace screenshot if it's part of the
//                              default layout rather than a toggle — check
//                              before adding a click step for it
// ---------------------------------------------------------------------
