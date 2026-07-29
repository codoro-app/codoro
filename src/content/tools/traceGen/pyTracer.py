"""sys.settrace harness run as a subprocess by pyTraceGen.ts (never imported
directly, never run in-process with the caller — a snippet gets a fresh
interpreter every time).

Pairing algorithm (see pyTraceGen.test.ts and the Phase 2 spike notes for the
empirical CPython verification this implements): sys.settrace's 'line' event
fires with frame.f_lineno set to the line about to run, and frame.f_locals as
of right BEFORE it runs. To get one entry per executed line with POST-line
state (what the puzzle schema needs), each event is paired with the frame's
NEXT event: a 'line'/'return' event first resolves whatever line was left
pending from that same frame's previous event (using ITS OWN f_locals, which
by then reflects the pending line having executed), then (for 'line') sets a
new pending line for next time. `pending` is keyed by id(frame) so unrelated
frames (a call and its caller) never interfere with each other's pending
line. A fresh frame's first 'line' event has nothing pending yet, so it only
sets one — it does not emit.

Snippet authors are responsible for not relying on unseeded randomness
(e.g. the `random` module isn't in the sandbox anyway); this harness itself
introduces no timestamps or unseeded randomness of its own.
"""

import builtins
import io
import json
import sys

SAFE_BUILTIN_NAMES = [
    "int",
    "float",
    "bool",
    "str",
    "list",
    "dict",
    "tuple",
    "set",
    "frozenset",
    "bytes",
    "len",
    "range",
    "enumerate",
    "sum",
    "min",
    "max",
    "sorted",
    "abs",
    "round",
    "print",
    "zip",
    "map",
    "filter",
    "reversed",
    "isinstance",
    "type",
    "Exception",
    "ValueError",
    "TypeError",
    "IndexError",
    "KeyError",
    "StopIteration",
]

# Types whose own repr() is address-free and deterministic — safe to show
# verbatim. Anything else (functions, classes, custom instances, modules,
# iterators, ...) collapses to `<typename>`: deliberately coarse for this
# spike, not an attempt to pretty-print arbitrary objects.
SAFE_REPR_TYPES = (
    int,
    float,
    bool,
    str,
    list,
    dict,
    tuple,
    set,
    frozenset,
    complex,
    bytes,
    type(None),
)


def _sanitize(value: object) -> object:
    """Recursively replaces any address-leaking value (a function inside a
    list, say) with its <typename> placeholder, so repr() of a container
    never falls through to Python's default object repr for something it
    contains. type(value) in SAFE_REPR_TYPES alone only caught this at the
    top level — repr([some_lambda]) still calls the default repr on the
    lambda itself, embedding its address, which is exactly the leak
    to_display exists to prevent."""
    t = type(value)
    if t in (int, float, bool, str, type(None), complex, bytes):
        return value
    if t is list:
        return [_sanitize(item) for item in value]
    if t is tuple:
        return tuple(_sanitize(item) for item in value)
    if t is dict:
        return {key: _sanitize(item) for key, item in value.items()}
    if t is set:
        return {_sanitize(item) for item in value}
    if t is frozenset:
        return frozenset(_sanitize(item) for item in value)
    return f"<{t.__name__}>"


def to_display(value: object) -> str:
    # Top-level unsafe values return the bare placeholder (no quotes) —
    # only nested occurrences inside a safe container go through repr(),
    # which is what quotes a placeholder string like any other string.
    if type(value) in SAFE_REPR_TYPES:
        return repr(_sanitize(value))
    return f"<{type(value).__name__}>"


def main() -> None:
    payload = json.loads(sys.stdin.read())
    snippet = payload["snippet"]
    max_steps = payload.get("maxSteps", 2000)

    restricted_builtins = {name: getattr(builtins, name) for name in SAFE_BUILTIN_NAMES}
    module_globals: dict = {"__builtins__": restricted_builtins}

    steps: list = []
    step_count = 0
    # id(frame) -> pending 1-indexed line number still awaiting a
    # post-execution snapshot, or absent for a frame with nothing pending yet.
    pending: dict = {}

    captured = io.StringIO()
    consumed = 0

    def flush_output() -> str:
        nonlocal consumed
        content = captured.getvalue()
        new_text = content[consumed:]
        consumed = len(content)
        if new_text.endswith("\n"):
            new_text = new_text[:-1]
        return new_text

    def emit(line_1indexed: int, f_locals: dict) -> None:
        nonlocal step_count
        if step_count >= max_steps:
            raise RuntimeError(
                f"step budget exceeded ({max_steps} steps) - likely an infinite loop"
            )
        # Key order here is stable first-seen order, not just deterministic —
        # unlike the JS backend (docs/v2-phase2-review.md, P3), Python has no
        # block scoping, so a for/if introduces no nested scope whose own
        # bindings could jump ahead of the enclosing frame's. Module-level
        # f_locals is the real namespace dict (insertion order = first-executed
        # order); a function's f_locals reflects co_varnames (fixed by the
        # compiler at first textual appearance). Verified against
        # pyTraceGen.test.ts's "loop state" fixture (total/i never reorder
        # across any step) and an independent probe during the Phase 2
        # corrective — no fix needed on this side.
        vars_out = {
            name: to_display(value)
            for name, value in f_locals.items()
            if name != "__builtins__"
        }
        step = {"line": line_1indexed - 1, "vars": vars_out}
        output = flush_output()
        if output:
            step["output"] = output
        steps.append(step)
        step_count += 1

    def trace_calls(frame, event, arg):
        if event not in ("line", "return"):
            return trace_calls
        fid = id(frame)
        pending_line = pending.get(fid)
        if pending_line is not None:
            emit(pending_line, frame.f_locals)
        if event == "line":
            pending[fid] = frame.f_lineno
        else:
            pending[fid] = None
        return trace_calls

    old_stdout = sys.stdout
    sys.stdout = captured
    try:
        compiled = compile(snippet, "<snippet>", "exec")
        sys.settrace(trace_calls)
        exec(compiled, module_globals)
    except Exception as err:  # noqa: BLE001 - deliberately broad, re-surfaced to Node as-is
        sys.settrace(None)
        sys.stdout = old_stdout
        print(str(err), file=sys.stderr)
        sys.exit(1)
    sys.settrace(None)
    sys.stdout = old_stdout

    print(json.dumps({"steps": steps}))


if __name__ == "__main__":
    main()
