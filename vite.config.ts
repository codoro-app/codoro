import { configDefaults, defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const BRAND_PURPLE = '#863bff'

// v2 Phase 7b: the entry chunk's own stylesheet (app-shell CSS every route
// needs before first paint — tokens, index.css, app.css) is the only
// render-blocking resource on the built page; route-level CSS chunks load
// dynamically alongside their lazy route chunk and never appear in
// index.html's <head>. Confirmed against a real production Lighthouse run
// (2026-08-09) flagging ~170ms of render-blocking requests, and against
// this repo's own built dist/index.html, which lists exactly one
// <link rel="stylesheet">. Inlining it removes that request/CSSOM-ready
// round trip entirely, with none of the flash-of-unstyled-content risk a
// preload+swap pattern would carry for CSS that's actually needed at first
// paint (that pattern is for CSS that *isn't* needed yet — this is).
// A plugin, not a dependency: transformIndexHtml is Vite's own public
// plugin API, no npm package added.
// Known limitation, found by review: only the FIRST <link rel="stylesheet">
// in <head> is inlined. Correct today (confirmed exactly one exists in a
// real build), but if a second one is ever injected (future route
// restructuring, a plugin adding its own), it would silently stay external
// and render-blocking with no error or test to catch it — no unit-test
// coverage exists for this plugin at all (vite.config.ts sits outside
// tsconfig.app.json's test project by design; the only evidence for this
// plugin's behavior is a real `pnpm build`'s dist/index.html output).
function inlineCriticalCss(): Plugin {
  return {
    name: 'inline-critical-css',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        const linkRe = /<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/
        const match = linkRe.exec(html)
        if (!match) return html
        const fileName = match[1].replace(/^\//, '')
        // `in` rather than a falsy/optional-chain check on `bundle[fileName]`
        // directly: TS types OutputBundle's index signature as always-defined
        // (no noUncheckedIndexedAccess), so eslint flags either of those as
        // a dead branch — but the regex-captured href isn't guaranteed to
        // resolve to a real bundle key at runtime (a `base` config change, a
        // CDN-prefixed href), and indexing a genuinely-missing key would
        // otherwise throw reading `.type` below and hard-crash the build.
        if (!(fileName in bundle)) return html
        const asset = bundle[fileName]
        if (asset.type !== 'asset') return html
        const css =
          typeof asset.source === 'string'
            ? asset.source
            : Buffer.from(asset.source).toString('utf-8')
        // Delete the now-orphaned CSS asset so it doesn't linger in the SW
        // precache manifest as dead weight (working against the _headers
        // cache-lifetime fix's own spirit).
        Reflect.deleteProperty(bundle, fileName)
        return html.replace(match[0], `<style>${css}</style>`)
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    // v2 Phase 7b: explicit floor, not Vite's own default. Vite 8's
    // unset-target default is "baseline-widely-available", a frozen
    // snapshot (chrome111/safari16.4/ios16.4, ~March 2023) that doesn't
    // auto-advance — confirmed via node_modules/vite's own source, this is
    // the actual source of a real production Lighthouse run's ~9 KiB
    // "legacy JavaScript" flag (2026-08-09), not an injected polyfill (none
    // exists in this repo's dependencies).
    //
    // This app's real support matrix is "recent iOS Safari, recent Android
    // Chrome" only — no IE, no legacy Android. ios17/safari17 (Sept 2023)
    // and chrome120/edge120 (Dec 2023) move the floor ~8-9 months past
    // Vite's frozen default while staying a real margin behind whatever's
    // current as of this change (Aug 2026) — not 'esnext', which tracks
    // whatever the installed esbuild understands with no version floor at
    // all, a poor fit for iOS specifically (not evergreen the way Chrome
    // is; a phone that hasn't updated its OS in 6-12 months is common and
    // has no separate way to update just Safari).
    //
    // Explicit judgment call, not telemetry-backed: this repo has no
    // confirmed data on the actual minimum OS/browser version any real
    // user runs. Confirmed safe against the one real device this phase's
    // own OD-1/OD-5 verification ran on (iPhone 15 Pro, iOS 26.5.2 — far
    // above this floor).
    target: ['ios17', 'safari17', 'chrome120', 'edge120'],
    modulePreload: {
      // Native <link rel="modulepreload"> shipped in Safari 17, the last
      // holdout browser — once the target floor above is Safari 17+, this
      // polyfill shim is dead weight by construction.
      polyfill: false,
    },
  },
  plugins: [
    react(),
    // 2b.0: CSS-first Tailwind v4 — no tailwind.config.js, theme values live
    // in index.css's @theme inline block (see that file). Must run before
    // inlineCriticalCss() so its generated utilities land in the same
    // bundled stylesheet that plugin inlines into <head>.
    tailwindcss(),
    inlineCriticalCss(),
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
        // over. This regex allows the fallback only for the seven real
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
        // the same seven paths): vite.config.ts is its own isolated
        // tsconfig.node.json project (module: nodenext, include:
        // ["vite.config.ts"] only) and reaching into src/ from here fights
        // module resolution for a marginal DRY win. Keep this list in sync
        // with ROUTE_META's keys by hand — routes.test.ts asserts the
        // same pattern.
        //
        // v2 Phase 1b adds /puzzle/:id, the first dynamic route — a second
        // path segment no bare alternative above admits. The
        // 'puzzle\/[^/?]+' alternative requires at least one non-'/'
        // non-'?' character after 'puzzle/', so it matches /puzzle/<id>
        // (with or without a trailing '?query') but not a bare /puzzle/
        // (no id) — that falls through to this pattern's default "deny"
        // branch just like an unknown top-level path, consistent with
        // _redirects treating a bare /puzzle/ as "rewrite to the app shell,
        // let the client router 404 it" rather than a real route of its own.
        //
        // v2 Phase 5c adds /challenge, a *static* route whose payload lives
        // in the URL fragment (`/challenge#<base64url>`) — a fragment never
        // reaches Cloudflare or the SW, so this stays a plain literal
        // alternative here (like /legal), not a DYNAMIC_ROUTES entry.
        //
        // v2 Phase 7 adds /settings, another plain static route (same
        // treatment as /legal) — the export/import UI.
        //
        // v3 Phase 2b.7 adds /stats, another plain static route (same
        // treatment as /missions) — the rating-history/pattern-accuracy page.
        navigateFallbackDenylist: [
          /^\/(?!(?:practice|daily|rush|boss|browse|legal|trace|missions|stats|challenge|settings|puzzle\/[^/?]+)?(?:\?|$))/,
        ],
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
