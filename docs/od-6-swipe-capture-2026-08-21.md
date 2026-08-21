# OD-6 — swipe "pauses / doesn't register": captured root causes

**Date:** 2026-08-21
**Method:** live capture against production (`getcodoro.com`, `/practice`), desktop Chrome,
synthetic `TouchEvent` streams with controlled timing dispatched at the real
`.swipe-fallback__card` element, plus a window-level tap recording every touch event's
`defaultPrevented` flag and the card's computed `translateX` per event.
**Status:** three separate defects reproduced deterministically. None of them require WebKit.
All three are in `SwipeBinary.tsx` / `gestureThreshold.ts`, not in browser touch arbitration.

This closes the method question the v3 plan left open for OD-1: the failures reproduce in a
scriptable harness, so every fix below is revert-checkable without a device round.

---

## Harness

Installed in the page; drives a real `touchstart` → N × `touchmove` → `touchend` sequence at
the card, with configurable total duration, step count, and an optional mid-gesture pause.
Records per event: elapsed ms, event type, the card's computed `translateX`, and
`event.defaultPrevented` read in the **bubble** phase at `window` — i.e. _after_ the card's
own handler has run, so it reports whether `SwipeBinary` actually called `preventDefault()`
on that event.

Control, to prove the harness produces real commits: **160px over 400ms → `committed: true`,
card flew to `translateX = 423`.**

---

## Defect 1 — the velocity gate silently rejects deliberate slow drags

**Capture (160px, 24 move samples, released at t = 2558ms):**

```
0     touchstart tx=0    pd=true
104   touchmove  tx=0    pd=true
...
2355  touchmove  tx=140  pd=true
2456  touchmove  tx=147  pd=true
2557  touchmove  tx=153  pd=true
2558  touchend   tx=153  pd=false
-> committed: false, card sprang back to tx=-3
```

Nothing went wrong at the browser level. The axis resolved horizontal, the card tracked the
finger the entire way to 153px — past full tilt, past the 120px commit distance, with the
side preview lit — `preventDefault()` succeeded on every single event, and `touchend` arrived
normally. The gesture was then thrown away.

**Mechanism.** `resolveSwipeCommit` requires distance **AND** velocity. `velocityX` is
`signedVelocityFromGesture`, an average over the _whole_ gesture, so `minVelocity: 0.08 px/ms`
is not a speed floor — it is a **hard ceiling on gesture duration**:

> a drag is only allowed to take `|dx| / 0.08` ms, total.

- 120px drag → must finish in **≤ 1500ms**
- 160px drag → must finish in **≤ 2000ms**

A 160px drag nominally paced at 1900ms also failed (`committed: false`) — real elapsed time
overshoots nominal, so the effective ceiling is tighter still.

The velocity gate's stated job (module doc, `gestureThreshold.ts`) is to block "a brief,
high-velocity accidental flick (a stray touch-drag of a few pixels)". That case is already
excluded by `minDistance` — a few-pixel flick cannot also be a 120px drag. The doc comment
concedes this itself. So the `AND` is doing essentially no work against its stated threat,
while rejecting the most common real gesture: an unhurried, fully-committed swipe.

Worse, it makes the card's own visual feedback dishonest. `PREVIEW_RANGE` was deliberately
locked to `minDistance` (2026-08-18) so that full tilt means "release here and it commits."
Under an AND rule that promise is unkeepable: full tilt commits or doesn't depending on a
number the user cannot see and gets no feedback about.

---

## Defect 2 — the watchdog kills live gestures (and disarms `preventDefault`)

**Capture (200px drag, 2300ms pause after the 6th move — a user hesitating mid-swipe):**

```
0     touchstart tx=0   pd=true
58    touchmove  tx=0   pd=true
173   touchmove  tx=20  pd=true
225   touchmove  tx=30  pd=true
275   touchmove  tx=40  pd=true
326   touchmove  tx=50  pd=true     <- last accepted move
                                     ... finger still down, ~2350ms gap ...
2678  touchmove  tx=0   pd=false    <- card snapped to center, gesture disowned
2729  touchmove  tx=0   pd=false
3330  touchmove  tx=0   pd=false
3394  touchend   tx=0   pd=false    <- real touchend ignored
-> committed: false
```

`GESTURE_WATCHDOG_MS = 2000` elapsed since the last accepted move, `forceResetGesture` ran,
and it cleared `activeTouchIdRef` **while the finger was still physically on the screen**.
Every subsequent event in the same, still-live gesture hits `if (id === null) return`, and the
real `touchend` is discarded.

