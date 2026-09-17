/**
 * Single shared secondary-navigation mount point. BottomNav (mobile icon
 * bar) and NavRail (desktop rail) stay separate components — see each of
 * their own doc comments for why one component rendering both shapes via
 * className soup was rejected — but every route only ever needs to mount
 * ONE thing for "app navigation", not manage both plus a duplicate footer
 * link row itself (that footer is gone — see AppShell.tsx). AppShell renders
 * this once; later routes reuse it the same way instead of re-wiring
 * BottomNav+NavRail by hand.
 */
import { BottomNav } from './BottomNav'
import { NavRail } from './NavRail'

export function SecondaryNav() {
  return (
    <>
      <div className="hidden lg:block app-shell__nav">
        <NavRail />
      </div>
      <BottomNav />
    </>
  )
}
