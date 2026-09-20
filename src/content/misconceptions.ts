/**
 * The locked misconception vocabulary every wrong-answer explanation's
 * `misconception` field is drawn from — v6 Phase 6.1's consolidation of the
 * free-form field 6.0 shipped. Modelled directly on patterns.ts: a locked
 * slug array is the single source of truth `explanationSchema.ts`'s
 * `z.enum(MISCONCEPTION_SLUGS)` is built from, plus human-readable labels for
 * the 6.3 diagnostic UI.
 *
 * See docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md
 * §3.2a and docs/v6-misconception-vocabulary-2026-09-20.md for how this list
 * was derived: 6.0's free-form generation produced 274 non-filler labels
 * across 292 entries (96% singletons — unusable as an aggregation taxonomy),
 * clustered here into 39 canonical labels plus `not-the-bug-site`. Unlike
 * `patterns.ts`, this is not a product-identity decision requiring a content
 * commitment per addition — it's a generated-content taxonomy, expected to
 * evolve slower than puzzle content but faster than the pattern list.
 *
 * `not-the-bug-site` is first-class, not filler swept under a separate case:
 * at 452 of 745 6.0 entries it is the single most common label by a wide
 * margin, and a real signal — a player who repeatedly taps unrelated lines
 * on tap-line puzzles is not reading the snippet, not "unlucky."
 */

export const MISCONCEPTION_SLUGS = [
  'not-the-bug-site',
  'break-doesnt-exit-as-expected',
  'short-circuit-skips-side-effect',
  'variable-unassigned-on-empty-path',
  'unsynchronized-shared-state',
  'non-atomic-counter-increment',
  'dcl-missing-volatile',
  'run-called-instead-of-start',
  'lock-ordering-deadlock',
  'async-check-then-act-race',
  'hash-collection-contract-violation',
  'wrong-end-of-structure-manipulated',
  'boxed-integer-reference-equality',
  'autobox-remove-overload-ambiguity',
  'caught-error-silently-discarded',
  'assumes-wrong-throw-behavior',
  'interrupt-status-mishandled',
  'parseint-truncates-not-rejects',
  'missing-range-boundary-check',
  'length-check-doesnt-catch-whitespace',
  'unbounded-buffer-overflow',
  'shared-regex-lastindex-state',
  'shared-reference-not-independent-copy',
  'const-blocks-reassignment-not-mutation',
  'falsy-value-treated-as-missing',
  'assignment-instead-of-comparison',
  'unguarded-access-on-nullable-value',
  'assumes-none-behaves-like-zero-or-valid',
  'nan-propagates-silently',
  'off-by-one-boundary-error',
  'recursion-never-reaches-base-case',
  'resource-cleanup-not-guaranteed',
  'shared-binding-not-fresh-per-use',
  'closure-captures-stale-copy',
  'block-scoped-variable-escapes-scope',
  'silent-coercion-produces-wrong-result',
  'strict-equality-no-coercion',
  'missing-fstring-prefix',
  'float-binary-rounding-surprise',
  'string-plus-int-typeerror',
] as const

export type MisconceptionSlug = (typeof MISCONCEPTION_SLUGS)[number]

/** Human-readable label per misconception, for the 6.3 diagnostic UI. */
export const MISCONCEPTION_LABELS: Record<MisconceptionSlug, string> = {
  'not-the-bug-site': "Points at a line that isn't the bug",
  'break-doesnt-exit-as-expected': 'Misjudges what `break` exits',
  'short-circuit-skips-side-effect': 'Misses that `&&`/`||` short-circuits',
  'variable-unassigned-on-empty-path': 'Misses an unassigned-variable path',
  'unsynchronized-shared-state': 'Assumes a shared collection is thread-safe',
  'non-atomic-counter-increment': 'Assumes `x++` is one atomic step',
  'dcl-missing-volatile': 'Misses a missing visibility guard between threads',
  'run-called-instead-of-start': 'Confuses calling a method with starting a thread',
  'lock-ordering-deadlock': 'Misses a lock-ordering deadlock',
  'async-check-then-act-race': 'Misses a check-then-act race across an `await`',
  'hash-collection-contract-violation': 'Misses a broken equals/hashCode contract',
  'wrong-end-of-structure-manipulated': 'Confuses which end of a structure is touched',
  'boxed-integer-reference-equality': 'Compares boxed numbers by reference, not value',
  'autobox-remove-overload-ambiguity': 'Misses an autoboxing overload trap',
  'caught-error-silently-discarded': 'Assumes a caught error was handled',
  'assumes-wrong-throw-behavior': 'Wrong about what actually throws or rejects',
  'interrupt-status-mishandled': "Mishandles a thread's interrupt status",
  'parseint-truncates-not-rejects': 'Assumes parsing rejects bad input instead of truncating it',
  'missing-range-boundary-check': 'Misses one side of a range check',
  'length-check-doesnt-catch-whitespace': 'Misses that a length check lets whitespace through',
  'unbounded-buffer-overflow': 'Misses an unbounded buffer write',
  'shared-regex-lastindex-state': 'Misses shared regex state carrying over between calls',
  'shared-reference-not-independent-copy': "Assumes a copy is independent when it's shared",
  'const-blocks-reassignment-not-mutation':
    'Assumes `const` blocks mutation, not just reassignment',
  'falsy-value-treated-as-missing': 'Treats a valid falsy value as missing',
  'assignment-instead-of-comparison': 'Misses `=` where `==`/`===` was meant',
  'unguarded-access-on-nullable-value': 'Accesses a value with no null/undefined guard',
  'assumes-none-behaves-like-zero-or-valid': 'Assumes null/None behaves like a valid value',
  'nan-propagates-silently': 'Misses NaN propagating silently through arithmetic',
  'off-by-one-boundary-error': 'Off-by-one at a loop or index boundary',
  'recursion-never-reaches-base-case': 'Misses why the recursion never reaches its base case',
  'resource-cleanup-not-guaranteed': "Assumes cleanup runs on every path, even when it doesn't",
  'shared-binding-not-fresh-per-use': 'Assumes a variable is fresh per iteration/instance',
  'closure-captures-stale-copy': 'Assumes a closure sees a live value, not a stale copy',
  'block-scoped-variable-escapes-scope': 'Assumes a block-scoped variable is visible outside it',
  'silent-coercion-produces-wrong-result': 'Misses a silent type coercion',
  'strict-equality-no-coercion': 'Expects coercion where strict equality applies',
  'missing-fstring-prefix': 'Misses a missing string-interpolation prefix',
  'float-binary-rounding-surprise': 'Misses a binary floating-point rounding surprise',
  'string-plus-int-typeerror': 'Assumes string + number concatenation always works',
}
