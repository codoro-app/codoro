/**
 * Moves focus to the page's `<main>` landmark and resets scroll on every
 * client-side route change — a router regresses both by default (focus
 * stays on the clicked link, scroll position persists across navigations),
 * which is an a11y regression nobody notices for months. Skips the very
 * first render (the browser's own initial-load focus behavior is correct
 * there; nothing has "navigated" yet).
 *
 * Back/forward is the one exception for scroll: the browser's own scroll
 * restoration is correct there, so scroll only resets for pushState/
 * replaceState-driven navigations (Link clicks, programmatic navigate()
 * calls) — not popstate. Tracked via a ref flipped by native
 * popstate/pushState/replaceState listeners (wouter monkey-patches
 * history.pushState/replaceState to also dispatch same-named events — see
 * wouter/src/use-browser-location.js). All three fire synchronously as
 * part of handling the browser action, strictly before React's next
 * render/effect phase, so the flag this effect reads is always current by
 * the time it runs — regardless of listener registration order between
 * this hook and wouter's own location subscription.
 */
import { useEffect, useRef, type RefObject } from 'react'
import { useLocation } from 'wouter'

export function useRouteFocusAndScroll(mainRef: RefObject<HTMLElement | null>) {
  const [location] = useLocation()
  const isPopRef = useRef(false)
  const isFirstRenderRef = useRef(true)

  useEffect(() => {
    const markPop = () => {
      isPopRef.current = true
    }
    const markPush = () => {
      isPopRef.current = false
    }
    window.addEventListener('popstate', markPop)
    window.addEventListener('pushState', markPush)
    window.addEventListener('replaceState', markPush)
    return () => {
      window.removeEventListener('popstate', markPop)
      window.removeEventListener('pushState', markPush)
      window.removeEventListener('replaceState', markPush)
    }
  }, [])

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      isPopRef.current = false
      return
    }
    if (!isPopRef.current) {
      window.scrollTo({ top: 0 })
    }
    isPopRef.current = false
    mainRef.current?.focus()
  }, [location, mainRef])
}
