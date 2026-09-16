// Shared HTMLRewriter element handlers for every Pages Function that
// rewrites the SPA shell's <title>/meta tags (functions/challenge.ts,
// functions/puzzle/[id].ts). Extracted in T11 rather than duplicated a
// second time.

/** Sets a meta tag's `content` attribute. Plain (non-private) field: `erasableSyntaxOnly` forbids TS parameter-property shorthand, and a `private` field would make this class structurally incompatible with HTMLRewriter's plain `HTMLRewriterElementContentHandlers` interface. */
export class MetaContentHandler {
  content: string
  constructor(content: string) {
    this.content = content
  }
  element(element: Element) {
    element.setAttribute('content', this.content)
  }
}

/** Replaces `<title>`'s inner text. Field named `newText`, not `text`: HTMLRewriter's own interface already has a `text` member (its text-node handler callback). */
export class TitleHandler {
  newText: string
  constructor(newText: string) {
    this.newText = newText
  }
  element(element: Element) {
    element.setInnerContent(this.newText)
  }
}
