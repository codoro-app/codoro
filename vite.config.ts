import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const BRAND_PURPLE = '#863bff'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': a new SW installs and Workbox checks for
      // it automatically in the background, but it never takes over the
      // open tab — and so never swaps the cached shell out from under a
      // mid-session user — until useUpdatePrompt() (src/app/pwa) calls
      // updateServiceWorker() from the in-app "Update available" banner.
      // Silent auto-reload is exactly the failure mode the build plan calls
      // out: "the classic way to brick your own deploys for existing users."
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Codoro',
        short_name: 'Codoro',
        description: 'Daily coding puzzles that adapt to your rating.',
        theme_color: BRAND_PURPLE,
        background_color: BRAND_PURPLE,
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/pwa-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Puzzle content is bundled into the JS chunks (see src/content/index.ts's
        // import.meta.glob), so the default JS/CSS/HTML/image globs below already
        // precache app shell + content together — no separate content fetch to cache.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        navigateFallback: '/index.html',
        // Without a denylist, every navigation once the SW is installed —
        // including a deliberately bad path — gets index.html from cache,
        // so a 404 check behaves differently before vs. after the SW takes
        // over. This regex allows the fallback only for the six real
        // routes (and '/' itself); anything else falls through to the
        // network, matching _redirects/404.html's behavior for the same
        // path in a plain browser tab. Built as one negative-lookahead
        // regex (not a per-route array) because navigateFallbackDenylist
        // is a deny-list — expressing "allow only these" any other way
        // means enumerating the infinite complement instead.
        //
        // workbox-routing's NavigationRoute._match tests this against
        // url.pathname + url.search, not pathname alone (confirmed from
        // node_modules/workbox-routing/NavigationRoute.js) — so each
        // alternative has to admit an optional '?...' after the route
        // name, not just end-of-string ($), or a shared/campaign link like
        // /practice?utm_source=twitter gets denied the offline shell where
        // bare /practice works. The (?:\?|$) alternation covers both: end
        // of string for a bare path, or the start of a query string for
        // one with params.
        //
        // Not imported from src/app/routes.ts's ROUTE_META (which lists
        // the same six paths): vite.config.ts is its own isolated
        // tsconfig.node.json project (module: nodenext, include:
        // ["vite.config.ts"] only) and reaching into src/ from here fights
        // module resolution for a marginal DRY win. Keep this list in sync
        // with ROUTE_META's keys by hand — routes.test.ts asserts the
        // same pattern.
        navigateFallbackDenylist: [/^\/(?!(?:practice|daily|rush|browse|legal)?(?:\?|$))/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Vitest's default excludes don't cover .claude/ — without this it also
    // collects test files from any git worktree checked out under
    // .claude/worktrees/ (see superpowers:using-git-worktrees), running the
    // whole suite a second time against a second, possibly stale, copy.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/storage/**/*.ts'],
      exclude: ['src/engine/**/*.test.ts', 'src/storage/**/*.test.ts'],
      thresholds: {
        statements: 100,
        functions: 100,
        lines: 100,
        // db.ts's object-store-already-exists guard is structurally
        // unreachable under a single fixed DB_VERSION — see the comment at
        // its call site. Everything else in engine/ and storage/ is 100%.
        branches: 96,
      },
    },
  },
})
