import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'app.css')
const css = readFileSync(cssPath, 'utf-8')

describe('app.css .app-shell__nav (PR #88 review: NavRail sticky follow-up)', () => {
  // Live-reported: the right sidebar stayed pinned while scrolling but the
  // left NavRail did not, despite NavRail carrying its own `sticky top-0`.
  // Root cause: NavRail's containing block (the outer .app-shell grid's
  // row 1) was exactly viewport-height whenever a page's own content was
  // shorter than the viewport, leaving zero slack for sticky to use — see
  // app.css's own comment on `.app-shell__nav` for the full mechanism.
  // Fix: named grid areas with `nav` spanning both outer rows (main
  // content + footer), so its containing block is the full page height,
  // the same way .app-shell__sidebar's already was.
  it('spans both outer grid rows (main content + footer) at the desktop breakpoint, giving NavRail sticky positioning real slack', () => {
    const desktopBlockMatch = /@media \(min-width: 1024px\) \{([\s\S]*)\}\s*$/.exec(css)
    expect(desktopBlockMatch).not.toBeNull()
    const desktopBlock = desktopBlockMatch?.[1] ?? ''
    const appShellRuleMatch = /\.app-shell \{([^}]*)\}/.exec(desktopBlock)
    expect(appShellRuleMatch).not.toBeNull()
    const appShellRule = appShellRuleMatch?.[1] ?? ''
    expect(appShellRule).toMatch(/grid-template-areas:\s*'nav content'\s*'nav footer';/)

    const navRuleMatch = /\.app-shell__nav\s*\{([^}]*)\}/.exec(css)
    expect(navRuleMatch).not.toBeNull()
    expect(navRuleMatch?.[1] ?? '').toMatch(/grid-area:\s*nav;/)

    const footerRuleMatch = /\.app-shell__footer\s*\{([^}]*)\}/.exec(css)
    expect(footerRuleMatch).not.toBeNull()
    expect(footerRuleMatch?.[1] ?? '').toMatch(/grid-area:\s*footer;/)
  })
})

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
