/**
 * OD-6 swipe gesture harness — paste into the Chrome DevTools console on any
 * page showing a swipe-binary card (e.g. https://getcodoro.com/practice).
 *
 * Built 2026-08-21 to reproduce the swipe defect deterministically instead of
 * guessing at WebKit. It dispatches real `TouchEvent`s at
 * `.swipe-fallback__card` with controlled timing and reports, per case,
 * whether the card tracked the finger and whether the gesture committed.
 *
 * Chrome-only (uses the `Touch`/`TouchEvent` constructors). DevTools device
 * emulation is NOT required — these are synthetic events, dispatched straight
 * at the element, so they exercise the component's state machine and
 * threshold math regardless of what the browser thinks the input device is.
 *
 * What it does NOT test: WebKit's native gesture arbitration. If a symptom
 * survives on a real iPhone after these all pass, that residue is a genuine
 * arbitration problem — but check here first, because OD-1 through OD-5 all
 * assumed arbitration and all three real causes turned out to live in our own
 * code.
 *
 * IMPORTANT — run it in a FOCUSED, VISIBLE tab. Chrome throttles timers in a
 * background tab to roughly one per second, which stretches a 2.4s scripted
 * drag into 24s and invalidates every timing-dependent case; a hidden tab
 * also fires `visibilitychange`, which the component treats (correctly) as a
 * reason to abandon an in-flight gesture. Keep the window in front while a
 * case runs. Measured `ms` in the output is real elapsed time — if it is
 * wildly higher than the case's nominal duration, the tab was throttled and
 * the result means nothing.
 *
 * Usage:
 *   sw.help()          list the cases
 *   sw.run('slow')     run one case, print a verdict
 *   sw.runAll()        run every case that does not consume the puzzle,
 *                      then stop at the first committing case
 *   sw.ready()         is there a fresh, uncommitted swipe card on screen?
 *
 * A committing case answers the puzzle. Click Continue for a fresh card
 * before running the next one — the harness survives that (it only dies on a
 * full page reload).
 */
