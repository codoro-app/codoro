import { describe, expect, it } from 'vitest'
import { mapDragToStepIndex } from './mapDragToStepIndex'

describe('mapDragToStepIndex', () => {
  it('maps a positive delta forward by whole steps', () => {
    expect(
      mapDragToStepIndex({
        startIndex: 0,
        deltaPx: 100,
        pxPerStep: 50,
        stepCount: 10,
        maxAllowedIndex: 9,
      }),
    ).toBe(2)
  })

  it('maps a negative delta backward by whole steps', () => {
    expect(
      mapDragToStepIndex({
        startIndex: 5,
        deltaPx: -150,
        pxPerStep: 50,
        stepCount: 10,
        maxAllowedIndex: 9,
      }),
    ).toBe(2)
  })

  it('rounds a fractional step delta to the nearest step', () => {
    expect(
      mapDragToStepIndex({
        startIndex: 0,
        deltaPx: 70, // 1.4 steps at pxPerStep 50 -> rounds to 1
        pxPerStep: 50,
        stepCount: 10,
        maxAllowedIndex: 9,
      }),
    ).toBe(1)

    expect(
      mapDragToStepIndex({
        startIndex: 0,
        deltaPx: 130, // 2.6 steps at pxPerStep 50 -> rounds to 3
        pxPerStep: 50,
        stepCount: 10,
        maxAllowedIndex: 9,
      }),
    ).toBe(3)
  })

  it('clamps at the lower bound (index 0), never going negative', () => {
    expect(
      mapDragToStepIndex({
        startIndex: 1,
        deltaPx: -10_000,
        pxPerStep: 50,
        stepCount: 10,
        maxAllowedIndex: 9,
      }),
    ).toBe(0)
  })

  it('clamps at the upper bound (stepCount - 1) when maxAllowedIndex does not constrain further', () => {
    expect(
      mapDragToStepIndex({
        startIndex: 0,
        deltaPx: 10_000,
        pxPerStep: 50,
        stepCount: 5,
        maxAllowedIndex: 4,
      }),
    ).toBe(4)
  })

  // The critical clamp: maxAllowedIndex sits strictly below stepCount - 1
  // (the next unanswered checkpoint gates scrub-forward distance). A drag
  // requesting far past both bounds must stop at maxAllowedIndex, not
  // stepCount - 1 — deleting the maxAllowedIndex half of the clamp in the
  // implementation makes this assertion fail (it would return 9 instead).
  it('clamps at maxAllowedIndex even when stepCount would otherwise allow further', () => {
    expect(
      mapDragToStepIndex({
        startIndex: 0,
        deltaPx: 10_000,
        pxPerStep: 50,
        stepCount: 10,
        maxAllowedIndex: 3,
      }),
    ).toBe(3)
  })

  it('degrades to "no movement" (clamped startIndex) rather than dividing by zero when pxPerStep is 0', () => {
    expect(
      mapDragToStepIndex({
        startIndex: 3,
        deltaPx: 500,
        pxPerStep: 0,
        stepCount: 10,
        maxAllowedIndex: 9,
      }),
    ).toBe(3)
  })

  it('returns 0 for an empty trace', () => {
    expect(
      mapDragToStepIndex({
        startIndex: 0,
        deltaPx: 500,
        pxPerStep: 50,
        stepCount: 0,
        maxAllowedIndex: 0,
      }),
    ).toBe(0)
  })

  it('clamps startIndex itself if it starts out of range for maxAllowedIndex', () => {
    expect(
      mapDragToStepIndex({
        startIndex: 8,
        deltaPx: 0,
        pxPerStep: 50,
        stepCount: 10,
        maxAllowedIndex: 3,
      }),
    ).toBe(3)
  })
})
