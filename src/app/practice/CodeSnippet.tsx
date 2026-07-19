import type { HighlightedLine } from './highlightSnippet'
import type { AnswerState } from './answerState'

export interface CodeSnippetProps {
  lines: HighlightedLine[]
  /** When provided, each line renders as a tap target (TapLine's committed=false state). Omit (or pass undefined) for a static, read-only snippet. */
  onLineClick?: ((index: number) => void) | undefined
  /** Per-line visual state once committed (tap-line only). Defaults to 'default' for every line when omitted. */
  lineState?: ((index: number) => AnswerState) | undefined
}

/**
 * Shared syntax-highlighted snippet renderer. PuzzleCardShell uses it
 * read-only for mcq/swipe-binary puzzles; TapLine reuses it as its
 * interactive tap-target surface (`onLineClick` + `lineState`) since the
 * line *is* the interaction for that puzzle type.
 */
export function CodeSnippet({ lines, onLineClick, lineState }: CodeSnippetProps) {
  const interactive = onLineClick !== undefined

  return (
    <div className="code-snippet">
      {lines.map((line, index) => {
        const state = lineState?.(index) ?? 'default'
        const className = [
          'code-snippet__line',
          interactive && 'code-snippet__line--interactive',
          state !== 'default' && `code-snippet__line--${state}`,
        ]
          .filter(Boolean)
          .join(' ')

        const lineNumber = (
          <span className="code-snippet__line-number" aria-hidden="true">
            {index + 1}
          </span>
        )
        const codeHtml = { __html: line.html || '&nbsp;' }

        if (interactive) {
          return (
            <button
              key={index}
              type="button"
              className={className}
              onClick={() => {
                onLineClick(index)
              }}
              aria-label={`Line ${String(index + 1)}: ${line.text.trim().length > 0 ? line.text : '(blank)'}`}
            >
              {lineNumber}
              <span className="code-snippet__line-code" dangerouslySetInnerHTML={codeHtml} />
            </button>
          )
        }

        return (
          <div key={index} className={className}>
            {lineNumber}
            <span className="code-snippet__line-code" dangerouslySetInnerHTML={codeHtml} />
          </div>
        )
      })}
    </div>
  )
}
