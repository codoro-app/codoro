/**
 * Puzzle-snippet syntax highlighting, wrapped behind this helper so the
 * component layer (and later phases) never import the highlighting library
 * directly. See the module doc in PuzzleCardShell.tsx for the Prism-vs-Shiki
 * decision and measured bundle-size numbers.
 */
import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-c'

// Prism's default core (imported above) already registers markup/css/clike/
// javascript. python/java/c are pulled in explicitly for the other three
// puzzle languages (CALIBRATION.md / src/content/puzzles/**'s `language`
// field: "javascript" | "python" | "java" | "c").
const LANGUAGE_ALIASES: Record<string, string> = {
  javascript: 'javascript',
  js: 'javascript',
  python: 'python',
  py: 'python',
  java: 'java',
  c: 'c',
}

function resolveGrammar(language: string): { grammar: Prism.Grammar; name: string } {
  const key = LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase()
  const grammar: Prism.Grammar | undefined = Prism.languages[key]
  if (grammar) {
    return { grammar, name: key }
  }
  // Unknown `language` value: render as plain (escaped, uncolored) text
  // rather than throwing — content validation lives in src/content/schema.ts,
  // not here, so this is a display-layer fallback, not an error path.
  // Prism.languages.plain is always registered by prism's core, but
  // @types/prismjs types the lookup as possibly-undefined; fall back to an
  // empty grammar (no tokens matched -> Prism.highlight just escapes text).
  return { grammar: Prism.languages.plain ?? {}, name: 'plain' }
}

/** One highlighted source line. */
export interface HighlightedLine {
  /** Plain-text content of this line (no markup). */
  text: string
  /** Prism-escaped HTML for this line's tokens — safe for dangerouslySetInnerHTML. */
  html: string
}

/**
 * Syntax-highlights `source`, one {@link HighlightedLine} per line.
 *
 * Highlighting runs per line (not once over the whole snippet) because both
 * consumers need one DOM node per line either way — PuzzleCardShell's static
 * snippet view (for line numbers) and TapLine's per-line tap targets. Puzzle
 * snippets are short, single-bug excerpts where a token spanning a line
 * break (a block comment, a triple-quoted string) is rare; if one occurs,
 * that line highlights as if self-contained rather than perfectly. Accepted
 * trade-off for this phase — see the report for the Prism-vs-Shiki
 * discussion this decision is downstream of.
 */
export function highlightSnippet(source: string, language: string): HighlightedLine[] {
  const { grammar, name } = resolveGrammar(language)
  return source.split('\n').map((text) => ({
    text,
    html: Prism.highlight(text, grammar, name),
  }))
}
