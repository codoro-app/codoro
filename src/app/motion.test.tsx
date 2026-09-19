/**
 * Motion foundation reduced-motion test (Part B.5): proves the two shared
 * patterns (press feedback — motion.ts's PRESS_CLASS; card/panel entrance —
 * tokens.css's .motion-enter) actually collapse to instant under
 * [data-reduced-motion='true'].
 *
 * This asserts CSS SOURCE structure, not a live getComputedStyle read:
 * vitest's `css: true` (vite.config.ts) transforms CSS imports so they don't
 * error, but doesn't inject the resulting stylesheet into jsdom's
 * document — confirmed empirically (a getComputedStyle probe against both
 * classes returned browser defaults, '0s'/'auto', regardless of
 * data-reduced-motion). No test in this codebase asserts real cascaded CSS
 * values for exactly that reason (grep-verified: only className-presence
 * assertions like `toHaveClass` exist anywhere).
 *
 * What IS deterministically provable without a real layout engine: the
 * app-level kill-switch (src/index.css) is a universal `*` selector with
 * `!important` on `animation-duration`/`transition-duration` — CSS's
 * cascade guarantees an `!important` declaration on those exact properties
 * always wins over any non-important value, REGARDLESS of the specificity
 * or source order of whatever set them (here, PRESS_CLASS's
 * `duration-[var(--motion-press)]` utility and `.motion-enter`'s `animation`
 * shorthand).
 * So proving (a) that kill-switch rule still exists with its original
 * shape, and (b) that both patterns route their timing through exactly
 * `animation`/`transition-duration` (no `!important` override of their own
 * that could out-cascade the kill-switch) is a complete, structural proof
 * that both patterns collapse under the attribute — not an approximation.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRESS_CLASS } from './motion'

const INDEX_CSS = readFileSync(resolve(__dirname, '../index.css'), 'utf-8')
const TOKENS_CSS = readFileSync(resolve(__dirname, './tokens.css'), 'utf-8')

describe('motion foundation — reduced motion', () => {
  it('the app-level kill-switch still collapses every element’s animation/transition duration with !important', () => {
    expect(INDEX_CSS).toMatch(
      /\[data-reduced-motion='true'\] \*,\s*\[data-reduced-motion='true'\] \*::before,\s*\[data-reduced-motion='true'\] \*::after \{\s*animation-duration: 0\.001ms !important;[\s\S]*?transition-duration: 0\.001ms !important;/,
    )
  })

  it('PRESS_CLASS routes its timing through duration-[var(--motion-press)]/transition — no !important escape hatch of its own', () => {
    expect(PRESS_CLASS).toContain('transition-[transform,opacity]')
    expect(PRESS_CLASS).toContain('duration-[var(--motion-press)]')
    expect(PRESS_CLASS).not.toContain('!')
  })

  it('PRESS_CLASS never regresses to a bare duration-press — Tailwind v4 has no --duration-* theme namespace, so that utility silently generates no CSS at all', () => {
    expect(PRESS_CLASS).not.toContain('duration-press')
  })

  it('.motion-enter routes its timing through a plain animation shorthand — no !important escape hatch of its own', () => {
    expect(TOKENS_CSS).toMatch(
      /\.motion-enter \{\s*animation: app-entrance var\(--motion-enter\) var\(--ease-out\);\s*\}/,
    )
    const motionEnterBlock = /\.motion-enter \{[^}]*\}/.exec(TOKENS_CSS)?.[0] ?? ''
    expect(motionEnterBlock).not.toContain('!important')
  })
})
