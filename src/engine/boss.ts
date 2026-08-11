/**
 * Boss-mode domain constants. No selection logic lives here (unlike
 * rush.ts) — Boss's run order is a fixed, hand-authored sequence
 * (src/content/bossRun.ts), not a live draw from a pool, so there is
 * nothing to select or weight. This file exists purely to give Boss's one
 * real domain constant the same home Rush's own constants have (RUSH_
 * STRIKE_LIMIT lives in rush.ts, not in the session hook), so a future
 * consumer (e.g. Phase 2's mission-progression trigger) can import it
 * without reaching into useBossSession.ts's private module scope.
 */

/**
 * Wrong answers (a Boss puzzle has no clock, unlike Rush — see this plan's
 * design record — so every strike here is a real wrong answer, never a
 * timeout) that end a Boss run. Direct user decision, docs/v3-build-plan.md
 * Phase 1 design question 3: "more forgiving — the payoff is the
 * escalating-difficulty arc itself... a single early misclick ending a
 * 10-puzzle run would undercut that framing." Deliberately its own constant,
 * not a re-export of rush.ts's RUSH_STRIKE_LIMIT: the two happen to share a
 * value today, but they are independent design decisions for independent
 * modes, and coupling them would make a future change to one silently
 * change the other.
 */
export const BOSS_STRIKE_LIMIT = 3