;(() => {
  const CARD = '.swipe-fallback__card'
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const card = () => document.querySelector(CARD)
  const committed = () =>
    !!document.querySelector('.swipe-fallback__button--correct, .swipe-fallback__button--wrong')

  const tx = () => {
    const el = card()
    if (!el) return null
    const t = getComputedStyle(el).transform
    return t === 'none' ? 0 : Math.round(new DOMMatrixReadOnly(t).m41)
  }

  const mk = (target, id, x, y) =>
    new Touch({
      identifier: id,
      target,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: x,
      screenY: y,
    })

  const fire = (target, type, changed, alsoDown = []) => {
    const ending = type === 'touchend' || type === 'touchcancel'
    const live = ending ? alsoDown : [...alsoDown, ...changed]
    target.dispatchEvent(
      new TouchEvent(type, {
        bubbles: true,
        cancelable: type !== 'touchcancel',
        composed: true,
        touches: live,
        targetTouches: live.filter((t) => t.target === target),
        changedTouches: changed,
      }),
    )
  }

  /**
   * Drives one gesture. `stray: true` puts a second finger on document.body
   * BEFORE the card touch, which is what exposed the `touches[0]` identifier
   * bug — a real browser orders `touches` by start time, so the stray finger
   * is `touches[0]`.
   */
  async function drag({
    dx = 160,
    dy = 0,
    duration = 400,
    steps = 16,
    pauseAfter = null,
    pauseMs = 0,
    stray = false,
  }) {
    const el = card()
    if (!el) return { error: 'no swipe card on screen' }
    if (committed()) return { error: 'card already answered — click Continue first' }

    const r = el.getBoundingClientRect()
    const sx = Math.round(r.x + r.width / 2)
    const sy = Math.round(r.y + r.height / 2)
    const others = stray ? [mk(document.body, 99, 5, Math.round(window.innerHeight - 10))] : []

    let maxTx = 0
    const track = () => {
      const v = tx()
      if (Math.abs(v) > Math.abs(maxTx)) maxTx = v
    }

    const t0 = performance.now()
    fire(el, 'touchstart', [mk(el, 1, sx, sy)], others)
    for (let i = 1; i <= steps; i++) {
      await sleep(duration / steps)
      fire(el, 'touchmove', [mk(el, 1, sx + (dx * i) / steps, sy + (dy * i) / steps)], others)
      track()
      if (pauseAfter === i && pauseMs > 0) {
        await sleep(pauseMs)
        track()
      }
    }
    fire(el, 'touchend', [mk(el, 1, sx + dx, sy + dy)], others)
    await sleep(150)
    track()

    return {
      elapsedMs: Math.round(performance.now() - t0),
      trackedTo: maxTx,
      committed: committed(),
    }
  }

  const cases = {
    slow: {
      why: 'The captured defect-1 gesture: 160px released after ~2.5s. Deliberate, full distance, unhurried.',
      expect: 'commit',
      run: () => drag({ dx: 160, duration: 2400, steps: 24 }),
    },
    verySlow: {
      why: 'Same, but 4s. Nothing about pace should matter once the distance is there.',
      expect: 'commit',
      run: () => drag({ dx: 170, duration: 4000, steps: 32 }),
    },
    pause: {
      why: 'The captured defect-2 gesture: 200px with a 2.3s stall mid-drag, past the old 2000ms watchdog.',
      expect: 'commit',
      run: () => drag({ dx: 200, duration: 1000, steps: 20, pauseAfter: 6, pauseMs: 2300 }),
    },
    stray: {
      why: 'The captured defect-3 gesture: a second finger already resting on the page when the swipe starts.',
      expect: 'commit',
      run: () => drag({ dx: 180, duration: 600, steps: 18, stray: true }),
    },
    stopDead: {
      why: 'Full-distance drag that comes to a complete stop before release — the usual human release habit.',
      expect: 'commit',
      run: () => drag({ dx: 180, duration: 500, steps: 10, pauseAfter: 10, pauseMs: 400 }),
    },
    flick: {
      why: 'A short, fast throw — should commit early, without the full drag.',
      expect: 'commit',
      run: () => drag({ dx: 90, duration: 100, steps: 6 }),
    },
    fast: {
      why: 'Control: an ordinary quick swipe. If this fails, something is broken at a basic level.',
      expect: 'commit',
      run: () => drag({ dx: 180, duration: 350, steps: 14 }),
    },

    // --- these must NOT commit, so they leave the puzzle usable ---
    tinyFlick: {
      why: 'A stray few-pixel touch-drag that happens to move fast. Must never fire a rating update.',
      expect: 'no commit',
      run: () => drag({ dx: 30, duration: 50, steps: 4 }),
    },
    halfDrag: {
      why: 'A hesitant 80px drag over 3s, abandoned short of the commit distance. Must spring back.',
      expect: 'no commit',
      run: () => drag({ dx: 80, duration: 3000, steps: 20 }),
    },
    vertical: {
      why: 'A vertical-dominant gesture on the card. Must not move or commit the card.',
      expect: 'no commit',
      run: () => drag({ dx: 20, dy: 160, duration: 500, steps: 12 }),
    },
    stillAliveAfterStray: {
      why: 'The permanent-death half of defect 3: a stray-hijacked gesture used to leave the card inert forever. Runs a stray drag that should commit — if it does not, re-run and watch whether ANY later gesture works.',
      expect: 'commit',
      run: () => drag({ dx: 180, duration: 500, steps: 14, stray: true }),
    },
  }

  const verdict = (name, res) => {
    const c = cases[name]
    if (res.error) return `  SKIP  ${name.padEnd(20)} ${res.error}`
    const want = c.expect === 'commit'
    const ok = res.committed === want
    return `${ok ? '  PASS' : '  FAIL'}  ${name.padEnd(20)} committed=${String(res.committed).padEnd(5)} trackedTo=${String(res.trackedTo).padEnd(5)} ${res.elapsedMs}ms  (want ${c.expect})`
  }

  window.sw = {
    help() {
      console.log('OD-6 swipe harness — cases:')
      for (const [k, v] of Object.entries(cases)) {
        console.log(`  sw.run('${k}')`.padEnd(34) + `[${v.expect}] ${v.why}`)
      }
      console.log('\n  sw.runAll()   non-committing cases, then the committing ones one at a time')
      console.log('  sw.ready()    is a fresh, unanswered swipe card on screen?')
    },
    ready() {
      return !!card() && !committed()
    },
    async run(name) {
      const c = cases[name]
      if (!c) return console.error(`no case '${name}' — try sw.help()`)
      const res = await c.run()
      console.log(verdict(name, res))
      if (res.committed) console.log('  (puzzle answered — click Continue for a fresh card)')
      return res
    },
    async runAll() {
      const safe = Object.keys(cases).filter((k) => cases[k].expect === 'no commit')
      const committing = Object.keys(cases).filter((k) => cases[k].expect === 'commit')
      console.log('--- cases that must NOT commit (safe to run back to back) ---')
      for (const name of safe) console.log(verdict(name, await cases[name].run()))
      console.log('\n--- cases that MUST commit (one per puzzle) ---')
      for (const name of committing) {
        if (!this.ready()) {
          console.log(
            `  ...stopped before '${name}': click Continue for a fresh card, then sw.run('${name}')`,
          )
          console.log(`     remaining: ${committing.slice(committing.indexOf(name)).join(', ')}`)
          return
        }
        console.log(verdict(name, await cases[name].run()))
      }
    },
  }

  console.log('OD-6 swipe harness installed. Run sw.help()')
})()
