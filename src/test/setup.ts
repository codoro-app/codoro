import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

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
