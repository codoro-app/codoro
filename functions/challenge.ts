/**
 * Cloudflare Pages Function for `/challenge` (v5 Phase 5.4, pulled forward
 * pre-v5 — see docs/v5-build-plan.md's Phase 5.4 entry). This is genuinely
 * new infrastructure: `functions/` didn't exist in this repo before this
 * file, even though nothing here touches D1, Clerk, or auth — it's a static
 * asset rewrite at the Pages edge, nothing more.
 *
 * Why this exists at all: the full challenge payload lives in the URL
 * *fragment* (`src/challenge/codec.ts`'s own design — a fragment never
 * reaches Cloudflare), so link-preview crawlers (iMessage, Slack, Discord)
 * have never been able to see anything challenge-specific — every
 * `/challenge` link has always unfurled as the site's generic static card.
 * `buildChallengeUrl` now also places a narrow `?og=` query param in front
 * of the fragment (challenger name + puzzle count only — see
 * `ChallengeOgParamSchema`), which IS visible here at the edge. This
 * function decodes it and rewrites the static HTML's OG/Twitter meta tags
 * (and `<title>`) to real, per-challenge copy before serving it.
 *
 * A missing or undecodable `og` param passes the static asset through
 * completely untouched — today's generic card — matching the codec's own
 * "reject wholesale, one legible fallback" convention. `og:image`/
 * `twitter:image` are left alone in this pass (text-only card, per the build
 * plan); a bespoke per-challenge image is an explicitly deferred follow-up.
 *
 * The decision logic below (`sanitizeOgName`, `buildChallengeOgCopy`,
 * `resolveChallengeOgHead`) is deliberately pure and exported for direct
 * unit testing — `HTMLRewriter` itself is a Workers/Pages-runtime global
 * with no Node/jsdom equivalent (this project's vitest environment is
 * jsdom), so it can't be exercised in a plain unit test without spinning up
 * an actual Miniflare/workerd instance. Real end-to-end rewriting is
 * verified via `pnpm dev:pages` against real link-preview debuggers
 * (Slack/Discord/opengraph.xyz) instead — see this PR's description for the
 * URLs tested. `onRequestGet` below is kept intentionally thin: it only
 * wires the pure functions' output onto HTMLRewriter's element handlers.
 */
import { decodeChallengeOgParam } from '../src/challenge'
import type { ChallengeOgParam } from '../src/challenge'

export interface ChallengeOgCopy {
  title: string
  description: string
}

// Matches C0 control characters (U+0000-U+001F) and DEL (U+007F). Built from
// character codes rather than a literal regex so no raw control byte sits in
// this source file. eslint's no-control-regex rule targets literal regex
// syntax and does not flag a runtime-constructed RegExp, so no disable
// comment is needed either.
const CONTROL_CHAR_CODES = [...Array(32).keys(), 127]
const CONTROL_CHARS_PATTERN = new RegExp(
  `[${CONTROL_CHAR_CODES.map((code) => String.fromCharCode(code)).join('')}]`,
  'g',
)

/**
 * Strips control characters (C0 + DEL) and re-caps at 40 — defense in depth
 * on top of `ChallengeOgParamSchema`'s own bound. HTMLRewriter's
 * `setAttribute` already attribute-escapes whatever it's given (no
 * injection risk either way), but a challenger's self-chosen name still
 * shouldn't be able to plant literal control bytes into served HTML.
 */
export function sanitizeOgName(name: string): string {
  return name.replace(CONTROL_CHARS_PATTERN, '').slice(0, 40)
}

/**
 * The two card variants, per the build plan's exact copy: named vs.
 * anonymous, singular vs. plural. A name that sanitizes down to nothing
 * (e.g. all control characters) falls back to the anonymous copy rather
 * than rendering an empty-looking title.
 */
export function buildChallengeOgCopy(og: ChallengeOgParam): ChallengeOgCopy {
  const puzzleWord = og.c === 1 ? 'puzzle' : 'puzzles'
  const name = og.n ? sanitizeOgName(og.n) : ''
  if (name) {
    return {
      title: `${name} challenges you — ${String(og.c)} ${puzzleWord}`,
      description: `Beat ${name}'s time on ${String(og.c)} coding ${puzzleWord}. No account needed.`,
    }
  }
  return {
    title: `A friend challenges you — ${String(og.c)} ${puzzleWord}`,
    description: `Beat their time on ${String(og.c)} coding ${puzzleWord}. No account needed.`,
  }
}

export interface ResolvedChallengeOg {
  copy: ChallengeOgCopy
  /** The request URL with its query string (and any fragment, defensively) stripped — what `og:url` gets rewritten to, so the canonical stays clean. */
  canonicalUrl: string
}

/**
 * The whole "should this response be rewritten, and with what" decision,
 * pure and independent of HTMLRewriter/Response — takes the raw request URL
 * string, returns `null` for every failure mode (no `og` param, an
 * unparseable URL, or a param that fails `decodeChallengeOgParam`'s own
 * reject-wholesale contract), matching this codebase's standard "collapse
 * every failure to one fallback" convention.
 */
export function resolveChallengeOgHead(requestUrl: string): ResolvedChallengeOg | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  const ogParam = url.searchParams.get('og')
  if (!ogParam) return null
  const decoded = decodeChallengeOgParam(ogParam)
  if (!decoded) return null
  const canonical = new URL(url)
  canonical.search = ''
  canonical.hash = ''
  return { copy: buildChallengeOgCopy(decoded), canonicalUrl: canonical.toString() }
}

/**
 * Sets a meta tag's `content` attribute — used for every og:*, twitter:* tag
 * below. Plain (non-private, non-parameter-property) fields: `erasableSyntaxOnly`
 * forbids TS parameter-property shorthand, and a `private` field would make
 * this class structurally incompatible with HTMLRewriter's plain
 * `HTMLRewriterElementContentHandlers` interface.
 */
class MetaContentHandler {
  content: string
  constructor(content: string) {
    this.content = content
  }
  element(element: Element) {
    element.setAttribute('content', this.content)
  }
}

/**
 * Replaces `<title>`'s inner text — same plain-field shape as
 * MetaContentHandler above. Field named `newText`, not `text`: HTMLRewriter's
 * own `HTMLRewriterElementContentHandlers` interface already has a `text`
 * member (its text-node handler callback), and a same-named field of a
 * different type breaks structural assignability against it.
 */
class TitleHandler {
  newText: string
  constructor(newText: string) {
    this.newText = newText
  }
  element(element: Element) {
    element.setInnerContent(this.newText)
  }
}

interface Env {
  ASSETS: Fetcher
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const response = await context.env.ASSETS.fetch(context.request)
  const resolved = resolveChallengeOgHead(context.request.url)
  if (!resolved) return response

  const { title, description } = resolved.copy
  const rewritten = new HTMLRewriter()
    .on('title', new TitleHandler(title))
    .on('meta[property="og:title"]', new MetaContentHandler(title))
    .on('meta[property="og:description"]', new MetaContentHandler(description))
    .on('meta[name="twitter:title"]', new MetaContentHandler(title))
    .on('meta[name="twitter:description"]', new MetaContentHandler(description))
    .on('meta[property="og:url"]', new MetaContentHandler(resolved.canonicalUrl))
    .transform(response)

  const headers = new Headers(rewritten.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(rewritten.body, {
    status: rewritten.status,
    statusText: rewritten.statusText,
    headers,
  })
}
