// Cloudflare Pages Function for `/puzzle/:id` (v5 Phase 5.4 / T11 — the
// remaining half of the OG work; `/challenge` shipped pre-v5 as
// functions/challenge.ts). File-based dynamic route: this file's path
// (`functions/puzzle/[id].ts`) is what makes Cloudflare route `/puzzle/:id`
// here, with `context.params.id` holding the segment.
//
// Per-puzzle OG images stay re-deferred (recorded decision, not a
// re-deferral to another prompt) — one static branded card
// (public/og-image.png) for every route; only <title>/meta description/
// og:title/og:description are dynamic here.
//
// An id that isn't in PUZZLE_OG_META (bad/unknown puzzle id) passes the
// static asset through untouched -- same "reject wholesale, one legible
// fallback" convention functions/challenge.ts already established.
import { MetaContentHandler, TitleHandler } from '../ogHandlers'
import { PUZZLE_OG_META } from '../puzzleOgMeta.generated'

export interface PuzzleOgCopy {
  title: string
  description: string
}

export interface ResolvedPuzzleOg {
  copy: PuzzleOgCopy
  canonicalUrl: string
}

/**
 * Pure lookup + URL-canonicalization, independent of HTMLRewriter/Response
 * -- same reasoning as challenge.ts's resolveChallengeOgHead: HTMLRewriter
 * has no Node/jsdom equivalent, so the decision logic is kept testable on
 * its own.
 */
export function resolvePuzzleOgHead(requestUrl: string, id: string): ResolvedPuzzleOg | null {
  const copy = PUZZLE_OG_META.get(id)
  if (!copy) return null
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  url.search = ''
  url.hash = ''
  return { copy, canonicalUrl: url.toString() }
}

interface Env {
  ASSETS: Fetcher
}

export const onRequestGet: PagesFunction<Env, 'id'> = async (context) => {
  const response = await context.env.ASSETS.fetch(context.request)
  const id = context.params.id
  if (typeof id !== 'string') return response

  const resolved = resolvePuzzleOgHead(context.request.url, id)
  if (!resolved) return response

  const { title, description } = resolved.copy
  const rewritten = new HTMLRewriter()
    .on('title', new TitleHandler(title))
    .on('meta[property="og:title"]', new MetaContentHandler(title))
    .on('meta[property="og:description"]', new MetaContentHandler(description))
    .on('meta[name="description"]', new MetaContentHandler(description))
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