This is the reported symptom exactly: _the card freezes mid-drag while the finger is still
moving._ The watchdog is not the recovery from that state — **it is the cause of it.**

Two things follow:

1. **A timer cannot tell "the browser dropped this gesture" apart from "the user paused."**
   It only sees silence. Those are the same signal, so any timeout value is wrong for one of
   the two cases. 2000ms picks the wrong one for a hesitating user, which is common.
2. **`pd=false` after the reset is the dangerous part.** Once disowned, the component stops
   calling `preventDefault()` on a touch that is _still live on the card_. On WebKit that
   hands the in-flight gesture straight to the native pan/edge recognizer — the exact class of
   failure OD-1 through OD-5 spent nine rounds fighting. The watchdog added in PR #71 can
   manufacture the iPhone hand-off it was meant to protect against.

---

## Defect 3 — a stray touch anywhere on the page permanently kills the card

**Capture:** one touch resting on `document.body` (identifier 0, started _before_ the card
touch — a palm on the screen edge, a thumb bracing the phone, a finger still lifting from the
previous interaction), then a normal 160px drag on the card with identifier 1:

```
start        tx=0
after 160px  tx=0            <- card never moved at all
afterEnd     tx=0  committed=false
followUpFastDrag  tx=0  committed=false   <- 180px/300ms, the control gesture
                                             that commits on a healthy card
```

The card does not move, does not commit, and is then **dead for every subsequent gesture**
until the 2s watchdog happens to clear it.

**Mechanism**, `SwipeBinary.tsx` `onTouchStart`:

```js
const touch = event.touches[0]
activeTouchIdRef.current = touch.identifier
```

`TouchEvent.touches` is every active touch point **in the document**, ordered by start time —
not the touches that changed in this event. Any pre-existing touch anywhere on the page is
`touches[0]`, so the component claims the wrong identifier and anchors `startXRef`/`startYRef`
to a finger that never moves. `dx` stays ~0 forever.

Then `onTouchEnd` looks the tracked id up in `changedTouches`, doesn't find it, and returns
**before clearing `activeTouchIdRef`** — leaking the claim. Both `onTouchStart` guards bail
while a claim is held, so the card is inert from then on.

Both the card path and the fallback-button path (`buttonTouchIdRef`) have this bug.
`event.changedTouches[0]` is the correct read in both.

---

## Fix plan

### A. Correct the touch identifier (Defect 3) — no product decision, do this

- `event.changedTouches[0]` instead of `event.touches[0]` in both `onTouchStart` branches.
- In `onTouchEnd` / `onTouchCancel`, when the tracked id isn't in `changedTouches`, still
  clear the claim if `event.touches` no longer contains it — a claim must never outlive the
  finger that created it.

### B. Delete the watchdog; make a stuck state structurally impossible instead (Defect 2)

The watchdog exists because the state machine assumed a terminating event always arrives.
Two changes remove that assumption without ever aborting a live gesture:

1. **Bind `touchmove`/`touchend`/`touchcancel` to `window` (capture phase) for the duration
   of the gesture**, attached on `touchstart` and detached on end/cancel — rather than to the
   card. The card can be unmounted, retargeted, or transformed out from under the touch;
   `window` still sees the terminating event. Same for `pointerup`/`pointercancel` on the
   mouse path.
2. **Lazy staleness check instead of a timer.** On every `touchstart`, if a claim is held but
   the tracked identifier is absent from `event.touches`, the previous gesture is _provably_
   over — reset and accept the new touch. The browser's own `touches` list is ground truth,
   available for free at exactly the moment staleness matters. No guessing, no timeout, and it
   cannot fire mid-gesture.

With (1) and (2), `GESTURE_WATCHDOG_MS`, `armWatchdog`, `clearWatchdog` and the timer half of
`forceResetGesture` all delete. The `visibilitychange`/`blur` reset stays — those are real
signals, not guesses.

**Invariant worth encoding as a test:** while a touch this component has claimed is still
live, it always calls `preventDefault()`. Never disown a touch that is still down.

### C. Change the commit rule (Defect 1) — needs your call

Current: `distance AND velocity`, velocity averaged over the whole gesture.

Proposed: `distance OR flick`, matching how `react-tinder-card` and every shipped card UI
behave —

```
commit if |dx| >= COMMIT_DISTANCE
       or (|dx| >= FLICK_DISTANCE and |v_recent| >= FLICK_VELOCITY and same direction)
```

- `COMMIT_DISTANCE` = 120px (unchanged), or proportional to the measured card width so it
  scales with viewport instead of assuming a 340–390px phone.
