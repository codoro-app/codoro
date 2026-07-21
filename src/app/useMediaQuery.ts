/**
 * Tracks a CSS media query's match state in JS. Used only to decide whether
 * to *mount* desktop-only content that has real side effects (e.g.
 * MasteryView's attempt fetch) — pure layout positioning stays in CSS
 * (Grid + media queries), per the shell's design.
 *
 * Built on `useSyncExternalStore` rather than a `useState` + `useEffect`
 * pair: the latter (this repo's original draft) calls `setState`
 * synchronously in the effect body to seed the initial value, which trips
 * this repo's `react-hooks/set-state-in-effect` lint rule (React Compiler's
 * hooks ruleset) — a real error, not a style nit, per this repo's "fix the
 * code, don't weaken lint config" rule. `useSyncExternalStore` is the
 * React-documented pattern for exactly this "subscribe to a synchronous
 * external browser API" case: no local state, no effect-driven setState,
 * and the snapshot is correct from the very first render — strictly
 * better than a `false`-then-correct-on-mount flash, and just as CSR-only
 * safe (no `getServerSnapshot` is needed since this SPA has no server
 * render to reconcile against).
 */
import { useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => {
        mql.removeEventListener('change', onChange)
      }
    },
    () => window.matchMedia(query).matches,
  )
}
