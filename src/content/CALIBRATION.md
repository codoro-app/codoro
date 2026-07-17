# Difficulty calibration rubric (DRAFT)

## Why not topic × line count

First pass considered scoring difficulty from surface features — pattern
category and snippet length. Rejected for two reasons:

- **Pattern and difficulty have to be independent.** Phase 8's DoD requires
  every pattern to span at least an 800-point difficulty range on its own
  (e.g. "arrays" needs both a ~900 puzzle and a ~1900 puzzle). If pattern sets
  the base score, you structurally can't hit that spread — the category would
  be doing the job difficulty is supposed to do.
- **Line count doesn't track difficulty, and sometimes runs backwards.** The
  nastiest bugs in this genre are usually short — a mutable default argument,
  `==` vs `===`, a stale closure over a loop variable — hard precisely because
  there's little surrounding context to hint at what's wrong. A longer
  snippet with an obviously misplaced bug is often _easier_ to spot, since
  there's more normal-looking code framing it.

Difficulty here comes from the same place it does in any "find the flaw"
format: how much specific knowledge the bug requires, how much mental
execution it takes to see it, how convincing the wrong answers are, and
whether it only shows up under a specific case. Those are judgment calls, not
things you compute from the code.

## The four dimensions

Score each 1 (low) to 5 (high):

- **S — Semantic subtlety.** How much specific language/domain knowledge is
  required. 1 = obvious to anyone reading carefully (a glaring logic flip). 5
  = requires knowing a specific, easy-to-miss gotcha (Python's mutable
  default arguments, JS microtask ordering, C undefined behavior).
- **T — Trace complexity.** How much mental state-tracking or execution is
  needed. 1 = visible by inspection, no need to "run" the code in your head.
  5 = requires tracing multiple variables across several iterations or
  branches before the failure becomes visible.
- **D — Distractor quality.** How plausible the wrong answers/lines are (for
  `mcq`/`tap-line`) or how tempting the wrong side is (for `swipe-binary`). 1
  = wrong answers are obviously wrong. 5 = wrong answers require careful,
  deliberate discrimination from the right one.
- **C — Context dependence.** Whether the bug always fires or only under a
  specific case. 1 = broken regardless of input. 5 = only breaks on a
  specific edge case (empty input, concurrent access, overflow) that has to
  be considered explicitly.

## Mapping to a rating

```
sum = S + T + D + C          // ranges 4-20
rating = 800 + (sum - 4) * 100   // ranges 800-2400
```

Round to the nearest 25 or 50. Treat this as a starting point, not a verdict
— sanity-check it against the worked examples below before committing to a
number, and remember the real test is Phase 8's spot-check (15 random
puzzles, blind re-estimate, ≥12 within ±200 of the assigned rating).

### swipe-binary modifier

Swipe-binary puzzles have a 50% guess floor built in — someone who knows
nothing can still flick the right direction half the time. If rated at face
value, their _empirical_ pass rate will look easier than the puzzle actually
is, which quietly corrupts the Elo signal for that puzzle (Elo assumes
correct-answer rate reflects skill; guessing inflates it). Per the build
plan: calibrate these **harder than they look**. Add a flat **+150 to +200**
to whatever the formula above gives for any `swipe-binary` puzzle testing an
equivalent concept to an `mcq`/`tap-line` puzzle.

## Worked examples

### Low band (~950-1050)

```js
function sumFirstN(arr, n) {
  let sum = 0
  for (let i = 0; i <= n; i++) {
    sum += arr[i]
  }
  return sum
}
```

Bug: `i <= n` should be `i < n` — reads past the intended range.

S=1 (a well-known error shape, no special knowledge needed) · T=1 (visible
by inspection, no tracing required) · D=2 (wrong MCQ choices would be
somewhat plausible but not tricky) · C=2 (fires for essentially any call) →
sum=6 → **rating ≈ 1000**

### Mid band (~1600-1700)

```python
def add_item(item, basket=[]):
    basket.append(item)
    return basket
```

Bug: the default `[]` is evaluated once at function definition and shared
across every call that omits the argument — state leaks between calls that
look independent.

S=4 (requires knowing this specific Python semantic) · T=3 (only visible
across multiple calls, not from reading one) · D=3 (moderate — MCQ choices
about "shared state across calls" vs generic mutability need real
discrimination) · C=3 (only manifests when the caller omits the argument
repeatedly) → sum=13 → **rating ≈ 1700**

### High band (~2050-2150)

```js
async function reserveSeat(seatId) {
  const seat = await db.getSeat(seatId)
  if (seat.available) {
    await db.bookSeat(seatId, currentUser)
  }
}
```

Bug: check-then-act race — between the two `await`s, a concurrent request can
book the same seat; there's no atomic check-and-set.

S=5 (requires concurrency reasoning, easy to miss without that background) ·
T=4 (requires imagining two interleaved executions, real mental simulation)
· D=4 (looks completely correct in a single-threaded read; distractors about
`await` ordering would be tempting) · C=4 (only manifests under concurrent
access — a sequential trace looks fine) → sum=17 → **rating ≈ 2100**

## Open questions for you

- Are S/T/D/C weighted right, or should one dimension count more (e.g.
  semantic subtlety mattering more than context dependence for this
  audience)?
- Worked examples above are all JS/Python — want one in Java or C anchored
  too, given the stack you're targeting?
- The swipe-binary modifier is a flat add — fine as a first pass, but you may
  want to revisit after the first real batch of swipe-binary puzzles gets
  played, once there's actual pass-rate data to check it against.
