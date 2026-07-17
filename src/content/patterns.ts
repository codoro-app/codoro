/**
 * The locked bug-pattern taxonomy every puzzle is tagged with. Single source
 * of truth: PATTERNS.md documents the reasoning behind this list; this file
 * is the machine-readable form schema.ts's `pattern` enum is built from.
 *
 * Product-identity decision, not a mechanical one — see PATTERNS.md before
 * changing this list. Every pattern needs at least 8 puzzles spanning an
 * 800-point difficulty range (Phase 8 DoD), so adding one is a real content
 * commitment, not a free edit.
 */

export const PATTERN_SLUGS = [
  'off-by-one',
  'null-undefined',
  'type-coercion',
  'mutable-state',
  'scope-closures',
  'concurrency',
  'resource-management',
  'error-handling',
  'recursion-termination',
  'data-structure-misuse',
  'string-formatting',
  'input-validation',
  'control-flow',
] as const

export type PatternSlug = (typeof PATTERN_SLUGS)[number]

/** Human-readable label per pattern, for UI copy (browse-by-pattern, mastery view). */
export const PATTERN_LABELS: Record<PatternSlug, string> = {
  'off-by-one': 'Off-by-one / boundary errors',
  'null-undefined': 'Null / undefined / None handling',
  'type-coercion': 'Type coercion & comparison',
  'mutable-state': 'Mutable state & aliasing',
  'scope-closures': 'Scope & closures',
  concurrency: 'Concurrency & race conditions',
  'resource-management': 'Resource management',
  'error-handling': 'Error handling',
  'recursion-termination': 'Recursion & termination',
  'data-structure-misuse': 'Data structure misuse',
  'string-formatting': 'String & formatting',
  'input-validation': 'Input validation',
  'control-flow': 'Logic & control flow',
}
