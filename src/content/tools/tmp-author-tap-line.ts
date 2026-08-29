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

// Batch 2: mutable-state, recursion-termination, string-formatting (all Python)

author('mutable-state', {
  interaction: 'tap-line',
  difficulty_rating: 1700,
  prompt: "Bob's cart shows items he never added. Tap the line responsible.",
  explanation:
    "`items = []` at the top of the class body creates a single list owned by the class itself, not by each instance — `__init__` never assigns `self.items`, so there is no per-instance list to shadow it. When `add_item` runs `self.items.append(item)`, Python's attribute lookup finds no `items` on the instance and falls back to the class attribute, then mutates that shared list *in place*. Because it's a mutation (`.append`), not a reassignment (`self.items = ...`), every `ShoppingCart` instance keeps reading and writing the exact same list. So `alice_cart.add_item(...)` silently adds items to `bob_cart.items` too, even though the two carts were constructed independently and `discount_applied` (a real per-instance attribute, correctly assigned in `__init__`) behaves exactly as expected — a working contrast that makes the shared list easy to miss on a first read.",
  language: 'python',
  snippet: [
    'class ShoppingCart:',
    '    items = []',
    '',
    '    def __init__(self, owner):',
    '        self.owner = owner',
    '        self.discount_applied = False',
    '',
    '    def add_item(self, item):',
    '        self.items.append(item)',
    '',
    '    def apply_discount(self, code):',
    "        if code == 'SAVE10':",
    '            self.discount_applied = True',
    '',
    '    def total_items(self):',
    '        return len(self.items)',
    '',
    '',
    'def checkout_all(carts):',
    '    receipts = []',
    '    for cart in carts:',
    '        receipts.append({',
    "            'owner': cart.owner,",
    "            'item_count': cart.total_items(),",
    '        })',
    '    return receipts',
  ].join('\n'),
  correct_line: 1,
})

author('recursion-termination', {
  interaction: 'tap-line',
  difficulty_rating: 1800,
  prompt:
    'This recursive-descent parser hangs (stack overflow) on any expression with a unary minus. Tap the line responsible.',
  explanation:
    "`parse_expr` and `parse_term` both advance `pos` correctly before recursing further down. `parse_factor` does too for a parenthesized group (`pos += 1` right after seeing `'('`). But the unary-minus branch — meant to let `-5` parse as \"negate the factor that follows\" — calls `parse_factor(tokens, pos)` again on the exact same `pos` it was given, without ever consuming the `'-'` token first. So the recursive call sees `tokens[pos] == '-'` again, takes the same branch, and calls itself again at the same `pos` — forever. Every expression without a unary minus parses correctly, because that branch is never taken; the base cases and the binary-operator loops are all fine on their own. The fix is `return parse_factor(tokens, pos + 1)` so each recursive call actually makes progress through the token stream.",
  language: 'python',
  snippet: [
    'def parse_expr(tokens, pos):',
    '    left, pos = parse_term(tokens, pos)',
    "    while pos < len(tokens) and tokens[pos] in ('+', '-'):",
    '        op = tokens[pos]',
    '        pos += 1',
    '        right, pos = parse_term(tokens, pos)',
    '        left = (op, left, right)',
    '    return left, pos',
    '',
    '',
    'def parse_term(tokens, pos):',
    '    left, pos = parse_factor(tokens, pos)',
    "    while pos < len(tokens) and tokens[pos] == '*':",
    '        pos += 1',
    '        right, pos = parse_factor(tokens, pos)',
    "        left = ('*', left, right)",
    '    return left, pos',
    '',
    '',
    'def parse_factor(tokens, pos):',
    "    if tokens[pos] == '(':",
    '        pos += 1',
    '        expr, pos = parse_expr(tokens, pos)',
    "        if tokens[pos] != ')':",
    "            raise ValueError('expected )')",
    '        return expr, pos + 1',
    "    if tokens[pos] == '-':",
    '        return parse_factor(tokens, pos)',
    '    value = tokens[pos]',
    '    return value, pos + 1',
  ].join('\n'),
  correct_line: 27,
})

author('string-formatting', {
  interaction: 'tap-line',
  difficulty_rating: 1700,
  prompt:
    'This greeting builder mangles perfectly ordinary names that never had a title. Tap the line responsible.',
  explanation:
    '`str.strip(chars)` does not remove a prefix substring — it repeatedly removes any *characters* found in `chars` from both ends, in any order, until it hits one that isn\'t. `TITLE_CHARS` is `"Mr. Mrs. Ms. Dr. "`, so the effective strip set is just the letters `{M, r, s, D, ., space}`. A name like `"Ross"` has no title at all, but its trailing `\'s\'` and `\'s\'` are both in that set, so `.strip(TITLE_CHARS)` eats them from the right and returns `"Ro"`. `"Maria"` loses its leading `\'M\'` and becomes `"aria"`. Names built entirely from letters outside that set (like `"Sam"`... except `s`/`S`\'s case matters too) pass through untouched, which is exactly what makes this so easy to miss in testing — some names look fine, and the ones that break look like a totally unrelated data problem, not a formatting bug.',
  language: 'python',
  snippet: [
    'TITLE_CHARS = "Mr. Mrs. Ms. Dr. "',
    '',
    '',
    'def format_display_name(raw_name):',
    '    """Strip a leading title so we can display the plain name."""',
    '    trimmed = raw_name.strip()',
    '    without_title = trimmed.strip(TITLE_CHARS)',
    '    return without_title.title()',
    '',
    '',
    'def build_greeting(raw_name):',
    '    name = format_display_name(raw_name)',
    '    return f"Welcome, {name}!"',
    '',
    '',
    'def build_roster_greetings(raw_names):',
    '    greetings = []',
    '    for raw_name in raw_names:',
    '        greetings.append(build_greeting(raw_name))',
    '    return greetings',
  ].join('\n'),
  correct_line: 6,
})
