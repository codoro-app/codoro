import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'index.css')
const css = readFileSync(cssPath, 'utf-8')

describe('index.css page background', () => {
  // Regression guard for the "Continue button has a block of darker color
  // than the background" bug report: no element in the app (body/#root/
  // .app-shell) ever set an explicit background-color, so the page canvas
  // fell back to the browser's own implicit dark UA color (from
  // `color-scheme: dark` at :root) instead of --surface-0 — the exact token
  // PuzzleCardShell/TraceRunner's sticky Continue bar (and PageShell's
  // header/stickyAction bars) paint explicitly. The mismatch between the
  // real page background and that explicit fill is what read as a visible
  // seam/"block" in the field report, confirmed live via screenshot before
  // this fix.
  it("sets body's background to --surface-0, the same token every sticky bar paints", () => {
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--surface-0\)/)
  })
})
