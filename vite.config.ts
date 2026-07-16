import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
