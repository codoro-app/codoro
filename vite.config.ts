import { defineConfig } from 'vitest/config'
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
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
