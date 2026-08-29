import { createIdCounters, writePuzzle } from './puzzleAuthoringShared'
import { PuzzleSchema } from '../schema'
import type { PatternSlug } from '../patterns'

const counters = createIdCounters()

function author(pattern: PatternSlug, puzzle: Record<string, unknown>) {
  const id = counters.peek(pattern)
  const full = { id, pattern, ...puzzle }
  const result = PuzzleSchema.safeParse(full)
  if (!result.success) {
    console.error(`SKIP ${id}:`, result.error.issues)
    return
  }
  writePuzzle(result.data)
  counters.commit(pattern, id)
  console.log(`WROTE ${id}`)
}

// Batch 1: scope-closures, null-undefined, type-coercion (all JavaScript)

author('scope-closures', {
  interaction: 'tap-line',
  difficulty_rating: 1700,
  prompt:
    'Two independent debounced functions from this controller interfere with each other. Tap the line responsible.',
  explanation:
    "`timer` is declared once at module scope, outside `debounce`. Every function `debounce` returns shares that single variable, instead of each call to `debounce` getting its own private timer via closure. So `createSearchController`'s two debounced functions — `debouncedSearch` and `debouncedAutosave` — are secretly reading and writing the same `timer`. Calling `controller.search('hello')` schedules a timeout and stores it in `timer`; calling `controller.autosave('draft text')` shortly after runs `clearTimeout(timer)` first, which cancels the *search* timeout (not an autosave one), then overwrites `timer` with its own. Only the autosave ever fires — the search callback is silently cancelled, even though nothing about the search call itself was wrong. The fix is moving `let timer` inside `debounce`'s body so each returned function closes over its own timer.",
  language: 'javascript',
  snippet: [
    'let timer = null',
    '',
    'function debounce(fn, delay) {',
    '  return (...args) => {',
    '    clearTimeout(timer)',
    '    timer = setTimeout(() => {',
    '      fn(...args)',
    '    }, delay)',
    '  }',
    '}',
    '',
    'function createSearchController(onSearch, onAutosave) {',
    '  const debouncedSearch = debounce(onSearch, 300)',
    '  const debouncedAutosave = debounce(onAutosave, 300)',
    '',
    '  return {',
    '    search: (query) => debouncedSearch(query),',
    '    autosave: (draft) => debouncedAutosave(draft),',
    '  }',
    '}',
  ].join('\n'),
  correct_line: 0,
})

author('null-undefined', {
  interaction: 'tap-line',
  difficulty_rating: 1950,
  prompt:
    'A customer with a real, priced item in their cart gets checked out for free. Tap the line responsible.',
  explanation:
    "`priceCatalog.get(sku)` returns `undefined` — not an error — for any SKU the catalog doesn't recognize (e.g. a product added to the cart before pricing synced). `undefined * quantity` then silently evaluates to `NaN` rather than throwing, so `computeLineTotal` returns `NaN` for that one line item. `computeOrderTotal` accumulates with `total += computeLineTotal(...)`, and once any addend is `NaN` the running sum is permanently `NaN` — the other, correctly-priced items don't rescue it. Finally, `checkout`'s guard `if (total > 0)` is `false` for `NaN` (every comparison with `NaN` is `false`), so the order silently falls into the `'free'` branch instead of throwing or flagging the missing price. No line in `checkout` or `computeOrderTotal` is wrong in isolation — the unchecked `undefined` from the catalog lookup is what turns a missing price into a free order three function calls later.",
  language: 'javascript',
  snippet: [
    'const priceCatalog = new Map([',
    "  ['sku-1', 12.5],",
    "  ['sku-2', 8.0],",
    '])',
    '',
    'function computeLineTotal(sku, quantity) {',
    '  const unitPrice = priceCatalog.get(sku)',
    '  return unitPrice * quantity',
    '}',
    '',
    'function computeOrderTotal(items) {',
    '  let total = 0',
    '  for (const item of items) {',
    '    total += computeLineTotal(item.sku, item.quantity)',
    '  }',
    '  return total',
    '}',
    '',
    'function checkout(cart) {',
    '  const total = computeOrderTotal(cart.items)',
    '  if (total > 0) {',
    "    return { status: 'charged', amount: total }",
    '  }',
    "  return { status: 'free', amount: 0 }",
    '}',
  ].join('\n'),
  correct_line: 6,
})

author('type-coercion', {
  interaction: 'tap-line',
  difficulty_rating: 1800,
  prompt:
    'This campaign summary overcounts how many distinct click-through ratios there really are. Tap the line responsible.',
  explanation:
    'When an event has zero impressions, `clicks / impressions` is `0 / 0`, which is `NaN` — a realistic outcome for any campaign event that was served but never viewed. `removeDuplicateRatios` tries to dedupe with `unique.indexOf(ratio) === -1`, but `Array.prototype.indexOf` uses strict equality (`===`) internally, and `NaN === NaN` is always `false`. So `indexOf` can never find a `NaN` it already pushed — every `NaN` ratio looks like a brand-new value and gets pushed again, while ordinary numeric duplicates (like two events with the same real ratio) are deduped correctly, since strict equality works fine for them. `distinct` ends up inflated by however many zero-impression events exist. `Array.prototype.includes`, which uses SameValueZero (treating `NaN` as equal to itself), would have deduped correctly here.',
  language: 'javascript',
  snippet: [
    'function computeRatios(events) {',
    '  return events.map((e) => e.clicks / e.impressions)',
    '}',
    '',
    'function removeDuplicateRatios(ratios) {',
    '  const unique = []',
    '  for (const ratio of ratios) {',
    '    if (unique.indexOf(ratio) === -1) {',
    '      unique.push(ratio)',
    '    }',
    '  }',
    '  return unique',
    '}',
    '',
    'function summarizeCampaign(events) {',
    '  const ratios = computeRatios(events)',
    '  const uniqueRatios = removeDuplicateRatios(ratios)',
    '  return {',
    '    total: ratios.length,',
    '    distinct: uniqueRatios.length,',
    '  }',
    '}',
  ].join('\n'),
  correct_line: 7,
})
