import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PuzzleCardShell } from './PuzzleCardShell'
import type { McqPuzzle, SwipeBinaryPuzzle, TapLinePuzzle } from '../../content'
import { nth } from '../../test/nth'

// join(), not `new URL('./practice.css', import.meta.url)` — Vite
// special-cases that literal pattern as an asset-URL import and rewrites it
// at transform time, which breaks fileURLToPath (it stops being a file:
// URL). Going through dirname(fileURLToPath(import.meta.url)) first (same
// pattern as src/content/tools/loadPuzzles.ts) avoids that rewrite.
const practiceCssPath = join(dirname(fileURLToPath(import.meta.url)), 'practice.css')

const mcqPuzzle: McqPuzzle = {
  id: 'cf-001',
  pattern: 'control-flow',
  difficulty_rating: 1100,
  explanation: 'Missing break causes fall-through into the silver case.',
  prompt: "What's the bug in this discount calculator?",
  language: 'javascript',
  snippet: "switch (tier) {\n  case 'gold':\n    discount = 20;\n}",
  interaction: 'mcq',
  choices: ['Missing break after gold', 'Wrong order', 'Should use const', 'Should use if/else'],
  correct_choice: 0,
}

const swipePuzzle: SwipeBinaryPuzzle = {
  id: 'con-001',
  pattern: 'concurrency',
  difficulty_rating: 2000,
  explanation: 'count++ is not atomic.',
  prompt: 'Is this safe?',
  language: 'java',
  snippet: 'count++;',
  interaction: 'swipe-binary',
  left_label: 'Thread-safe',
  right_label: 'Race condition',
  correct_direction: 'right',
}

const tapLinePuzzle: TapLinePuzzle = {
  id: 'cf-002',
  pattern: 'control-flow',
  difficulty_rating: 1600,
  explanation: 'The break only exits the inner loop.',
  prompt: 'Tap the line responsible for the bug.',
  language: 'javascript',
  snippet: 'for (let i = 0; i < 3; i++) {\n  console.log(i)\n  break\n}',
  interaction: 'tap-line',
  correct_line: 2,
}

