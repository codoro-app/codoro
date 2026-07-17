# Pattern taxonomy (DRAFT — needs your sign-off)

The 13 bug categories every puzzle is tagged with (`pattern` field in the content
schema). This is product identity — it defines what Codoro actually teaches —
so treat this as a starting draft to edit, not a locked decision. Once you're
happy with it, it becomes the Zod enum in `schema.ts`.

Design goals: each pattern should (1) be expressible across multiple languages
(JS/Python/Java/C), (2) span a genuinely wide difficulty range on its own — from
"obvious to a first-year student" to "misses even experienced engineers" — and
(3) map to something people actually want to get better at, not a CS-trivia
category nobody hires for.

1. **Off-by-one / boundary errors** — loop bounds, array indices, fencepost
   errors, `<` vs `<=`.
2. **Null / undefined / None handling** — missing checks, unsafe access
   chains, assuming a value exists.
3. **Type coercion & comparison** — `==` vs `===`, implicit casts,
   truthy/falsy traps.
4. **Mutable state & aliasing** — shared references, mutable default
   arguments, in-place mutation the caller didn't expect.
5. **Scope & closures** — loop-variable capture, hoisting, variable
   shadowing.
6. **Concurrency & race conditions** — async ordering, shared state without
   synchronization, check-then-act races.
7. **Resource management** — unclosed files/connections, missing cleanup,
   leaks.
8. **Error handling** — swallowed exceptions, catch at the wrong scope,
   unhandled promise rejections.
9. **Recursion & termination** — missing or wrong base case, unbounded
   recursion, infinite loops.
10. **Data structure misuse** — wrong structure for the job (linear scan
    where a set/map belongs), mutating a collection while iterating it.
11. **String & formatting** — slicing/substring off-by-ones, encoding
    assumptions, string-immutability mistakes in the wrong language.
12. **Input validation** — trusting untrusted input, missing bounds/format
    checks, injection-shaped bugs (conceptual — not exploit writing).
13. **Logic & control flow** — inverted conditionals, operator precedence,
    missing/duplicate `break` or `return`, fallthrough.

## Open questions for you

- Any category here that doesn't match what you actually want to teach, or
  that's too niche to hit 8+ puzzles (the Phase 8 DoD minimum per pattern)?
- Anything missing that's a "everyone I know has shipped this bug" category?
  (Candidates I cut for overlap: memory management as its own category —
  folded into resource management; algorithmic complexity as its own
  category — felt more like a code-review skill than a "spot the bug" one.)
- Pattern names double as UI copy (browse-by-pattern, per-pattern mastery
  view) — flag anything that reads awkwardly to a user.
