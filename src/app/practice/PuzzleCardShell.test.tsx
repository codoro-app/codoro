import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PuzzleCardShell } from './PuzzleCardShell'
import type {
  DragOrderPuzzle,
  McqPuzzle,
  ScrubberPuzzle,
  SwipeBinaryPuzzle,
  TapLinePuzzle,
} from '../../content'
import { nth } from '../../test/nth'

// join(), not `new URL('./practice.css', import.meta.url)` — Vite
// special-cases that literal pattern as an asset-URL import and rewrites it
// at transform time, which breaks fileURLToPath (it stops being a file:
// URL). Going through dirname(fileURLToPath(import.meta.url)) first (same
// pattern as src/content/tools/loadPuzzles.ts) avoids that rewrite.
//
// The Prism `.token.*` color rules this file's source-level check below
// looks for live in ../tokens.css, not practice.css itself — they're shared
// with Trace mode's scrubber.css consumer (see tokens.css's header
// comment), so this points there instead.
const tokensCssPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'tokens.css')

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
  correct_verdict: 'bug',
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

const dragOrderPuzzle: DragOrderPuzzle = {
  id: 'rec-900',
  pattern: 'recursion-termination',
  difficulty_rating: 1200,
  explanation: 'The base case has to be checked before the function recurses further.',
  prompt: 'Drag the steps into the order they execute.',
  language: 'javascript',
  snippet:
    'function countdown(n) {\n  if (n <= 0) return;\n  console.log(n);\n  countdown(n - 1);\n}',
  interaction: 'drag-order',
  format: 'output',
  blocks: ['Step 1', 'Step 2', 'Step 3'],
  correct_order: [2, 0, 1],
}

// format: 'code' — blocks are literal fragments of snippet being
// reassembled into it, so snippet already IS the solved answer. Regression
// fixture for the leak this format field exists to prevent (see
// DragOrderSchema's doc comment): before the fix, PuzzleCardShell showed
// the snippet for every drag-order puzzle regardless of format, handing the
// player this puzzle's answer outright.
const dragOrderCodePuzzle: DragOrderPuzzle = {
  id: 'rec-901',
  pattern: 'recursion-termination',
  difficulty_rating: 1200,
  explanation: 'The base case has to be checked before the function recurses further.',
  prompt: 'Drag these lines into the order that makes countdown(n) print then recurse.',
  language: 'javascript',
  snippet: 'if (n <= 0) return;\nconsole.log(n);\ncountdown(n - 1);',
  interaction: 'drag-order',
  format: 'code',
  blocks: ['console.log(n);', 'countdown(n - 1);', 'if (n <= 0) return;'],
  correct_order: [2, 0, 1],
}

