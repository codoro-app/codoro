# v6 misconception vocabulary consolidation — 2026-09-20

Companion to `docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md`
§3.2a and `docs/prompts/claude_code_prompt_v6_phase6_1_coach_surface.md` Piece 0.
Implements the amendment recorded in the spec: 6.0's free-form `misconception`
field produced 274 distinct non-filler labels across 292 entries — 96%
singletons, 11 ever reused — which cannot serve as 6.3's aggregation
taxonomy. This is a **relabel, not a regeneration**: every `why_wrong` string
is byte-identical to commit `f1a0b92` (6.0's ship commit); only the
`misconception` field on each entry changed.

## What changed

1. `src/content/misconceptions.ts` (new) — `MISCONCEPTION_SLUGS`, a locked
   40-label array (39 real misconceptions plus `not-the-bug-site`), and
   `MISCONCEPTION_LABELS`, human-readable glosses for the 6.3 diagnostic UI.
2. `src/content/explanationSchema.ts` — `ExplanationEntrySchema.misconception`
   changed from `z.string().regex(/^[a-z0-9-]{3,48}$/)` to
   `z.enum(MISCONCEPTION_SLUGS)`. Mechanical enforcement from here on; a
   future generation run structurally cannot reintroduce a singleton-label
   sprawl.
3. Every entry across all 99 files in `src/content/explanations/` had its
   `misconception` field rewritten to its canonical label — 292 non-filler
   entries changed, 453 `not-the-bug-site` filler entries untouched (already
   canonical), 745 entries total, 88 puzzle files touched, 11 pure-filler
   files untouched. Verified by diff against `f1a0b92`: every changed line is
   a `"misconception"` line, none touch `why_wrong`.
4. `src/content/tools/generateExplanations.ts` — the prompt's misconception
   rules now present the 40-label closed list (rendered from
   `misconceptions.ts`, never hand-duplicated) instead of free-form
   kebab-case guidance, with an explicit "pick the closest fit, never invent
   a new slug" instruction. `GENERATOR_VERSION` bumped 1 → 2 (the prompt
   changed materially).

## How the clustering was done

Per the spec: clustering worked over the label list and each label's
`why_wrong` text, not over the raw puzzle pool. Concretely — since 6.0
generates one LLM call per puzzle covering all of that puzzle's wrong
answers together, every non-filler entry within one puzzle's explanation
file already shares the same underlying bug and thus the same real-world
misconception. So the practical unit of clustering was **one canonical label
per puzzle** (88 puzzles → 39 labels, several puzzles sharing a label where
the underlying confusion repeats — e.g. every switch-fallthrough puzzle maps
to `break-doesnt-exit-as-expected` regardless of what each individual raw
label called it). This also explains why the same raw label text (e.g.
`blames-symptom-not-cause`, `off-by-one-inclusive-bound`) can map to
_different_ canonical slugs depending on which puzzle it came from — the raw
labels were never a real shared vocabulary to begin with, just
independently-invented text that sometimes happened to collide.

