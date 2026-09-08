/**
 * Puzzle `explanation` fields are hand-written with a small amount of
 * inline markdown — backtick code spans (`` `break outer` ``) and, in a
 * minority of files, single-asterisk italic emphasis (`*after*`) — but they
 * were rendered as plain React text (`{puzzle.explanation}`), so every span
 * printed literally, delimiters and all (regression found post-#107). A
 * grep across the puzzle content JSON (src/content/puzzles) confirmed those
 * two span types are the only markdown in play (no bold, links, or
 * headers), so this is a
 * small pure parser rather than a real markdown dependency — see
 * PuzzleCardShell.tsx's two call sites.
 *
 * Deliberately not a general markdown parser: no nesting, no escaping, no
 * other span types. If puzzle content ever grows real markdown needs,
 * replace this with a proper library instead of extending it further.
 */
import type { ReactNode } from 'react'

// Backtick spans are tried first in the alternation so a code span like
// `` `2 * 0` `` is consumed whole before the italic branch ever sees the
// asterisk inside it.
//
// The italic alternative requires a non-space character immediately inside
// each delimiting `*`, which is what keeps spaced multiplication like
// "2 * 0" from being misread as the start of an italic span.
const INLINE_SPAN_RE = /`([^`]+)`|\*(\S(?:[^*]*\S)?)\*/g

/**
 * Splits `text` on backtick code spans and single-asterisk italic spans,
 * returning an array of plain strings and `<code>`/`<em>` elements suitable
 * for spreading directly into JSX children (`<p>{renderInlineMarkdown(text)}</p>`).
 * An unmatched/stray delimiter (odd backtick, spaced asterisk) is left as a
 * literal character rather than treated as the start of a span.
 */
export function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const match of text.matchAll(INLINE_SPAN_RE)) {
    const index = match.index
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index))
    }
    const [full, code, italic] = match
    if (code !== undefined) {
      nodes.push(<code key={key++}>{code}</code>)
    } else {
      nodes.push(<em key={key++}>{italic}</em>)
    }
    lastIndex = index + full.length
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}
