import { describe, expect, it } from 'vitest'
import { highlightSnippet } from './highlightSnippet'

describe('highlightSnippet', () => {
  it('returns one entry per source line, preserving plain text', () => {
    const source = 'function add(a, b) {\n  return a + b\n}'
    const lines = highlightSnippet(source, 'javascript')

    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.text)).toEqual(['function add(a, b) {', '  return a + b', '}'])
  })

  it('produces non-trivial token markup for javascript', () => {
    const lines = highlightSnippet('function add(a, b) {\n  return a + b\n}', 'javascript')
    const html = lines.map((l) => l.html).join('\n')
    expect(html).toContain('<span')
    expect(html).toMatch(/token/)
  })

  it('produces non-trivial token markup for python', () => {
    const lines = highlightSnippet('def add(a, b):\n    return a + b', 'python')
    const html = lines.map((l) => l.html).join('\n')
    expect(html).toContain('<span')
    expect(html).toMatch(/token/)
  })

  it('produces non-trivial token markup for java', () => {
    const lines = highlightSnippet('public class Counter {\n  private int count = 0;\n}', 'java')
    const html = lines.map((l) => l.html).join('\n')
    expect(html).toContain('<span')
    expect(html).toMatch(/token/)
  })

  it('produces non-trivial token markup for c', () => {
    const lines = highlightSnippet(
      '#include <stdio.h>\n\nvoid printPrice(double price) {\n    printf("Price: $%d\\n", price);\n}',
      'c',
    )
    const html = lines.map((l) => l.html).join('\n')
    expect(html).toContain('<span')
    expect(html).toMatch(/token/)
  })

  it('escapes HTML-significant characters so snippet content cannot inject markup', () => {
    const lines = highlightSnippet('const x = a < b && b > c', 'javascript')
    const html = lines.map((l) => l.html).join('\n')
    expect(html).not.toContain('a < b')
  })

  it('falls back gracefully (no throw, still one entry per line) for an unknown language', () => {
    const lines = highlightSnippet('some ??? text\nmore text', 'cobol')
    expect(lines).toHaveLength(2)
    expect(lines[0]?.text).toBe('some ??? text')
  })

  it('preserves empty lines', () => {
    const lines = highlightSnippet('a\n\nb', 'javascript')
    expect(lines).toHaveLength(3)
    expect(lines[1]?.text).toBe('')
    expect(lines[1]?.html).toBe('')
  })
})
