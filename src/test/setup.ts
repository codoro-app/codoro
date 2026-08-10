import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// The default 1000ms asyncUtilTimeout is tight enough that waitFor() calls
// waiting on real async work (content-pool parsing, IndexedDB round-trips)
// can miss it under full-suite thread contention even though they resolve
// well within a couple hundred ms in isolation — App.test.tsx's initial
// render assertion was observed flaking this way under `vitest run`'s
// default parallelism. Widening it here (rather than per-call) covers every
// waitFor/findBy* in the suite the same way.
//
// Raised 5000 -> 10000, Phase 8: 5000 itself still flaked (App.test.tsx's
// and App.bootHomeChunk.test.tsx's own initial-render waitFor calls, both
// already carrying a 15s outer `it()` timeout for the same reason) when run
// as part of the full `pnpm validate` chain specifically — typecheck+lint
// finishing right before `test` starts appears to leave enough residual
// contention that 5s isn't always enough, even though every one of these
// tests passes reliably (well under 1s) both in isolation and via a
// standalone `pnpm test`. Same flake class, wider margin, not a new
// mechanism — see docs/v2-build-plan.md's Phase 8 amendment.
configure({ asyncUtilTimeout: 10_000 })

// jsdom doesn't implement the Pointer Events capture API (setPointerCapture /
// releasePointerCapture / hasPointerCapture) — see jsdom#2527. SwipeBinary
// (Phase 4 concern b) binds `@use-gesture/react`'s useDrag, which calls
// `setPointerCapture` on every real pointerdown, including the plain click
// on its two fallback buttons (a click still starts a pointer sequence).
// Without this stub, any test that renders SwipeBinary un-mocked (e.g.
// PuzzleCardShell.test.tsx, which composes the real interaction bodies) hits
// a `TypeError: event.target.setPointerCapture is not a function` that
// aborts the click before React's onClick handler runs. This is the
// standard, minimal workaround recommended for testing Pointer-Events-based
// gesture libraries under jsdom.
// lib.dom.d.ts declares these as always-present on Element, so a runtime
// existence check would always read as `true` to the type checker even
// though jsdom genuinely omits them — assign unconditionally instead.
Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => undefined
Element.prototype.releasePointerCapture = () => undefined

// jsdom doesn't implement window.scrollTo (it logs "Not implemented" and
// no-ops) — PracticePage calls it to reset scroll position whenever a new
// puzzle is served, which every one of its tests exercises via the mount
// effect. Stubbed globally, same as the pointer-capture methods above, so
// that's a real no-op instead of console noise on every test in this file.
window.scrollTo = () => undefined

// jsdom doesn't implement window.matchMedia at all — PwaPrompts calls it
// (via iosInstall.ts's currentIosEnvironment) on every mount to check for
// display-mode: standalone, which every App.test.tsx render exercises.
// Stubbed to "never matches", same reasoning as the stubs above.
window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
})

// jsdom doesn't implement navigator.clipboard — ShareCard (Daily mode) calls
// writeText on copy. Stubbed as a resolving no-op, same pattern as the
// pointer-capture/scrollTo/matchMedia stubs above; tests that assert the
// copy behavior spy on this via vi.spyOn(navigator.clipboard, 'writeText').
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: () => Promise.resolve() },
  writable: true,
  configurable: true,
})

// vitest.config.ts doesn't set `test.globals: true` (this repo imports
// describe/it/expect explicitly everywhere), so @testing-library/react's
// automatic per-test cleanup — which relies on a global `afterEach` —
// never registers on its own. Without this, React component trees from one
// test leak into the DOM for the next, breaking any query that expects a
// single match (getByRole, etc.) once more than one component test file
// runs. Wire it explicitly here instead.
afterEach(() => {
  cleanup()
})
