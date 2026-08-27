import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Mechanical enforcement of the content barrel/pools split — the one thing
 * this branch's critical-path fix depended on that nothing checked.
 *
 * `puzzlePool`/`quizPool`/`scrubberPool` (./pools) and `DEV_STUB_PUZZLES`
 * (./devPuzzles) are deliberately NOT re-exported from ./index, and must be
 * deep-imported. ES modules evaluate per *file*, not per binding: importing
 * any of these through the barrel makes the whole eager module reachable
 * from the importer's chunk, so all 214 puzzle bodies (or the dev stub
 * puzzles) land on every route that touches the barrel — even where an
 * `import.meta.env.DEV` guard means the binding is never read. Measured:
 * 79.74 KB and 214 static puzzle imports with the re-export, 53.84 KB and
 * zero without. The final whole-branch review found `DEV_STUB_PUZZLES` back
 * in the production entry chunk exactly this way, past three separate
 * comments saying not to do it — hence a test rather than a fourth comment.
 *
 * The intended home for this is an eslint `no-restricted-imports` rule
 * (an `importNames` list on a glob group matching any path ending at
 * `content`), which would catch it in-editor rather than at test time. That
 * is strictly better and should replace this
 * file if eslint.config.js is ever opened for it; this test exists because
 * that file is write-protected in this environment. Both express the same
 * rule, so neither is weakened by the other's absence.
 *
 * Reads source text rather than the module graph on purpose: the violation
 * is a *syntactic* import specifier, and by the time Vitest has a module
 * graph the mocks in other test files have already reshaped it.
 */

const SRC_DIR = join(process.cwd(), 'src')

const FORBIDDEN_NAMES = ['puzzlePool', 'quizPool', 'scrubberPool', 'DEV_STUB_PUZZLES']

// Matches `import ... from '<path ending in /content or exactly ../content>'`
// and the `export ... from` form, capturing the braced clause. Deep paths
// like '../../content/pools' and '../../content/devPuzzles' end past
// `content` and so never match — they're the supported way in.
const BARREL_IMPORT_PATTERN =
  '(?:import|export)\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*[\'"]([^\'"]*?content)[\'"]'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

interface Violation {
  readonly file: string
  readonly name: string
}

function findViolations(text: string, file: string): Violation[] {
  const found: Violation[] = []
  for (const match of text.matchAll(new RegExp(BARREL_IMPORT_PATTERN, 'g'))) {
    const clause = match[1]
    if (clause === undefined) continue
    // Type-only imports are erased at compile time and can't pull a module
    // into a chunk, so `import type { ... }` is not a violation. Only the
    // whole-clause form is skipped here; an inline `type X` specifier inside
    // a value import is handled by the per-specifier check below.
    if (/^\s*import\s+type\b/.test(match[0])) continue
    for (const specifier of clause.split(',')) {
      const trimmed = specifier.trim()
      if (trimmed === '' || trimmed.startsWith('type ')) continue
      const imported = trimmed.split(/\s+as\s+/)[0]?.trim()
      if (imported !== undefined && FORBIDDEN_NAMES.includes(imported)) {
        found.push({ file, name: imported })
      }
    }
  }
  return found
}

describe('content barrel boundary', () => {
  it('no file imports the eager pools or the dev stubs through the content barrel', () => {
    const violations = sourceFiles(SRC_DIR)
      // This file itself holds violating import *strings* as fixtures for the
      // vacuity check below — matching them would be a false positive.
      .filter((file) => !file.endsWith('barrelBoundary.test.ts'))
      .flatMap((file) =>
        findViolations(
          readFileSync(file, 'utf-8'),
          relative(process.cwd(), file).split(sep).join('/'),
        ),
      )

    expect(violations.map((violation) => `${violation.file} imports ${violation.name}`)).toEqual([])
  })

  it('detects a violation when one is introduced (the check itself is not vacuous)', () => {
    const bad = "import { puzzlePool } from '../../content'\n"
    expect(findViolations(bad, 'fake.ts')).toEqual([{ file: 'fake.ts', name: 'puzzlePool' }])

    const alsoBad = "import { puzzleMeta, DEV_STUB_PUZZLES } from '../content'\n"
    expect(findViolations(alsoBad, 'fake.ts')).toEqual([
      { file: 'fake.ts', name: 'DEV_STUB_PUZZLES' },
    ])
  })

  it('allows the deep-import paths that are the supported way in', () => {
    expect(findViolations("import { puzzlePool } from '../../content/pools'\n", 'f.ts')).toEqual([])
    expect(
      findViolations("import { DEV_STUB_PUZZLES } from '../../content/devPuzzles'\n", 'f.ts'),
    ).toEqual([])
    // Type-only imports are erased and can never drag a module into a chunk.
    expect(findViolations("import type { quizPool } from '../../content'\n", 'f.ts')).toEqual([])
  })
})
