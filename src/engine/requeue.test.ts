import { describe, expect, it } from 'vitest'
import type { RequeueState } from './requeue'
import { advance, emptyRequeueState, recordMiss, resurface } from './requeue'

function tick(state: RequeueState): RequeueState {
  return advance(state).state
}

function tickTimes(state: RequeueState, n: number): RequeueState {
  let current = state
  for (let i = 0; i < n; i++) {
    current = tick(current)
  }
  return current
}

describe('recordMiss', () => {
  it('adds a fresh entry at stage 0 with served 0', () => {
    const state = recordMiss(emptyRequeueState, 'p1')
    expect(state).toEqual([{ puzzleId: 'p1', stage: 0, served: 0 }])
  })

  it('does not mutate the input state', () => {
    const before = emptyRequeueState
    recordMiss(before, 'p1')
    expect(before).toEqual([])
  })

  it('resets an existing entry back to stage 0 in place on a fresh miss', () => {
    // Advance p1 onto stage 1, keep p2 untouched, then miss p1 again.
    let state = recordMiss(emptyRequeueState, 'p1')
    state = recordMiss(state, 'p2')
    state = tickTimes(state, 3)
    state = resurface(state, 'p1') // p1 -> stage 1, served 0
    state = recordMiss(state, 'p1') // fresh miss resets p1

    expect(state).toEqual([
      { puzzleId: 'p1', stage: 0, served: 0 },
      { puzzleId: 'p2', stage: 0, served: 3 },
    ])
  })
})

describe('advance ladder — relative/restarting offsets', () => {
  it('stage 0 becomes due after exactly 3 ticks', () => {
    let state = recordMiss(emptyRequeueState, 'p1')
    expect(advance(state).due).toEqual([]) // served 1
    state = tick(state)
    expect(advance(state).due).toEqual([]) // served 2
    state = tick(state)
    const result = advance(state) // served 3
    expect(result.due.map((e) => e.puzzleId)).toEqual(['p1'])
  })

  it('re-anchors each countdown: due at +3, then +10, then +25 from each resurfacing', () => {
    // NOTE: the inspecting `advance(state)` call itself increments served by
    // one, so a "not due yet" check is asserted while state sits at interval-2.
    let state = recordMiss(emptyRequeueState, 'p1')

    // Stage 0: interval 3.
    state = tickTimes(state, 1) // served 1
    expect(advance(state).due).toEqual([]) // -> served 2, not due
    state = tickTimes(state, 1) // served 2
    expect(advance(state).due.map((e) => e.puzzleId)).toEqual(['p1']) // -> served 3, due
    state = tickTimes(state, 1) // served 3
    state = resurface(state, 'p1') // -> stage 1, served 0

    // Stage 1: interval 10 (relative re-anchor, NOT +13 cumulative).
    state = tickTimes(state, 8) // served 8
    expect(advance(state).due).toEqual([]) // -> served 9, not due
    state = tickTimes(state, 1) // served 9
    expect(advance(state).due.map((e) => e.puzzleId)).toEqual(['p1']) // -> served 10, due
    state = tickTimes(state, 1) // served 10
    state = resurface(state, 'p1') // -> stage 2, served 0

    // Stage 2: interval 25.
    state = tickTimes(state, 23) // served 23
    expect(advance(state).due).toEqual([]) // -> served 24, not due
    state = tickTimes(state, 1) // served 24
    expect(advance(state).due.map((e) => e.puzzleId)).toEqual(['p1']) // -> served 25, due
    state = tickTimes(state, 1) // served 25
    state = resurface(state, 'p1') // final stage -> removed

    // After the 3rd resurfacing the entry is gone forever.
    expect(state).toEqual([])
    expect(advance(tickTimes(state, 100)).due).toEqual([])
  })
})

describe('resurface', () => {
  it('advances stage 0 -> 1 and resets served', () => {
    let state = recordMiss(emptyRequeueState, 'p1')
    state = tickTimes(state, 3)
    state = resurface(state, 'p1')
    expect(state).toEqual([{ puzzleId: 'p1', stage: 1, served: 0 }])
  })

  it('removes the entry when resurfacing off the final stage', () => {
    let state: RequeueState = [{ puzzleId: 'p1', stage: 2, served: 25 }]
    state = resurface(state, 'p1')
    expect(state).toEqual([])
  })

  it('leaves other entries untouched', () => {
    const state: RequeueState = [
      { puzzleId: 'p1', stage: 0, served: 3 },
      { puzzleId: 'p2', stage: 1, served: 4 },
    ]
    expect(resurface(state, 'p1')).toEqual([
      { puzzleId: 'p1', stage: 1, served: 0 },
      { puzzleId: 'p2', stage: 1, served: 4 },
    ])
  })
})

describe('overlapping ladders', () => {
  it('keeps independent counters for simultaneous misses', () => {
    let state = recordMiss(emptyRequeueState, 'p1')
    state = tickTimes(state, 2) // p1 served 2
    state = recordMiss(state, 'p2') // p2 served 0

    const result = advance(state) // p1 -> served 3 (due), p2 -> served 1
    expect(result.due.map((e) => e.puzzleId)).toEqual(['p1'])
    expect(result.state).toEqual([
      { puzzleId: 'p1', stage: 0, served: 3 },
      { puzzleId: 'p2', stage: 0, served: 1 },
    ])
  })

  it('reports multiple same-tick due entries in earliest-missed order', () => {
    // p1 missed first, then p2; tick both until they are due on the same tick.
    let state = recordMiss(emptyRequeueState, 'p1')
    state = recordMiss(state, 'p2')
    state = tickTimes(state, 2) // both served 2

    const due = advance(state).due // both -> served 3, both due
    expect(due.map((e) => e.puzzleId)).toEqual(['p1', 'p2'])
  })
})
