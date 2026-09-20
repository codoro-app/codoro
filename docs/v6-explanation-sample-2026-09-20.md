# Wrong-answer explanation sample — 20-entry stratified read

**This read is outstanding.** This file was staged by the session that generated the batch, per
`docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md` §8: "the generating session
must not be the grading session." Nothing below has been graded. The read is Thomas's (or a
fresh-context session's) action item, not something this session performed.

**The bar:** if more than 2 of the 20 entries below are substantively wrong (a confident but false
claim about language semantics, a claim that contradicts the puzzle's own `explanation` field, or
similar), the generation prompt is broken — fix `generateExplanations.ts`'s system prompt and
regenerate the whole batch, rather than hand-patching individual files. Record here, once read: how
many were read, how many were wrong, what kind of wrong, and what was regenerated.

## How this sample was drawn

20 entries, one wrong-answer explanation per entry, stratified across:

- **Pattern** — all 13 patterns in `src/content/patterns.ts` appear at least once (10 via the mcq
  half, 10 via the tap-line half, chosen so the two halves' pattern coverage overlaps in the middle
  and together span all 13).
- **Difficulty band** — 6 low (800-1299), 8 mid (1300-1799), 6 high (1800-2400), picked greedily to
  keep the three bands close to even.
- **Interaction type** — 10 mcq, 10 tap-line (both interactions in the first batch; swipe-binary
  wasn't generated this session).

Within each selected puzzle, one entry was picked: for mcq, the puzzle's first wrong choice by
canonical index; for tap-line, ordinarily a substantive (non-filler) entry, except three tap-line
rows below (marked) were deliberately forced to a `not-the-bug-site` filler entry so the reviewer
also sees that convention (spec §4.4) represented in the sample, not just the substantive entries.

Selection was mechanical (a local script reading the real generated files, zero LLM calls) — nobody
picked favorites.

## Verdict legend

Fill in one of **OK** / **WRONG** / **BORDERLINE** per row, plus a one-line note if not OK.

---

### 1. `oob-001` — off-by-one / mcq / difficulty 900

**Snippet** (python):

```python
def get_last_element(items):
    return items[len(items)]
```

**Correct answer:** `len(items)` is one past the last valid index, so this raises an IndexError
instead of returning the last element

**Wrong answer being explained:** The function forgot to import the `len` builtin before using it

**Generated `why_wrong`:** `len` is a builtin that's always available — Python never requires an
import for it, so that's not what's throwing here. The actual failure is that `len(items)` is one
past the last valid index, so indexing with it raises an IndexError.

**Generated `misconception`:** `assumes-builtin-needs-import`

**Verdict:** _(pending)_

---

### 2. `nul-001` — null-undefined / mcq / difficulty 1300

**Snippet** (javascript):

```javascript
function getTimeout(config) {
  const timeout = config.timeout || 5000
  return timeout
}
```

**Correct answer:** `config.timeout || 5000` falls back to 5000 whenever `config.timeout` is
falsy, so an explicitly set `timeout: 0` gets silently overridden to 5000

**Wrong answer being explained:** `config.timeout || 5000` evaluates `5000` first due to operator
precedence, so `timeout` is always 5000

**Generated `why_wrong`:** That's not how `||` works — it doesn't evaluate the right operand first
based on precedence; it evaluates `config.timeout` first and only reaches `5000` if that value is
falsy. So `timeout` isn't "always 5000", it's whatever was passed in unless that value is falsy,
which is exactly the trap: a passed-in `0` is falsy too, so it gets replaced with `5000` even
though the caller meant it.

**Generated `misconception`:** `operator-precedence-confusion`

**Verdict:** _(pending)_

---

### 3. `tc-002` — type-coercion / mcq / difficulty 1200

**Snippet** (javascript):

```javascript
function sortScores(scores) {
  return scores.sort()
}

console.log(sortScores([10, 2, 33, 4]))
```

**Correct answer:** `sort()` with no comparator converts elements to strings and sorts
lexicographically, so a numeric array like `[10, 2, 33, 4]` ends up in the wrong order

**Wrong answer being explained:** `sort()` mutates the original array in place instead of
returning a new array, which silently changes the caller's reference

**Generated `why_wrong`:** In-place mutation is real but harmless here since the result is
reassigned and used directly; that's not what makes the output wrong. The actual problem is that
`sort()` with no comparator compares elements as strings, so it garbles the numeric order
regardless of whether it mutates or copies.

**Generated `misconception`:** `assumes-mutation-is-the-bug`

**Verdict:** _(pending)_

---

### 4. `mut-005` — mutable-state / mcq / difficulty 1400

**Snippet** (javascript):

```javascript
function processOrders(orders) {
  const summary = { total: 0, items: [] }
  const results = []
  for (const order of orders) {
    summary.items.push(order.id)
    summary.total += order.amount
    results.push(summary)
  }
  return results
}
```

**Correct answer:** The same `summary` object is aliased and pushed into `results` each
iteration, so all entries end up referencing the final accumulated state

**Wrong answer being explained:** `summary.total` is never initialized before the loop, causing
`NaN` to accumulate

**Generated `why_wrong`:** `summary.total` is initialized to `0` right where `summary` is
declared, so there's no `NaN` here — the numbers accumulate correctly. The real problem is that
every push into `results` stores a reference to that one shared object, so all entries end up
showing the same final total once the loop finishes.

**Generated `misconception`:** `assumes-missing-initialization`

**Verdict:** _(pending)_

---

### 5. `scl-001` — scope-closures / mcq / difficulty 1300

**Snippet** (javascript):

```javascript
function setupHandlers() {
  const buttons = document.querySelectorAll('.btn')
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function () {
      console.log('Button ' + i + ' clicked')
    })
  }
}
```

**Correct answer:** `var i` is shared across all loop iterations, so every click handler closes
over the same variable and logs its final value after the loop ends

**Wrong answer being explained:** addEventListener does not support anonymous functions as
listeners, so the handlers silently fail to bind correctly

**Generated `why_wrong`:** Anonymous functions are completely valid event listeners —
`addEventListener` binds them just fine, and they'd log correctly if `i` itself pointed to the
right value. The real issue is that `var i` is shared by every iteration, so every one of those
anonymous functions closes over the same final value of `i` instead of failing to bind.

**Generated `misconception`:** `anon-function-cant-be-listener`

**Verdict:** _(pending)_

---

### 6. `con-005` — concurrency / mcq / difficulty 1800

**Snippet** (java):

```java
public class Singleton {
  private static Singleton instance;

  public static Singleton getInstance() {
    if (instance == null) {
      synchronized (Singleton.class) {
        if (instance == null) {
          instance = new Singleton();
        }
      }
    }
    return instance;
  }
}
```

**Correct answer:** The `instance` field is not declared `volatile`, so a thread can observe a
non-null but partially constructed object due to instruction reordering

**Wrong answer being explained:** The outer null check is redundant and should be removed for
correctness

**Generated `why_wrong`:** The outer check isn't the problem — it's actually the whole point of
the pattern, letting most calls skip the synchronized block once `instance` is set. Removing it
would force every call through synchronization forever, which is a performance regression, not a
fix; the real defect is that the field lacks `volatile` so the outer read can see a half-built
object.

**Generated `misconception`:** `misreads-perf-optimization-as-bug`

**Verdict:** _(pending)_

---

### 7. `res-001` — resource-management / mcq / difficulty 900

**Snippet** (python):

```python
def read_config(path):
    f = open(path)
    data = f.read()
    return data
```

**Correct answer:** The file handle is never closed, leaking a file descriptor

**Wrong answer being explained:** `f.read()` should be called twice to get all the data

**Generated `why_wrong`:** Calling `f.read()` again won't pull in more data — the first call
already reads the file to its end, so a second call just returns an empty string. The actual
defect here isn't about how much gets read, it's that the file object itself is never closed after
`read()` finishes.

**Generated `misconception`:** `double-read-for-more-data`

**Verdict:** _(pending)_

---

### 8. `err-004` — error-handling / mcq / difficulty 1000

**Snippet** (javascript):

```javascript
function readFile(path) {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch (e) {}
}
```

**Correct answer:** The catch block swallows the error silently, so a failed read returns
undefined instead of surfacing the failure

**Wrong answer being explained:** fs.readFileSync should be replaced with the asynchronous
fs.readFile for better performance

**Generated `why_wrong`:** Swapping in the async `fs.readFile` is a performance/style choice, not
a fix for this bug — the sync call itself isn't broken. The actual defect is that any error it
throws gets caught and discarded, so an async version with an empty callback error handler would
have the exact same silent-failure problem.

**Generated `misconception`:** `sync-vs-async-red-herring`

**Verdict:** _(pending)_

---

### 9. `rec-004` — recursion-termination / mcq / difficulty 1800

**Snippet** (python):

```python
def binary_search(arr, target, low, high):
    if low > high:
        return -1
    mid = (low + high) // 2
    if arr[mid] == target:
        return mid
    elif arr[mid] < target:
        return binary_search(arr, target, mid, high)
    else:
        return binary_search(arr, target, low, mid - 1)
```

**Correct answer:** The recursive call for the "search right half" branch passes `mid` instead of
`mid + 1` as the new `low`, so when `low == high == mid` the arguments never change and the
recursion never terminates

**Wrong answer being explained:** The base case should be `low >= high` instead of `low > high`,
or the function will raise an IndexError on empty arrays

**Generated `why_wrong`:** The `low > high` base case is actually fine — it's precisely the
condition that should eventually fire once the search range shrinks to nothing. Tightening it to
`low >= high` wouldn't fix anything here; the real defect is that the right-half branch passes
`mid` back as `low` instead of `mid + 1`, so that crossing point never gets reached.

**Generated `misconception`:** `wrong-base-case-boundary`

**Verdict:** _(pending)_

---

### 10. `dsm-024` — data-structure-misuse / mcq / difficulty 1475

**Snippet** (java):

```java
Integer a = 1000;
Integer b = 1000;
boolean eq = (a == b);
```

**Correct answer:** `==` compares references, and 1000 is outside the Integer cache, so `eq` is
false despite equal values — use `.equals()`

**Wrong answer being explained:** `==` always compares Integer values correctly

**Generated `why_wrong`:** That's true for primitive `int`, but `a` and `b` here are boxed
`Integer` objects, so `==` checks whether they're the same object in memory, not whether they hold
the same number. Two separately boxed `Integer`s with the same value can still be different
objects, which is exactly why `eq` comes out false here.

**Generated `misconception`:** `reference-equality-mistaken-for-value-equality`

**Verdict:** _(pending)_

---

### 11. `mut-001` — mutable-state / tap-line / difficulty 1500 — _(forced `not-the-bug-site` example)_

**Snippet** (java):

```java
class Team {
    private List<String> members;

    public Team(List<String> members) {
        this.members = members;
    }

    public List<String> getMembers() {
        return new ArrayList<>(members);
    }
}

public class Main {
    public static void main(String[] args) {
        List<String> names = new ArrayList<>();
        names.add("Alice");
        Team team = new Team(names);
        names.add("Bob");
        System.out.println(team.getMembers());
    }
}
```

**Correct line:** 4 (`this.members = members;`)

**Wrong line being explained:** line 0 (`class Team {`)

**Generated `why_wrong`:** This line only opens the `Team` class declaration; no reference is
stored or copied here, so no aliasing can happen on it.

**Generated `misconception`:** `not-the-bug-site`

**Verdict:** _(pending)_

---

### 12. `scl-007` — scope-closures / tap-line / difficulty 1750 — _(forced `not-the-bug-site` example)_

**Snippet** (javascript):

```javascript
function createLogger(prefix) {
  let currentPrefix = prefix

  function log(message) {
    console.log(`[${currentPrefix}] ${message}`)
  }

  function setPrefix(newPrefix) {
    currentPrefix = newPrefix
  }

  function withTimestamp(logFn) {
    const label = currentPrefix
    return function (message) {
      logFn(`${new Date().toISOString()} ${label}: ${message}`)
    }
  }

  return { log, setPrefix, timestampedLog: withTimestamp(log) }
}

const logger = createLogger('APP')
logger.setPrefix('SERVICE')
logger.timestampedLog('Starting up')
```

**Correct line:** 12 (`const label = currentPrefix;`)

**Wrong line being explained:** line 0 (`function createLogger(prefix) {`)

**Generated `why_wrong`:** This just declares the createLogger function and its prefix parameter;
nothing gets copied or frozen on a function signature line.

**Generated `misconception`:** `not-the-bug-site`

**Verdict:** _(pending)_

---

### 13. `con-015` — concurrency / tap-line / difficulty 1900

**Snippet** (python):

```python
import asyncio

PRICES = {"AAPL": 190.0, "GOOG": 140.0}
pending = {}
fetch_count = 0


async def get_or_fetch(key, fetcher):
    if key in pending:
        return pending[key]
    value = await fetcher(key)
    pending[key] = value
    return value


async def fetch_price(symbol):
    global fetch_count
    await asyncio.sleep(0.05)
    fetch_count += 1
    return PRICES[symbol]


async def refresh_quotes(symbols):
    tasks = [get_or_fetch(symbol, fetch_price) for symbol in symbols]
    return await asyncio.gather(*tasks)
```

**Correct line:** 11 (`value = await fetcher(key)`)

**Wrong line being explained:** line 8 (`if key in pending:`)

**Generated `why_wrong`:** Checking `key in pending` is exactly the right way to detect an
in-flight or cached request, so the test itself isn't broken. The real problem is that when three
coroutines for the same symbol start together, none of them has reached the line that actually
writes to `pending` yet, so all three see this check fail before any write occurs.

**Generated `misconception`:** `race-blamed-on-cache-read`

**Verdict:** _(pending)_

---

### 14. `res-003` — resource-management / tap-line / difficulty 1200

**Snippet** (python):

```python
import json

def process_file(path):
    f = open(path)
    data = f.read()
    parsed = json.loads(data)
    f.close()
    return parsed
```

**Correct line:** 3 (`f = open(path)`)

**Wrong line being explained:** line 5 (`parsed = json.loads(data)`)

**Generated `why_wrong`:** It's true that a malformed-JSON error here is what triggers the leak by
skipping the rest of the function, but `json.loads` itself doesn't manage any file resource. The
actual defect is upstream: the file was opened with a bare `open(path)` instead of a `with` block,
so nothing guarantees cleanup once this line raises.

**Generated `misconception`:** `blames-exception-trigger-not-cleanup-guard`

**Verdict:** _(pending)_

---

### 15. `err-018` — error-handling / tap-line / difficulty 1800

**Snippet** (java):

```java
import java.util.concurrent.BlockingQueue;

public class TaskWorker implements Runnable {
    private final BlockingQueue<Runnable> queue;
    private volatile boolean running = true;

    public TaskWorker(BlockingQueue<Runnable> queue) {
        this.queue = queue;
    }

    public void shutdown() {
        running = false;
    }

    @Override
    public void run() {
        while (running) {
            try {
                Runnable task = queue.take();
                task.run();
            } catch (InterruptedException e) {
                // ignore and keep polling for work
            } catch (Exception e) {
                System.err.println("task failed: " + e.getMessage());
            }
        }
    }
}
```

**Correct line:** 20 (`// ignore and keep polling for work`)

**Wrong line being explained:** line 11 (`running = false;`)

**Generated `why_wrong`:** Close — this line does exactly what it should: it flips the cooperative
`running` flag so the loop exits cleanly on an explicit `shutdown()` call. That flag is a
completely different signal from the thread's interrupt status, which is the one `take()` clears
when it throws — nothing here touches that.

**Generated `misconception`:** `conflates-flag-with-interrupt-status`

**Verdict:** _(pending)_

---

### 16. `rec-028` — recursion-termination / tap-line / difficulty 1800 — _(forced `not-the-bug-site` example)_

**Snippet** (python):

```python
def parse_expr(tokens, pos):
    left, pos = parse_term(tokens, pos)
    while pos < len(tokens) and tokens[pos] in ('+', '-'):
        op = tokens[pos]
        pos += 1
        right, pos = parse_term(tokens, pos)
        left = (op, left, right)
    return left, pos


def parse_term(tokens, pos):
    left, pos = parse_factor(tokens, pos)
    while pos < len(tokens) and tokens[pos] == '*':
        pos += 1
        right, pos = parse_factor(tokens, pos)
        left = ('*', left, right)
    return left, pos


def parse_factor(tokens, pos):
    if tokens[pos] == '(':
        pos += 1
        expr, pos = parse_expr(tokens, pos)
        if tokens[pos] != ')':
            raise ValueError('expected )')
        return expr, pos + 1
    if tokens[pos] == '-':
        return parse_factor(tokens, pos)
    value = tokens[pos]
    return value, pos + 1
```

**Correct line:** 27 (`return parse_factor(tokens, pos)`)

**Wrong line being explained:** line 0 (`def parse_expr(tokens, pos):`)

**Generated `why_wrong`:** This line is just the function signature for `parse_expr`; it defines
parameters but never touches `pos`, so it can't be where the infinite recursion happens.

**Generated `misconception`:** `not-the-bug-site`

**Verdict:** _(pending)_

_(Note for the reader: rows 11, 12, and 16 all landed on the trivial "this is just a
declaration/signature line" flavor of `not-the-bug-site` rather than a more varied set — worth
noting as a sampling weakness of this particular script, not a generation defect; the batch
contains plenty of richer `not-the-bug-site` entries for blank lines, closing braces, and
near-miss lines that weren't pulled into this sample.)_

---

### 17. `dsm-003` — data-structure-misuse / tap-line / difficulty 1400

**Snippet** (java):

```java
class Point {
    int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }
}

public boolean hasDuplicate(List<Point> points) {
    Set<Point> seen = new HashSet<>();
    for (Point p : points) {
        if (!seen.add(p)) {
            return true;
        }
    }
    return false;
}
```

**Correct line:** 5 (`@Override`, marking the `equals()` override that has no matching
`hashCode()`)

**Wrong line being explained:** line 6 (`if (!(o instanceof Point)) return false;`)

**Generated `why_wrong`:** You're suspecting the type guard, but `instanceof Point` correctly
rejects non-Point objects and isn't where this bug lives. The real failure happens before equals()
is even called: Point's missing hashCode() means two equal-looking points can land in different
HashSet buckets, so this check never runs on them.

**Generated `misconception`:** `assumes-equals-body-broken`

**Verdict:** _(pending)_

---

### 18. `str-006` — string-formatting / tap-line / difficulty 800

**Snippet** (python):

```python
def greet(name, age):
    print("Hello %s, you are %d years old" % name)
```

**Correct line:** 1 (`print("Hello %s, you are %d years old" % name)`)

**Wrong line being explained:** line 0 (`def greet(name, age):`)

**Generated `why_wrong`:** This line just defines the function's parameters, `name` and `age`, and
doesn't do any formatting itself. The mismatch between placeholders and supplied values happens
where the `%` operator is actually applied, inside the `print` call.

**Generated `misconception`:** `not-the-bug-site`

**Verdict:** _(pending)_

_(This puzzle has only 2 lines, so this is its one wrong-line entry, not a forced pick.)_

---

### 19. `inp-015` — input-validation / tap-line / difficulty 2100

**Snippet** (javascript):

```javascript
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/g

function isValidEmail(email) {
  return EMAIL_PATTERN.test(email)
}

function validateSignupBatch(emails) {
  const results = []
  for (const email of emails) {
    results.push({ email, valid: isValidEmail(email) })
  }
  return results
}

function rejectedEmails(emails) {
  return validateSignupBatch(emails)
    .filter((result) => !result.valid)
    .map((result) => result.email)
}
```

**Correct line:** 0 (`const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/g`)

**Wrong line being explained:** line 3 (`return EMAIL_PATTERN.test(email)`)

**Generated `why_wrong`:** It's tempting to blame the `.test()` call itself since that's where a
result gets returned, but this line does exactly what it should every time it runs. The alternation
comes from the fact that `EMAIL_PATTERN` is a single shared `RegExp` object whose `lastIndex`
carries over between calls — that state lives on the pattern declared with the `g` flag, not in how
it's invoked here.

**Generated `misconception`:** `blames-call-site-not-shared-state`

**Verdict:** _(pending)_

---

### 20. `cf-002` — control-flow / tap-line / difficulty 1300

**Snippet** (javascript):

```javascript
function findFirstPair(matrix, target) {
  let result = null
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (matrix[i][j] === target) {
        result = [i, j]
        break
      }
    }
  }
  return result
}
```

**Correct line:** 6 (`break`)

**Wrong line being explained:** line 2 (`for (let i = 0; i < matrix.length; i++) {`)

**Generated `why_wrong`:** The outer loop's condition is fine — it's supposed to scan every row for
a match. The real issue is that nothing tells this loop to stop once a match is found in an earlier
row; that's the job of the `break` inside, which only reaches the inner loop.

**Generated `misconception`:** `blames-loop-condition`

**Verdict:** _(pending)_

---

## Summary (fill in after the read)

- Entries read: \_\_\_ / 20
- Substantively wrong: \_\_\_
- Kind(s) of wrong: \_\_\_
- Regenerated? \_\_\_
