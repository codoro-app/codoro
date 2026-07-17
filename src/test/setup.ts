import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

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
