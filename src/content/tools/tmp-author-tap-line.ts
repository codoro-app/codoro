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

// Batch 3: concurrency (Python), data-structure-misuse (Java), error-handling (Java)

author('concurrency', {
  interaction: 'tap-line',
  difficulty_rating: 1900,
  prompt:
    'Refreshing the same symbol three times at once still hits the network three times. Tap the line responsible.',
  explanation:
    '`get_or_fetch` is meant to dedupe concurrent lookups for the same key through the `pending` dict, but it only writes to `pending` *after* `await fetcher(key)` resolves. `refresh_quotes` kicks off all of its `get_or_fetch` calls together via `asyncio.gather`, so when the event loop starts all three coroutines for the same symbol, each one runs `if key in pending` before any of them has reached the line that populates it — they all see a miss and all call `fetch_price`, which is exactly the cache-stampede this dict was supposed to prevent. Sequential calls (`await get_or_fetch(...)` one at a time, never overlapping) never trigger this, because the first call fully finishes — including this assignment — before the second one starts. The fix is to store the in-flight *task/coroutine* in `pending` synchronously, before awaiting it, not the resolved value after.',
  language: 'python',
  snippet: [
    'import asyncio',
    '',
    'PRICES = {"AAPL": 190.0, "GOOG": 140.0}',
    'pending = {}',
    'fetch_count = 0',
    '',
    '',
    'async def get_or_fetch(key, fetcher):',
    '    if key in pending:',
    '        return pending[key]',
    '    value = await fetcher(key)',
    '    pending[key] = value',
    '    return value',
    '',
    '',
    'async def fetch_price(symbol):',
    '    global fetch_count',
    '    await asyncio.sleep(0.05)',
    '    fetch_count += 1',
    '    return PRICES[symbol]',
    '',
    '',
    'async def refresh_quotes(symbols):',
    '    tasks = [get_or_fetch(symbol, fetch_price) for symbol in symbols]',
    '    return await asyncio.gather(*tasks)',
  ].join('\n'),
  correct_line: 11,
})

author('data-structure-misuse', {
  interaction: 'tap-line',
  difficulty_rating: 1700,
  prompt:
    'removeTaskById(2) is supposed to remove the task whose id is 2. It removes the wrong task and leaves both id-2 tasks behind. Tap the line responsible.',
  explanation:
    "`taskIds` is a `List<Integer>`, which overloads `remove` two ways: `remove(int index)` and `remove(Object o)`. Because `idToRemove` is declared as a primitive `int`, Java's overload resolution always picks `remove(int index)` here — there is no autoboxing to `Integer` to trigger the object-based overload, since an exact primitive match wins first. So `taskIds.remove(idToRemove)` removes whatever happens to sit at index 2 (here, `88`), not the element whose *value* is `2` — both entries with id `2` survive untouched. The call looks completely correct at a glance, because `remove(Object)` really would do the right thing if the argument were boxed; the only way to get that overload here is to pass an `Integer` explicitly, e.g. `taskIds.remove(Integer.valueOf(idToRemove))` or `taskIds.remove((Integer) idToRemove)`.",
  language: 'java',
  snippet: [
    'import java.util.*;',
    '',
    'public class TaskQueue {',
    '    private List<Integer> taskIds = new ArrayList<>();',
    '',
    '    public void addTask(int id) {',
    '        taskIds.add(id);',
    '    }',
    '',
    '    public void removeTaskById(int idToRemove) {',
    '        taskIds.remove(idToRemove);',
    '    }',
    '',
    '    public List<Integer> getTaskIds() {',
    '        return taskIds;',
    '    }',
    '',
    '    public static void main(String[] args) {',
    '        TaskQueue queue = new TaskQueue();',
    '        queue.addTask(104);',
    '        queue.addTask(2);',
    '        queue.addTask(88);',
    '        queue.addTask(205);',
    '        queue.addTask(2);',
    '',
    '        queue.removeTaskById(2);',
    '        System.out.println(queue.getTaskIds());',
    '    }',
    '}',
  ].join('\n'),
  correct_line: 10,
})

author('error-handling', {
  interaction: 'tap-line',
  difficulty_rating: 1800,
  prompt:
    'Something upstream needs to know when this worker was interrupted, but it never finds out. Tap the line responsible.',
  explanation:
    "When `queue.take()` is interrupted (e.g. by a supervisor calling `workerThread.interrupt()` to unblock a worker during shutdown), the JVM throws `InterruptedException` and, as part of doing so, clears the thread's interrupt status back to `false`. That status is the *only* signal a blocking call like `take()` leaves behind for anyone further up the call stack — a framework, an `ExecutorService`, or another piece of cooperative-cancellation logic — to learn that this thread was asked to stop. This `catch (InterruptedException e)` block swallows the exception and does nothing else: it never calls `Thread.currentThread().interrupt()` to restore that status. So the interrupt signal is discarded entirely, the loop just calls `queue.take()` again as if nothing happened, and any interrupt-based cancellation logic outside this method silently stops working. The `running` flag still works for an explicit `shutdown()` call, which is what makes this easy to miss — everyday shutdown looks fine, and only interrupt-based cancellation quietly breaks.",
  language: 'java',
  snippet: [
    'import java.util.concurrent.BlockingQueue;',
    '',
    'public class TaskWorker implements Runnable {',
    '    private final BlockingQueue<Runnable> queue;',
    '    private volatile boolean running = true;',
    '',
    '    public TaskWorker(BlockingQueue<Runnable> queue) {',
    '        this.queue = queue;',
    '    }',
    '',
    '    public void shutdown() {',
    '        running = false;',
    '    }',
    '',
    '    @Override',
    '    public void run() {',
    '        while (running) {',
    '            try {',
    '                Runnable task = queue.take();',
    '                task.run();',
    '            } catch (InterruptedException e) {',
    '                // ignore and keep polling for work',
    '            } catch (Exception e) {',
    '                System.err.println("task failed: " + e.getMessage());',
    '            }',
    '        }',
    '    }',
    '}',
  ].join('\n'),
  correct_line: 20,
})
