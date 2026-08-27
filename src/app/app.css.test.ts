import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'app.css')
const css = readFileSync(cssPath, 'utf-8')

describe('app.css .app-shell__sidebar', () => {
  // v4 Phase 4.0 (todo 26): the right rail scrolled away with the middle
  // column because `self-start` alone (a per-consumer Tailwind utility)
  // pins the sidebar's start position but never keeps it in the viewport.
  // Fixed once here so every one of .app-shell__sidebar's ~8 consumers
  // gets it for free, instead of a per-page utility-class edit.
  it('is sticky at the top of the viewport, capped to the viewport height with its own scroll, at the desktop breakpoint', () => {
    const desktopBlockMatch = /@media \(min-width: 1024px\) \{([\s\S]*)\}\s*$/.exec(css)
    expect(desktopBlockMatch).not.toBeNull()
    const desktopBlock = desktopBlockMatch?.[1] ?? ''
    const sidebarRuleMatch = /\.app-shell__sidebar\s*\{([^}]*)\}/.exec(desktopBlock)
    expect(sidebarRuleMatch).not.toBeNull()
    const sidebarRule = sidebarRuleMatch?.[1] ?? ''
    expect(sidebarRule).toMatch(/position:\s*sticky/)
    expect(sidebarRule).toMatch(/top:\s*0/)
    expect(sidebarRule).toMatch(/overflow-y:\s*auto/)
  })
})