- `FLICK_DISTANCE` ≈ 45px, `FLICK_VELOCITY` ≈ 0.5 px/ms measured over the **last ~100ms** of
  the gesture, not its whole life. That's what makes a fast short flick commit without letting
  a slow long drag fail.
- Direction agreement still required on the flick branch.

This makes full tilt an honest promise: reach it, release, it commits — regardless of pace.

**Tradeoff to weigh, since a commit is irreversible and fires a rating update.** OR is easier
to satisfy than AND, so accidental commits become the new failure mode. Keeping
`COMMIT_DISTANCE` at 120px (a third of the card, with continuous tilt + side-preview feedback
the whole way) is the main mitigation; an undo affordance on the feedback panel would be the
belt-and-braces one if you want it.

---

## What this does _not_ claim

The harness dispatches synthetic `TouchEvent`s, so it exercises this component's state machine
and threshold math faithfully but does **not** exercise WebKit's native gesture arbitration.
If an iPhone-only symptom survives A/B/C, that residue is a genuine OD-1-class arbitration
problem and needs a device capture. Everything captured above is engine-independent, and it is
sufficient on its own to explain both reported symptoms ("doesn't register", "pauses").

---

## Fix landed (branch `fix-swipe-od6`)

**A. Touch identifier.** `onTouchStart` reads `event.changedTouches[0]` on both the card and the
fallback-button path. `onTouchEnd`/`onTouchCancel` no longer bail out of an unmatched
`changedTouches` lookup without checking `event.touches` — a claim can never outlive the finger
that made it.

**B. Watchdog deleted.** `GESTURE_WATCHDOG_MS`, `armWatchdog`, `clearWatchdog` and the timer are
gone, replaced by two structural properties that cannot fire mid-gesture:
`touchmove`/`touchend`/`touchcancel` are bound to `window` (capture phase) for the gesture's
duration, and a stale claim is detected lazily at the next `touchstart` by checking the tracked
identifier against `event.touches`. The `visibilitychange`/`blur` reset stays — those are
explicit browser signals, not guesses.

**C. Commit rule.** `distance AND velocity` → `distance OR flick`:

```
commit if |dx| >= 120
       or (|dx| >= 60 and |v_recent| >= 0.6 px/ms and same direction)
```

`recentVelocity` measures over the last 100ms of the gesture rather than averaging its whole
life; `signedVelocityFromGesture` is removed. `commitDistance` stayed at 120px deliberately —
it is now the only thing standing between a resting finger and a committed answer, so it was not
lowered while the rule was being loosened. `flickDistance` was set at 60px (half the commit
distance) rather than lower, because this card owns 100% of a touch that starts on it: a user
trying to scroll the page from the card produces a real gesture here, and a smaller flick bar
would let a fast, slightly-horizontal-dominant scroll attempt commit an answer.

### Verification

`pnpm validate` equivalent, run against a clean install of this branch: typecheck clean, lint
clean, **1884/1884 tests passing** (up from 1629 — 46 in `SwipeBinary.test.tsx`, 27 in
`gestureThreshold.test.ts`), content validation clean, production build clean.

Revert-checks, per this repo's standing rule that a fix ships with a test verified red when the
fix is stashed:

- Restoring `event.touches[0]` at `touchstart` → 2 tests red (the defect-3 regression and the
  claim-leak guard).
- Restoring the `AND` distance-plus-velocity rule → 12 tests red across both files.
- The watchdog has no mechanical revert-check, stated rather than glossed: the old suite's own
  watchdog tests asserted the opposite behaviour ("springs the card back to center on its own")
  and were deleted, not adapted. The replacement block asserts the invariant directly — a 2.3s
  mid-drag pause must leave the gesture claimed, still calling `preventDefault()`, and still
  able to commit on release — which is red against the old code by construction.

### Test-harness fidelity note

`SwipeBinary.test.tsx`'s touch helpers previously populated only `touches` **or** only
`changedTouches`. That is why defect 3 sat under a green suite for so long: with one finger the
two lists are identical, so the bug is invisible until a second touch exists. All helpers now
populate both, as a real browser does, and the multi-touch cases are what actually distinguish
them.

### Still owed

An on-device pass on the iPhone. Everything above is engine-independent and explains both
reported symptoms, but the OD-5 architecture (unconditional `preventDefault` at `touchstart`,
`touch-action: none`) is unchanged and untested in jsdom, and the window-level listener move is
new. If a symptom survives on device, that residue is a genuine WebKit arbitration problem —
and unlike rounds 1-9, there is now a harness to reproduce against first.