const scrubberPuzzle: ScrubberPuzzle = {
  id: 'scl-999',
  pattern: 'scope-closures',
  difficulty_rating: 1700,
  explanation: 'n/a',
  prompt: 'n/a',
  language: 'javascript',
  snippet: 'let i = 0',
  interaction: 'scrubber',
  steps: [{ line: 0, vars: { i: '0' } }],
  checkpoints: [
    { afterStep: 0, question: 'next-line', choices: ['a', 'b'], correct: 0 },
    { afterStep: 0, question: 'next-line', choices: ['a', 'b'], correct: 0 },
  ],
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
    expect(screen.queryByRole('button', { name: 'Next puzzle' })).not.toBeInTheDocument()
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

    const continueButton = screen.getByRole('button', { name: 'Next puzzle' })
    await user.click(continueButton)
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('click-meaningfulness: defaults to a "Next puzzle" preview label, pinned in a sticky bottom drawer', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))

    const continueButton = screen.getByRole('button', { name: 'Next puzzle' })
    const stickyBar = continueButton.closest('.sticky')
    expect(stickyBar).not.toBeNull()
    // Offset by --bottom-nav-height (not flush bottom-0) — this bar is
    // mobile-only, and AppShell now renders a fixed BottomNav at the
    // viewport bottom on mobile; flush bottom-0 would sit directly under it.
    expect(stickyBar).toHaveClass('bottom-[var(--bottom-nav-height)]')
    // 2b.9 (feedback-fit bug): Continue now lives INSIDE the feedback-panel-
    // styled drawer, not outside it — the whole panel is what's sticky now
    // (banner + explanation + button pinned together as one unit), so
    // nesting no longer detaches the button from the panel's chrome the way
    // it did under the old "normal-flow panel + separate sticky bar" split
    // (see FEEDBACK_DRAWER_CLASS's doc comment in PuzzleCardShell.tsx).
    expect(container.querySelector('.feedback-panel')?.contains(continueButton)).toBe(true)
  })

  it('shareActions: renders no share trigger when omitted, and an icon trigger beside Continue when provided (2b.11)', async () => {
    const user = userEvent.setup()
    const onShared = vi.fn()
    const { rerender } = render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))

    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()

    rerender(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
        shareActions={[
          {
            id: 'puzzle',
            label: 'Share puzzle',
            copiedLabel: 'Copied!',
            copyAriaLabel: 'Copy puzzle link',
            text: 'share text',
            onShared,
          },
        ]}
      />,
    )

    const shareTrigger = screen.getByRole('button', { name: 'Share' })
    // Icon-only in this footer row (PuzzleCardShellProps' shareActions doc
    // comment) — same "Share" accessible name as the labelled variant used
    // elsewhere, but no visible text content, so it stays compact next to
    // Continue instead of competing with it for width.
    expect(shareTrigger).not.toHaveTextContent('Share')
    expect(shareTrigger.closest('.feedback-panel')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Next puzzle' }).closest('.feedback-panel')).toBe(
      shareTrigger.closest('.feedback-panel'),
    )

    await user.click(shareTrigger)
    await user.click(screen.getByRole('button', { name: 'Share puzzle' }))
    expect(onShared).toHaveBeenCalledTimes(1)
  })

  // Bug report (2026-08-12): the sticky bottom bar's solid bg-surface-0 read
  // as a "block of darker color than the background" and, on a tall
  // feedback panel, overlapped its scrolled-past text. Desktop has room to
  // avoid both problems outright — Continue moves inline, above the
  // feedback panel, non-sticky. Mobile keeps the sticky bar (thumb-reach,
  // covered by the test above); index.css.test.ts covers the background
  // fix that makes the mobile bar itself blend in instead of block.
  it('click-meaningfulness: on desktop (>=1024px) Continue renders inline above the feedback panel, not the sticky bottom bar', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(min-width: 1024px)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    )
    const user = userEvent.setup()
    const { container } = render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))

    const continueButton = screen.getByRole('button', { name: 'Next puzzle' })
    expect(continueButton.closest('.sticky')).toBeNull()

    const feedbackPanel = container.querySelector('.feedback-panel')
    if (feedbackPanel === null) {
      throw new Error('Expected a .feedback-panel to be present')
    }
    // "Above" the feedback panel: precedes it in document order.
    expect(
      continueButton.compareDocumentPosition(feedbackPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    vi.unstubAllGlobals()
  })

  it('moves keyboard focus to the Continue button the instant a commit lands, so Enter advances without an extra Tab', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(min-width: 1024px)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    )
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

    expect(screen.getByRole('button', { name: /Next puzzle/ })).toHaveFocus()

    vi.unstubAllGlobals()
  })

  it('Enter on a focused choice commits it via real native button activation, and Enter on Continue advances (todo 23, final-review finding)', async () => {
    // Prior tests in this file exercise the *result* of Enter-activation
    // (committing via user.click, then asserting focus moved) but never
    // Enter-activation itself — the load-bearing mechanism this whole phase
    // is built on (see PuzzleCardShell.tsx's doc comment on continueButtonRef:
    // "falls entirely out of native <button> Enter-activation semantics").
    // `userEvent.keyboard('{Enter}')` on a focused, clickable element
    // dispatches a real click through user-event's keyboard plugin (v14),
    // the same simulation RTL's own docs recommend for this exact case — so
    // this is the actual mechanism under test, not just its downstream
    // effects.
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(min-width: 1024px)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    )
    const user = userEvent.setup()
    const onContinue = vi.fn()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={onContinue}
      />,
    )

    screen.getByRole('button', { name: 'Missing break after gold' }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next puzzle/ })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onContinue).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })

  it('click-meaningfulness: continueDestination="results" previews "See results" instead of the default', async () => {
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
        continueDestination="results"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))
    expect(screen.getByRole('button', { name: 'See results' })).toBeInTheDocument()
  })

  it('click-meaningfulness: continueDestination="retry" previews "Try again" instead of the default', async () => {
    const user = userEvent.setup()
    render(
      <PuzzleCardShell
        puzzle={mcqPuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
        continueDestination="retry"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
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

  it('drag-order: renders a static code snippet plus the DragOrder body, and commits through the Check order button', async () => {
    const onAnswered = vi.fn()
    const user = userEvent.setup()
    const { container } = render(
      <PuzzleCardShell
        puzzle={dragOrderPuzzle}
        ratingDelta={4}
        onAnswered={onAnswered}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.getByText('Step 1')).toBeInTheDocument()
    // The static snippet must render (read-only, no onLineClick) so blocks
    // like "clamps n to 2" or "Logs 'C'" are legible against real source —
    // this is the bug fixed here (oob-021 and 22 other drag-order puzzles
    // were unsolvable without it). textContent, not getByText: line content
    // is split across highlight token spans (see the mcq test above). Not
    // interactive: no tap-target buttons.
    expect(container.querySelector('.code-snippet')?.textContent).toContain('countdown')
    expect(screen.queryAllByRole('button', { name: /^Line \d/ })).toHaveLength(0)

    // Submitted without reordering — blocks stay in their authored display
    // order ([0, 1, 2]), which correct_order ([2, 0, 1], a 3-cycle with no
    // fixed point) never matches. This is a shell-wiring test (DragOrder
    // renders under PuzzleCardShell, "Check order" reaches onAnswered, the
    // feedback panel appears) — DragOrder.test.tsx already covers the
    // correct-via-real-drag path at the component level.
    await user.click(screen.getByRole('button', { name: 'Check order' }))

    expect(onAnswered).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
    expect(screen.getByText('Not quite')).toBeInTheDocument()
  })

  it('drag-order format "code": does NOT render the snippet — it already IS the solved answer', () => {
    const { container } = render(
      <PuzzleCardShell
        puzzle={dragOrderCodePuzzle}
        ratingDelta={null}
        onAnswered={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.getByText(dragOrderCodePuzzle.prompt)).toBeInTheDocument()
    expect(container.querySelector('.code-snippet')).not.toBeInTheDocument()
    // The blocks themselves still render — they're the puzzle.
    expect(screen.getByText('console.log(n);')).toBeInTheDocument()
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

  // Phase 5b Item 6: Rush's per-puzzle clock reaches the shell through
  // forcedCommit rather than a real tap — these confirm it behaves exactly
  // like one (same onAnswered call, same locked feedback view), not a
  // parallel code path that could drift from the real-tap behavior.
  describe('forcedCommit (Phase 5b Item 6 — Rush clock timeout)', () => {
    it('commits automatically, calling onAnswered once with the forced payload and showing the matching feedback', () => {
      const onAnswered = vi.fn()
      render(
        <PuzzleCardShell
          puzzle={mcqPuzzle}
          ratingDelta={null}
          onAnswered={onAnswered}
          onContinue={vi.fn()}
          forcedCommit={{ correct: false, choiceIndex: null }}
        />,
      )

      expect(onAnswered).toHaveBeenCalledTimes(1)
      expect(onAnswered).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
      expect(screen.getByText('Not quite')).toBeInTheDocument()
    })

    it('does not double-commit if a forcedCommit is present but the player already answered first', async () => {
      const onAnswered = vi.fn()
      const user = userEvent.setup()
      const { rerender } = render(
        <PuzzleCardShell
          puzzle={mcqPuzzle}
          ratingDelta={null}
          onAnswered={onAnswered}
          onContinue={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Missing break after gold' }))
      expect(onAnswered).toHaveBeenCalledTimes(1)

      // The clock firing just after a real, in-time tap — same puzzle,
      // forcedCommit now arrives. `committed` is already true, so the
      // shell's effect must not fire a second, conflicting commit.
      rerender(
        <PuzzleCardShell
          puzzle={mcqPuzzle}
          ratingDelta={null}
          onAnswered={onAnswered}
          onContinue={vi.fn()}
          forcedCommit={{ correct: false, choiceIndex: null }}
        />,
      )

      expect(onAnswered).toHaveBeenCalledTimes(1)
    })

    it('ignores a stale forcedCommit left over from the previous puzzle once the puzzle prop changes', () => {
      const onAnswered = vi.fn()
      const { rerender } = render(
        <PuzzleCardShell
          puzzle={mcqPuzzle}
          ratingDelta={null}
          onAnswered={onAnswered}
          onContinue={vi.fn()}
          forcedCommit={{ correct: false, choiceIndex: null }}
        />,
      )
      expect(onAnswered).toHaveBeenCalledTimes(1)

      // A fresh puzzle, no new forcedCommit for it (the caller clears it on
      // every new serve — see useRushSession's serveNext) — the shell must
      // not re-fire the OLD forcedCommit value against the new puzzle.
      rerender(
        <PuzzleCardShell
          puzzle={{ ...mcqPuzzle, id: 'cf-002' }}
          ratingDelta={null}
          onAnswered={onAnswered}
          onContinue={vi.fn()}
        />,
      )
      expect(onAnswered).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Not quite')).not.toBeInTheDocument()
    })
  })

  // Regression guard for concern (a): highlightSnippet.ts emits Prism
  // `.token*` markup, but that markup is only useful if practice.css
  // actually colors it — otherwise every snippet renders in flat
  // --text-primary despite the highlighting work. Two layers of assertion:
  // (1) getComputedStyle on the token classes styled via var(--syntax-*).
  // jsdom's CSSOM does NOT resolve var() — it returns the literal unresolved
  // reference string (e.g. "var(--syntax-keyword)") rather than a computed
  // color (verified experimentally). That's still a useful assertion: since
  // each token type resolves to a *different* var(--syntax-*) reference
  // string, distinctness across keyword/string/number proves each token
  // class maps to its own custom property rather than all sharing one. It
  // does not prove the referenced custom property itself resolves to a
  // sensible color at runtime. (2) a source-level check on practice.css for
  // the classes styled via var(--text-muted), since a getComputedStyle
  // assertion there would be equally unable to resolve the custom property
  // and would just assert the same unresolved string back at itself.
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

  it("tokens.css defines color rules for every Prism token class this app's grammars emit (with dark values in index.css)", () => {
    const css = readFileSync(tokensCssPath, 'utf-8')

    // Token-variable-based token classes (light and dark values now live in
    // index.css via --syntax-* tokens, cross-checked with the getComputedStyle
    // assertions above for keyword/string/number).
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
        new RegExp(`\\.token\\.${cls}[,\\s][\\s\\S]{0,120}?color:\\s*var\\(--syn-`),
      )
    }

    // var(--text-1)-based token classes — jsdom can't resolve these via
    // getComputedStyle, so this is the only mechanical guard for them.
    // .token.comment is the one exception: decision #9 (v2 Arena plan)
    // gives comments their own dedicated --syn-cm hue rather than falling
    // back to --text-1.
    expect(css).toMatch(/\.token\.comment\s*\{[^}]*color:\s*var\(--syn-cm\)/)
    expect(css).toMatch(
      /\.token\.punctuation,[\s\S]*?\.token\.operator\s*\{[^}]*color:\s*var\(--text-1\)/,
    )

    // No dark-mode override block in tokens.css (dark values now live in
    // index.css's prefers-color-scheme: dark block, driving the same
    // var(--syntax-*) references automatically).
    const darkBlockInTokensCSS =
      /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\.token\.keyword/.exec(css)
    expect(darkBlockInTokensCSS).toBeNull()
  })

  // P0 regression: a scrubber puzzle used to render an empty, un-escapable
  // .puzzle-card__interaction div (no branch matched it in the old
  // &&-chain) — see docs/v2-phase2-review.md. The exhaustive switch fails
  // loudly instead. This can only ever fire if quizPool's exclusion of
  // scrubber is bypassed upstream; it's a backstop, not the primary fix.
  it('throws a clear error for a scrubber puzzle instead of silently rendering an empty interaction (P0 regression)', () => {
    // Suppress React's expected error-boundary console.error noise for this
    // one assertion — the throw itself is what's under test.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() =>
      render(
        <PuzzleCardShell
          puzzle={scrubberPuzzle}
          ratingDelta={null}
          onAnswered={vi.fn()}
          onContinue={vi.fn()}
        />,
      ),
    ).toThrow(/scrubber puzzle "scl-999" reached the quiz shell/)
    consoleError.mockRestore()
  })
})
