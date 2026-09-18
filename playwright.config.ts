/**
 * Minimal Playwright config for the e2e/ suite. Chromium only — the app's
 * real support matrix is "recent iOS Safari, recent Android Chrome" (see
 * vite.config.ts's `build.target` comment), but Chromium is what's
 * available in this environment and is enough to catch layout-clearance
 * regressions like the mobile bottom-nav bug this suite exists for.
 *
 * `webServer` boots the real Vite dev server (no backend needed — Practice/
 * Daily/etc. read puzzles from the bundled content index and persist to
 * local IndexedDB, no network call on the paths this suite exercises) and
 * reuses one already running locally, so `pnpm test:mobile-nav` works the
 * same in CI and in a dev loop.
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Built-in screenshot-on-failure (Part 2, item 6) — a failing run shows
    // exactly what content ended up underneath BottomNav.
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