`not-the-bug-site` was kept verbatim, unclustered — at 453 of 745 entries
(60.8% of the whole library, but explicitly excluded from the "no label
dominates" check below since it's a different kind of signal, described in
`misconceptions.ts`'s own doc comment) it was already a real, singular,
correctly-reused label in 6.0.

## Final vocabulary, by entry count

| #   | Slug                                      | Entries | % of 292 non-filler                      |
| --- | ----------------------------------------- | ------- | ---------------------------------------- |
| —   | `not-the-bug-site`                        | 453     | n/a (filler, excluded from this ceiling) |
| 1   | `break-doesnt-exit-as-expected`           | 26      | 8.9%                                     |
| 2   | `resource-cleanup-not-guaranteed`         | 24      | 8.2%                                     |
| 3   | `shared-reference-not-independent-copy`   | 19      | 6.5%                                     |
| 4   | `recursion-never-reaches-base-case`       | 18      | 6.2%                                     |
| 5   | `shared-binding-not-fresh-per-use`        | 17      | 5.8%                                     |
| 6   | `silent-coercion-produces-wrong-result`   | 15      | 5.1%                                     |
| 7   | `hash-collection-contract-violation`      | 14      | 4.8%                                     |
| 8   | `unguarded-access-on-nullable-value`      | 13      | 4.5%                                     |
| 9   | `off-by-one-boundary-error`               | 13      | 4.5%                                     |
| 10  | `caught-error-silently-discarded`         | 11      | 3.8%                                     |
| 11  | `assumes-wrong-throw-behavior`            | 11      | 3.8%                                     |
| 12  | `non-atomic-counter-increment`            | 8       | 2.7%                                     |
| 13  | `closure-captures-stale-copy`             | 8       | 2.7%                                     |
| 14  | `unsynchronized-shared-state`             | 7       | 2.4%                                     |
| 15  | `dcl-missing-volatile`                    | 7       | 2.4%                                     |
| 16  | `parseint-truncates-not-rejects`          | 6       | 2.1%                                     |
| 17  | `nan-propagates-silently`                 | 6       | 2.1%                                     |
| 18  | `short-circuit-skips-side-effect`         | 5       | 1.7%                                     |
| 19  | `async-check-then-act-race`               | 4       | 1.4%                                     |
| 20  | `autobox-remove-overload-ambiguity`       | 4       | 1.4%                                     |
| 21  | `variable-unassigned-on-empty-path`       | 3       | 1.0%                                     |
| 22  | `run-called-instead-of-start`             | 3       | 1.0%                                     |
| 23  | `lock-ordering-deadlock`                  | 3       | 1.0%                                     |
| 24  | `wrong-end-of-structure-manipulated`      | 3       | 1.0%                                     |
| 25  | `boxed-integer-reference-equality`        | 3       | 1.0%                                     |
| 26  | `interrupt-status-mishandled`             | 3       | 1.0%                                     |
| 27  | `missing-range-boundary-check`            | 3       | 1.0%                                     |
| 28  | `length-check-doesnt-catch-whitespace`    | 3       | 1.0%                                     |
| 29  | `unbounded-buffer-overflow`               | 3       | 1.0%                                     |
| 30  | `shared-regex-lastindex-state`            | 3       | 1.0%                                     |
| 31  | `const-blocks-reassignment-not-mutation`  | 3       | 1.0%                                     |
| 32  | `falsy-value-treated-as-missing`          | 3       | 1.0%                                     |
| 33  | `assignment-instead-of-comparison`        | 3       | 1.0%                                     |
| 34  | `assumes-none-behaves-like-zero-or-valid` | 3       | 1.0%                                     |
| 35  | `block-scoped-variable-escapes-scope`     | 3       | 1.0%                                     |
| 36  | `missing-fstring-prefix`                  | 3       | 1.0%                                     |
| 37  | `float-binary-rounding-surprise`          | 3       | 1.0%                                     |
| 38  | `string-plus-int-typeerror`               | 3       | 1.0%                                     |
| 39  | `strict-equality-no-coercion`             | 2       | 0.7%                                     |

40 labels total (39 + `not-the-bug-site`), within the spec's "roughly 25–40"
target. Largest non-filler label is 8.9% of the non-filler pool — well under
the "no canonical label covers more than ~25%" DoD ceiling, so the
clustering did not collapse too far.

## Raw → canonical mapping

Every distinct raw (6.0) label, grouped under the canonical slug it was
folded into, with the puzzle(s) it came from. `(x2)`/`(x3)` marks a raw
label that appeared on more than one entry within the same puzzle (the
generator producing the same phrasing for more than one wrong answer in that
puzzle — not a cross-puzzle collision).

### `break-doesnt-exit-as-expected` — 26 entries

| Raw label (6.0)                    | Puzzle(s)   |
| ---------------------------------- | ----------- |
| `case-order-determines-match`      | cf-001      |
| `const-vs-let-confusion`           | cf-001      |
| `switch-string-comparison-doubt`   | cf-001      |
| `blames-loop-condition`            | cf-002      |
| `blames-inner-loop-bounds`         | cf-002      |
| `suspects-comparison-logic`        | cf-002      |
| `blames-overwrite-assignment`      | cf-002      |
| `blames-return-placement`          | cf-002      |
| `blames-switch-true-idiom`         | cf-003      |
| `const-vs-let-irrelevant`          | cf-003      |
| `boundary-operator-misdiagnosis`   | cf-003      |
| `blames-action-not-control-flow`   | cf-005      |
| `treats-every-break-as-suspect`    | cf-005 (x2) |
| `blames-symptom-not-cause`         | cf-005 (x2) |
| `blames-missing-default`           | cf-006      |
| `blames-unrelated-declaration`     | cf-006      |
| `break-placement-confusion`        | cf-006      |
| `continue-skips-element`           | cf-008      |
| `off-by-one-inclusive-bound`       | cf-008      |
| `assumes-let-uninitialized-throws` | cf-008      |
| `switch-coercion-confusion`        | cf-008      |
| `assumes-default-required`         | cf-028      |
| `treats-logic-bug-as-type-bug`     | cf-028      |
| `invents-syntax-constraint`        | cf-028      |

### `resource-cleanup-not-guaranteed` — 24 entries

| Raw label (6.0)                                  | Puzzle(s) |
| ------------------------------------------------ | --------- |
| `double-read-for-more-data`                      | res-001   |
| `return-value-confusion`                         | res-001   |
| `assumes-mode-arg-required`                      | res-001   |
| `blames-exception-trigger-not-cleanup-guard`     | res-003   |
| `blames-close-call-not-missing-with`             | res-003   |
| `blames-unreachable-cleanup-call`                | res-005   |
| `wrong-method-behavior-assumption`               | res-006   |
| `invented-encoding-issue`                        | res-006   |
| `wrong-fix-mode-instead-of-close`                | res-006   |
| `blames-exception-trigger-not-missing-guarantee` | res-007   |
| `blames-cleanup-call-not-missing-guarantee`      | res-007   |
| `charset-mistaken-for-resource-bug`              | res-013   |
| `performance-mistaken-for-resource-leak`         | res-013   |
| `double-close-misunderstanding`                  | res-013   |
| `malloc-zeroes-memory`                           | res-014   |
| `wrong-fix-allocator-swap`                       | res-014   |
| `assumes-callee-frees-pointer`                   | res-014   |
| `blames-resource-creation`                       | res-016   |
| `blames-read-call`                               | res-016   |
| `condition-blamed-not-missing-close`             | res-016   |
| `blames-happy-path-line`                         | res-016   |
| `single-close-call-blamed`                       | res-016   |
| `blames-post-close-return`                       | res-016   |
| `blames-caller-loop`                             | res-016   |

### `shared-reference-not-independent-copy` — 19 entries

| Raw label (6.0)                               | Puzzle(s)    |
| --------------------------------------------- | ------------ |
| `blames-defensive-copy-site`                  | mut-001      |
| `blames-call-site-reference-pass`             | mut-001      |
| `conflates-trigger-with-root-cause`           | mut-001      |
| `confuses-object-creation-with-copy`          | mut-003      |
| `blames-mutation-not-aliasing`                | mut-003      |
| `blames-call-site-not-implementation`         | mut-003      |
| `blames-trigger-not-cause`                    | mut-003      |
| `assumes-missing-initialization`              | mut-005      |
| `blames-loop-construct`                       | mut-005      |
| `reduce-to-scalar-workaround`                 | mut-005      |
| `confuses-append-return-with-function-return` | mut-022      |
| `irrelevant-hashability-concern`              | mut-022      |
| `assumes-loop-off-by-one`                     | mut-022      |
| `overgeneralized-shared-state`                | mut-028 (x2) |
| `blames-usage-not-declaration`                | mut-028 (x3) |
| `confuses-local-list-with-class-attr`         | mut-028      |

### `recursion-never-reaches-base-case` — 18 entries

| Raw label (6.0)                             | Puzzle(s) |
| ------------------------------------------- | --------- |
| `confuses-log-order-with-termination`       | rec-001   |
| `direction-not-termination`                 | rec-001   |
| `return-value-vs-termination`               | rec-001   |
| `confuses-output-order-with-termination`    | rec-002   |
| `mistakes-correctness-fix-for-performance`  | rec-002   |
| `assumes-missing-return-causes-crash`       | rec-002   |
| `overgeneralizes-infinite-recursion`        | rec-002   |
| `blames-step-not-guard`                     | rec-003   |
| `blames-caller-not-guard`                   | rec-003   |
| `wrong-base-case-boundary`                  | rec-004   |
| `rounding-fix-misapplied`                   | rec-004   |
| `is-vs-equality-confusion`                  | rec-004   |
| `confuses-stack-overflow-with-nan-coercion` | rec-006   |
| `blames-decrement-direction`                | rec-006   |
| `overflow-for-large-input`                  | rec-006   |
| `wrong-complexity-diagnosis`                | rec-024   |
| `assumes-fixed-width-int-overflow`          | rec-024   |
| `confuses-operator-with-termination`        | rec-024   |

### `shared-binding-not-fresh-per-use` — 17 entries

| Raw label (6.0)                               | Puzzle(s)        |
| --------------------------------------------- | ---------------- |
| `anon-function-cant-be-listener`              | scl-001          |
| `stale-collection-length`                     | scl-001          |
| `event-fires-before-increment`                | scl-001          |
| `concat-coerces-to-nan`                       | scl-001          |
| `wrong-bug-call-order`                        | scl-003          |
| `off-by-one-inclusive-bound`                  | scl-003, scl-006 |
| `wrong-fix-arrow-vs-var`                      | scl-003          |
| `wrong-variable-targeted-for-fix`             | scl-006          |
| `assumes-key-collision`                       | scl-006          |
| `believes-per-iteration-const-fixes-closure`  | scl-006          |
| `closure-captures-value-not-reference`        | scl-023          |
| `confuses-return-timing-with-closure-binding` | scl-023          |
| `assumes-closure-variable-goes-out-of-scope`  | scl-023          |
| `assumes-closure-isolates-state`              | scl-027          |
| `symptom-line-not-declaration`                | scl-027          |
| `reassignment-flagged-as-bug`                 | scl-027          |

### `silent-coercion-produces-wrong-result` — 15 entries

| Raw label (6.0)                                 | Puzzle(s)      |
| ----------------------------------------------- | -------------- |
| `assumes-mutation-is-the-bug`                   | tc-002         |
| `reverse-fixes-order-confusion`                 | tc-002         |
| `invents-throw-behavior`                        | tc-002         |
| `blames-mutation-not-comparator`                | tc-006, tc-008 |
| `avoids-builtin-instead-of-fixing-comparator`   | tc-006         |
| `assumes-type-error-instead-of-silent-coercion` | tc-006         |
| `overcorrects-avoids-builtin`                   | tc-008         |
| `invents-runtime-error`                         | tc-008         |
| `assumes-string-repeat-operator`                | tc-023         |
| `wrong-fix-type-conversion`                     | tc-023         |
| `bool-int-mult-raises-typeerror`                | tc-023         |
| `blames-nan-source`                             | tc-027         |
| `blames-call-not-implementation`                | tc-027         |
| `blames-symptom-not-cause`                      | tc-027         |

### `hash-collection-contract-violation` — 14 entries

| Raw label (6.0)                         | Puzzle(s)    |
| --------------------------------------- | ------------ |
| `overcorrects-structure-instead-of-key` | dsm-002      |
| `misidentifies-crashing-variable`       | dsm-002      |
| `assumes-equals-body-broken`            | dsm-003 (x3) |
| `blames-collection-choice`              | dsm-003      |
| `conflates-symptom-with-cause`          | dsm-003      |
| `blames-map-implementation`             | dsm-007      |
| `blames-initial-key-values`             | dsm-007      |
| `blames-insertion-not-mutation`         | dsm-007      |
| `blames-symptom-not-cause`              | dsm-007      |
| `blames-correct-hashcode-impl`          | dsm-007      |
| `blames-equals-type-check`              | dsm-007      |
| `blames-correct-equals-impl`            | dsm-007      |

### `unguarded-access-on-nullable-value` — 13 entries

| Raw label (6.0)                          | Puzzle(s)    |
| ---------------------------------------- | ------------ |
| `bracket-vs-dot-notation-confusion`      | nul-004      |
| `return-statement-mistaken-for-missing`  | nul-004      |
| `property-naming-red-herring`            | nul-004      |
| `defaults-treated-as-uniformly-safe`     | nul-006 (x2) |
| `assumes-default-exists`                 | nul-006      |
| `confuses-return-shorthand-with-default` | nul-006 (x3) |
| `crash-site-not-declaration-site`        | nul-006      |
| `false-deprecation-claim`                | nul-007      |
| `valid-syntax-misread`                   | nul-007      |
| `loose-equality-red-herring`             | nul-007      |

### `off-by-one-boundary-error` — 13 entries

| Raw label (6.0)                    | Puzzle(s) |
| ---------------------------------- | --------- |
| `assumes-builtin-needs-import`     | oob-001   |
| `slice-vs-index-rule-confusion`    | oob-001   |
| `harmless-shadowing-blamed`        | oob-001   |
| `blames-loop-body-not-bounds`      | oob-003   |
| `blames-syntax-style-not-value`    | oob-004   |
| `length-as-method-not-property`    | oob-004   |
| `assumes-missing-null-guard`       | oob-004   |
| `integer-division-rounding-blamed` | oob-006   |
| `comparison-direction-swapped`     | oob-006   |
| `return-value-contract-confusion`  | oob-006   |
| `fixes-start-instead-of-end-bound` | oob-023   |
| `shifts-index-instead-of-bound`    | oob-023   |
| `wrong-end-diagnosed-as-start`     | oob-023   |

### `caught-error-silently-discarded` — 11 entries

| Raw label (6.0)                          | Puzzle(s) |
| ---------------------------------------- | --------- |
| `blames-throwing-call`                   | err-002   |
| `blames-symptom-not-cause`               | err-002   |
| `sync-vs-async-red-herring`              | err-004   |
| `invents-unrelated-error`                | err-004   |
| `wrong-try-scope-focus`                  | err-004   |
| `confuses-load-with-dumps`               | err-015   |
| `doubts-with-statement-cleanup`          | err-015   |
| `misreads-try-scope`                     | err-015   |
| `wrong-return-type-assumed`              | err-016   |
| `invented-double-invocation-requirement` | err-016   |
| `missing-finally-assumed`                | err-016   |

### `assumes-wrong-throw-behavior` — 11 entries

| Raw label (6.0)                           | Puzzle(s) |
| ----------------------------------------- | --------- |
| `template-literal-throws-myth`            | err-006   |
| `fetch-rejects-on-http-error`             | err-006   |
| `await-causes-unhandled-rejection`        | err-006   |
| `assumes-cleanup-is-missing`              | err-007   |
| `invents-nonexistent-exception`           | err-007   |
| `assumes-typed-catch-clause`              | err-007   |
| `blames-await-for-uncaught-error`         | err-009   |
| `assumes-catch-cant-see-async-rejections` | err-009   |
| `conflates-precision-with-type-error`     | inp-012   |
| `misapplied-immutability-fix`             | inp-012   |
| `assumes-return-type-mismatch`            | inp-012   |

### `non-atomic-counter-increment` — 8 entries

| Raw label (6.0)                          | Puzzle(s) |
| ---------------------------------------- | --------- |
| `assumes-volatile-fixes-race`            | con-004   |
| `assumes-simple-read-is-unsafe`          | con-004   |
| `start-join-order-confusion`             | con-006   |
| `off-by-one-fencepost`                   | con-006   |
| `assumes-missing-join-sync`              | con-006   |
| `final-prevents-mutation`                | con-008   |
| `misreads-race-as-arithmetic-error`      | con-008   |
| `conflates-overflow-with-race-condition` | con-008   |

### `closure-captures-stale-copy` — 8 entries

| Raw label (6.0)              | Puzzle(s) |
| ---------------------------- | --------- |
| `blames-mutable-declaration` | scl-007   |
| `blames-correct-live-read`   | scl-007   |
| `blames-correct-mutation`    | scl-007   |
| `blames-returned-closure`    | scl-007   |
| `blames-interpolation-site`  | scl-007   |
| `blames-invocation-site`     | scl-007   |
| `blames-correct-update-call` | scl-007   |
| `blames-output-call-site`    | scl-007   |

### `unsynchronized-shared-state` — 7 entries

| Raw label (6.0)                      | Puzzle(s)    |
| ------------------------------------ | ------------ |
| `blames-check-then-act-branch`       | con-002      |
| `confuses-perf-with-safety`          | con-002      |
| `blames-operation-not-datastructure` | con-002 (x2) |
| `return-value-design-not-bug`        | mut-023      |
| `wrong-collection-type`              | mut-023      |
| `hallucinated-duplicate-declaration` | mut-023      |

### `dcl-missing-volatile` — 7 entries

| Raw label (6.0)                          | Puzzle(s) |
| ---------------------------------------- | --------- |
| `misreads-perf-optimization-as-bug`      | con-005   |
| `static-context-lock-target-confusion`   | con-005   |
| `mutex-contention-mistaken-for-deadlock` | con-005   |
| `singleton-caching-mistaken-for-bug`     | con-005   |
| `removes-dcl-perf-check`                 | con-007   |
| `misidentifies-bug-as-lock-scope`        | con-007   |
| `assumes-single-threaded-after-lock`     | con-007   |

### `parseint-truncates-not-rejects` — 6 entries

| Raw label (6.0)                   | Puzzle(s) |
| --------------------------------- | --------- |
| `isnan-catches-all-invalid`       | inp-002   |
| `misdiagnosed-range-check`        | inp-002   |
| `assumes-legacy-octal-parseint`   | inp-002   |
| `assumes-implicit-octal-parsing`  | inp-003   |
| `irrelevant-isnan-variant`        | inp-003   |
| `conflates-validator-with-parser` | inp-003   |

### `nan-propagates-silently` — 6 entries

| Raw label (6.0)                    | Puzzle(s) |
| ---------------------------------- | --------- |
| `blames-multiplication-not-lookup` | nul-013   |
| `blames-accumulation-not-source`   | nul-013   |
| `blames-assignment-not-source`     | nul-013   |
| `blames-nan-comparison-guard`      | nul-013   |
| `blames-untaken-branch`            | nul-013   |
| `blames-default-branch-not-source` | nul-013   |

### `short-circuit-skips-side-effect` — 5 entries

| Raw label (6.0)                 | Puzzle(s) |
| ------------------------------- | --------- |
| `blames-leading-condition`      | cf-032    |
| `blames-trailing-condition`     | cf-032    |
| `blames-log-statement`          | cf-032    |
| `blames-loop-filtering`         | cf-032    |
| `blames-eligibility-check-call` | cf-032    |

### `async-check-then-act-race` — 4 entries

| Raw label (6.0)                      | Puzzle(s) |
| ------------------------------------ | --------- |
| `race-blamed-on-cache-read`          | con-015   |
| `await-point-blamed-not-write-order` | con-015   |
| `dedupe-blamed-on-task-creation`     | con-015   |
| `concurrency-itself-blamed`          | con-015   |

### `autobox-remove-overload-ambiguity` — 4 entries

| Raw label (6.0)               | Puzzle(s) |
| ----------------------------- | --------- |
| `blames-list-declaration`     | dsm-028   |
| `assumes-add-remove-symmetry` | dsm-028   |
| `blames-signature-not-call`   | dsm-028   |
| `blames-call-site-argument`   | dsm-028   |

### `variable-unassigned-on-empty-path` — 3 entries

| Raw label (6.0)                   | Puzzle(s) |
| --------------------------------- | --------- |
| `wrong-comparison-operator-focus` | cf-027    |
| `performance-not-correctness`     | cf-027    |
| `reassignment-without-comparison` | cf-027    |

### `run-called-instead-of-start` — 3 entries

| Raw label (6.0)                       | Puzzle(s) |
| ------------------------------------- | --------- |
| `thread-name-required`                | con-010   |
| `confuses-run-and-start-restrictions` | con-010   |
| `invents-cleanup-leak-bug`            | con-010   |

### `lock-ordering-deadlock` — 3 entries

| Raw label (6.0)                    | Puzzle(s) |
| ---------------------------------- | --------- |
| `synchronization-seen-as-overhead` | con-013   |
| `volatile-fixes-atomicity`         | con-013   |
| `unrelated-overflow-bug`           | con-013   |

### `wrong-end-of-structure-manipulated` — 3 entries

| Raw label (6.0)              | Puzzle(s) |
| ---------------------------- | --------- |
| `misidentifies-buggy-method` | dsm-006   |
| `unrelated-init-choice`      | dsm-006   |
| `unnecessary-super-call`     | dsm-006   |

### `boxed-integer-reference-equality` — 3 entries

| Raw label (6.0)                                  | Puzzle(s) |
| ------------------------------------------------ | --------- |
| `reference-equality-mistaken-for-value-equality` | dsm-024   |
| `cache-range-confused-with-storage-limit`        | dsm-024   |
| `overgeneralized-integer-cache-behavior`         | dsm-024   |

### `interrupt-status-mishandled` — 3 entries

| Raw label (6.0)                        | Puzzle(s) |
| -------------------------------------- | --------- |
| `conflates-flag-with-interrupt-status` | err-018   |
| `blames-the-throwing-call`             | err-018   |
| `comment-not-code`                     | err-018   |

### `missing-range-boundary-check` — 3 entries

| Raw label (6.0)          | Puzzle(s) |
| ------------------------ | --------- |
| `fixates-on-upper-bound` | inp-006   |
| `wrong-parameter-blamed` | inp-006   |
| `blames-float-precision` | inp-006   |

### `length-check-doesnt-catch-whitespace` — 3 entries

| Raw label (6.0)             | Puzzle(s) |
| --------------------------- | --------- |
| `misreads-return-logic`     | inp-008   |
| `confuses-length-with-size` | inp-008   |
| `operator-swap-non-fix`     | inp-008   |

### `unbounded-buffer-overflow` — 3 entries

| Raw label (6.0)                            | Puzzle(s) |
| ------------------------------------------ | --------- |
| `conflates-performance-with-memory-safety` | inp-013   |
| `assumes-uninitialized-read-not-overflow`  | inp-013   |
| `wrong-format-specifier-type-mismatch`     | inp-013   |

### `shared-regex-lastindex-state` — 3 entries

| Raw label (6.0)                     | Puzzle(s)    |
| ----------------------------------- | ------------ |
| `blames-call-site-not-shared-state` | inp-015 (x2) |
| `blames-loop-for-alternation`       | inp-015      |

### `const-blocks-reassignment-not-mutation` — 3 entries

| Raw label (6.0)                   | Puzzle(s) |
| --------------------------------- | --------- |
| `wrong-array-method-for-position` | mut-007   |
| `fixes-return-not-aliasing`       | mut-007   |
| `const-prevents-mutation`         | mut-007   |

### `falsy-value-treated-as-missing` — 3 entries

| Raw label (6.0)                        | Puzzle(s) |
| -------------------------------------- | --------- |
| `operator-precedence-confusion`        | nul-001   |
| `property-access-throws-misconception` | nul-001   |
| `type-check-misdirection`              | nul-001   |

### `assignment-instead-of-comparison` — 3 entries

| Raw label (6.0)                          | Puzzle(s) |
| ---------------------------------------- | --------- |
| `conflates-null-check-with-length-check` | nul-002   |
| `assumes-missing-semicolon-error`        | nul-002   |
| `invents-variable-shadowing`             | nul-002   |

### `assumes-none-behaves-like-zero-or-valid` — 3 entries

| Raw label (6.0)                         | Puzzle(s) |
| --------------------------------------- | --------- |
| `assumes-len-defaults-to-zero`          | nul-011   |
| `wrong-type-not-missing-value`          | nul-011   |
| `conflates-exception-with-return-value` | nul-011   |

### `block-scoped-variable-escapes-scope` — 3 entries

| Raw label (6.0)                 | Puzzle(s) |
| ------------------------------- | --------- |
| `overlooks-existing-parameter`  | scl-008   |
| `misidentifies-magic-number`    | scl-008   |
| `assumes-missing-else-required` | scl-008   |

### `missing-fstring-prefix` — 3 entries

| Raw label (6.0)                        | Puzzle(s) |
| -------------------------------------- | --------- |
| `confuses-percent-format-with-fstring` | str-003   |
| `assumes-type-conversion-needed`       | str-003   |
| `overcorrects-with-unneeded-rewrite`   | str-003   |

### `float-binary-rounding-surprise` — 3 entries

| Raw label (6.0)               | Puzzle(s) |
| ----------------------------- | --------- |
| `tofixed-throws-on-negative`  | str-005   |
| `template-literal-needs-plus` | str-005   |
| `tofixed-always-truncates`    | str-005   |

### `string-plus-int-typeerror` — 3 entries

| Raw label (6.0)                       | Puzzle(s) |
| ------------------------------------- | --------- |
| `confuses-string-content-with-syntax` | str-013   |
| `quotes-variable-vs-literal`          | str-013   |
| `assumes-missing-return`              | str-013   |

### `strict-equality-no-coercion` — 2 entries

| Raw label (6.0)          | Puzzle(s) |
| ------------------------ | --------- |
| `blames-data-definition` | tc-004    |
| `blames-string-literal`  | tc-004    |

## Verification

- `pnpm validate:explanations` — see Phase 6.1's amendment for the pass/fail
  result at the time this batch was rewritten.
- `git diff f1a0b92 -- src/content/explanations/` — every changed line
  matches `"misconception":`; zero changed lines touch `why_wrong` or any
  other field. Proof command used: every non-`+++`/`---` changed line piped
  through `grep -v '"misconception"'` returns nothing.
- Largest canonical label is 8.9% of the non-filler pool (26/292,
  `break-doesnt-exit-as-expected`) — under the 25% re-split threshold.