describe('PuzzleCardShell', () => {
  it('renders the prompt and a static syntax-highlighted snippet for mcq puzzles', () => {
    const { container } = render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.getByText(mcqPuzzle.prompt)).toBeInTheDocument()
    // Static snippet view: line content present (split across highlight
    // token spans, so check textContent rather than a single text node),
    // and not rendered as tap targets.
    expect(container.querySelector('.code-snippet')?.textContent).toContain("case 'gold':")
    expect(screen.queryAllByRole('button', { name: /^Line \d/ })).toHaveLength(0)
  })

  it('does not render a feedback panel before commit', () => {
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={5}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('mcq: commit -> calls onAnswered once, shows feedback with delta + explanation, Continue calls onContinue', async () => {
    const onAnswered = vi.fn()
    const onContinue = vi.fn()
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={12}
        onAnswered={onAnswered}
        onContinue={onContinue}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))

    expect(onAnswered).toHaveBeenCalledTimes(1)
    expect(onAnswered).toHaveBeenCalledWith({ correct: true, choiceIndex: 0 })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Nice — correct')).toBeInTheDocument()
    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText(mcqPuzzle.explanation)).toBeInTheDocument()

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    await user.click(continueButton)
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('mcq: wrong answer shows "Not quite" and a negative delta', async () => {
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={-9}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Wrong order' }))

    expect(screen.getByText('Not quite')).toBeInTheDocument()
    expect(screen.getByText('-9')).toBeInTheDocument()
  })

  it('renders no delta text when ratingDelta is null', async () => {
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/^[+-]\d+$/)).not.toBeInTheDocument()
  })

  it('swipe-binary: renders the fallback buttons and commits through to feedback', async () => {
    const onAnswered = vi.fn()
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={swipePuzzle}
        ratingDelta={7}
        onAnswered={onAnswered}
        onContinue={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Race condition' }))

    expect(onAnswered).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    expect(screen.getByText('Nice — correct')).toBeInTheDocument()
  })

  it('tap-line: renders the snippet as tap targets (no separate static snippet) and commits on line tap', async () => {
    const onAnswered = vi.fn()
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={tapLinePuzzle}
        ratingDelta={3}
        onAnswered={onAnswered}
        onContinue={vi.fn()}
      />,
    )

    const lineButtons = screen.getAllByRole('button')
    expect(lineButtons).toHaveLength(4)

    await user.click(nth(lineButtons, 2))

    expect(onAnswered).toHaveBeenCalledWith({ correct: true, choiceIndex: 2 })
    expect(screen.getByText('Nice — correct')).toBeInTheDocument()
  })

  it('resets committed state when the puzzle prop changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={12}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))
    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(
      <PuzzleCardShell
        puzzle={swipePuzzle}
        ratingDelta={7}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thread-safe' })).toBeInTheDocument()
  })

  it('ignores a second onAnswered-triggering commit once already committed', async () => {
    const onAnswered = vi.fn()
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={12}
        onAnswered={onAnswered}
        onContinue={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))
    expect(onAnswered).toHaveBeenCalledTimes(1)
    // Choices are disabled post-commit; nothing left to click that would
    // re-trigger onCommit, confirming the shell's guard + the body's own
    // disabled state agree.
    for (const button of screen.getAllByRole('button', { name: /break|order|const|if\/else/ })) {
      expect(button).toBeDisabled()
    }
  })

  // Regression guard for concern (a): highlightSnippet.ts emits Prism
  // `.token*` markup, but that markup is only useful if practice.css
  // actually colors it — otherwise every snippet renders in flat
  // --text-primary despite the highlighting work. Two layers of assertion:
  // (1) real cascade resolution via getComputedStyle for the token classes
  // that get literal hex colors (jsdom's CSSOM resolves those correctly —
  // verified experimentally), and (2) a source-level check on practice.css
  // for the classes styled via var(--text-muted), since jsdom's
  // getComputedStyle does not resolve CSS custom properties (it returns the
  // literal string "var(--text-muted)" instead of the computed color), which
  // would make a getComputedStyle assertion on those classes unreliable.
  it('colors syntax-highlighted tokens instead of leaving them flat --text-primary', () => {
    const { container } = render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    // mcqPuzzle's snippet ("switch (tier) { case 'gold': ... }") produces
    // keyword/string/number/punctuation/operator tokens — enough to cover
    // both the literal-color and var(--text-muted) rule groups below.
    const keyword = container.querySelector('.token.keyword')
    const string = container.querySelector('.token.string')
    const number = container.querySelector('.token.number')
    if (keyword === null || string === null || number === null) {
      throw new Error('Expected .token.keyword/.token.string/.token.number spans to be present')
    }

    const keywordColor = getComputedStyle(keyword).color
    const stringColor = getComputedStyle(string).color
    const numberColor = getComputedStyle(number).color

    // Each token type gets its own distinct, non-default color rather than
    // all inheriting --text-primary (rgb(60, 60, 60)).
    expect(keywordColor).not.toBe('')
    expect(keywordColor).not.toBe('rgb(60, 60, 60)')
    expect(new Set([keywordColor, stringColor, numberColor]).size).toBe(3)
  })

  it("practice.css defines dark-mode-aware color rules for every Prism token class this app's grammars emit", () => {
    const css = readFileSync(practiceCssPath, 'utf-8')

    // Literal-hex-color token classes (cross-checked with the
    // getComputedStyle assertions above for keyword/string/number).
    for (const cls of [
      'keyword',
      'string',
      'function',
      'class-name',
      'number',
      'boolean',
      'builtin',
    ]) {
      expect(css).toMatch(
        new RegExp(`\\.token\\.${cls}[,\\s][\\s\\S]{0,120}?color:\\s*#[0-9a-fA-F]{6}`),
      )
    }

    // var(--text-muted)-based token classes — jsdom can't resolve these via
    // getComputedStyle, so this is the only mechanical guard for them.
    expect(css).toMatch(/\.token\.comment\s*\{[^}]*color:\s*var\(--text-muted\)/)
    expect(css).toMatch(
      /\.token\.punctuation,[\s\S]*?\.token\.operator\s*\{[^}]*color:\s*var\(--text-muted\)/,
    )

    // A dark-mode override block exists (following index.css's established
    // prefers-color-scheme convention) and recolors the literal-hex classes.
    // The closing brace matched here is the one that starts a line (i.e.
    // un-indented) — the first such brace after the opening one, since every
    // rule nested inside the media block is indented.
    const darkBlock = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/.exec(css)
    expect(darkBlock).not.toBeNull()
    expect(darkBlock?.[1]).toMatch(/\.token\.keyword\s*\{[^}]*color:\s*#[0-9a-fA-F]{6}/)
    expect(darkBlock?.[1]).toMatch(/\.token\.string\s*\{[^}]*color:\s*#[0-9a-fA-F]{6}/)
  })
})
