import { describe, expect, it } from 'vitest'
import { validatePuzzleFiles } from './validatePuzzles'
import type { RawPuzzleFile } from './loadPuzzles'

function rawMcq(id: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    id,
    pattern: 'off-by-one',
    difficulty_rating: 1000,
    explanation: 'A real explanation.',
    prompt: "What's wrong?",
    language: 'javascript',
    snippet: 'for (let i = 0; i <= n; i++) {}',
    interaction: 'mcq',
    choices: ['right answer', 'wrong answer'],
    correct_choice: 0,
    ...overrides,
  }
}

describe('validatePuzzleFiles', () => {
  it('returns all puzzles as valid when every file passes the schema', () => {
    const files: RawPuzzleFile[] = [
      { filePath: 'a.json', raw: rawMcq('a-001') },
      { filePath: 'b.json', raw: rawMcq('b-001') },
    ]

    const { valid, errors } = validatePuzzleFiles(files)
    expect(errors).toEqual([])
    expect(valid.map((v) => v.puzzle.id)).toEqual(['a-001', 'b-001'])
  })

  it('collects a schema error per invalid file without stopping at the first one', () => {
    const files: RawPuzzleFile[] = [
      { filePath: 'good.json', raw: rawMcq('good-001') },
      { filePath: 'bad-difficulty.json', raw: rawMcq('bad-001', { difficulty_rating: 99999 }) },
      { filePath: 'bad-explanation.json', raw: rawMcq('bad-002', { explanation: '' }) },
    ]

    const { valid, errors } = validatePuzzleFiles(files)
    expect(valid.map((v) => v.puzzle.id)).toEqual(['good-001'])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('bad-difficulty.json')
    expect(errors[1]).toContain('bad-explanation.json')
  })

  it('flags a duplicate id across two otherwise-valid files, naming both', () => {
    const files: RawPuzzleFile[] = [
      { filePath: 'first.json', raw: rawMcq('dup-001') },
      { filePath: 'second.json', raw: rawMcq('dup-001') },
    ]

    const { valid, errors } = validatePuzzleFiles(files)
    expect(valid.map((v) => v.puzzle.id)).toEqual(['dup-001'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('second.json')
    expect(errors[0]).toContain('duplicate id "dup-001"')
    expect(errors[0]).toContain('first.json')
  })

  it('returns no valid puzzles and no errors for an empty pool', () => {
    const { valid, errors } = validatePuzzleFiles([])
    expect(valid).toEqual([])
    expect(errors).toEqual([])
  })
})
