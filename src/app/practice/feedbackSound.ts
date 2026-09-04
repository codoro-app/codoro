/**
 * Synthesizes Practice's impact audio via the Web Audio API — no `.mp3`/
 * `.wav` assets (bundle size + a network request on a route with a known
 * Lighthouse boot-cost flag, see docs/design/practice-feedback-loop.md §6).
 *
 * AudioContext is constructed lazily, on the first actual call (a commit —
 * a genuine user gesture, satisfying autoplay policy), cached module-wide,
 * and resumed if the browser suspended it. Every call is wrapped in
 * try/catch and silent on failure — audio is a nice-to-have, same posture
 * as haptics.ts, never load-bearing for the commit flow.
 */
import type { Outcome } from './feel'

/** Someone's work laptop — keep this quiet even at full volume. */
const MASTER_GAIN = 0.15

let cachedContext: AudioContext | null = null

/** Exported so tests can reset the module-singleton AudioContext between cases — mirrors puzzleBodyCache.ts's resetPuzzleBodyCacheForTests convention. */
export function resetFeedbackSoundForTests(): void {
  cachedContext = null
}

function getAudioContext(): AudioContext | null {
  try {
    if (!cachedContext) {
      // globalThis, not window — vi.stubGlobal (feedbackSound.test.ts) stubs
      // globalThis, and jsdom's window/globalThis identity isn't guaranteed
      // to alias for a property added after setup; globalThis is also what
      // actually exists in every environment this can run in.
      // Cast to a bare optional-property type, not intersected with
      // `typeof globalThis` — lib.dom.d.ts already declares `AudioContext`
      // as a non-optional ambient global, so intersecting would make
      // TypeScript (wrongly, for a real runtime environment that may lack
      // it — Safari-without-webkit-prefix edge cases aside, this guard
      // exists for jsdom/test environments and any future non-browser
      // runtime) treat the `!Ctor` check below as always-false.
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
      if (!Ctor) return null
      cachedContext = new Ctor()
    }
    if (cachedContext.state === 'suspended') {
      void cachedContext.resume()
    }
    return cachedContext
  } catch {
    return null
  }
}

/** Root pitch (Hz) for the correct blip, before the per-level semitone offset. */
const CORRECT_ROOT_HZ = 660
/** Rising arpeggio across a streak — see docs/design/practice-feedback-loop.md §6. */
const CORRECT_SEMITONE_OFFSETS: readonly [number, number, number, number] = [0, 2, 4, 7]

function semitoneToHz(rootHz: number, semitones: number): number {
  return rootHz * 2 ** (semitones / 12)
}

function playCorrect(ctx: AudioContext, level: 0 | 1 | 2 | 3): void {
  const now = ctx.currentTime
  const freq = semitoneToHz(CORRECT_ROOT_HZ, CORRECT_SEMITONE_OFFSETS[level])
  const master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(ctx.destination)

  const sine = ctx.createOscillator()
  sine.type = 'sine'
  sine.frequency.value = freq
  const sineGain = ctx.createGain()
  sineGain.gain.setValueAtTime(1, now)
  sineGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
  sine.connect(sineGain).connect(master)

  const triangle = ctx.createOscillator()
  triangle.type = 'triangle'
  triangle.frequency.value = freq * 2
  const triangleGain = ctx.createGain()
  triangleGain.gain.setValueAtTime(0.6, now)
  triangleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
  triangle.connect(triangleGain).connect(master)

  sine.start(now)
  triangle.start(now)
  sine.stop(now + 0.1)
  triangle.stop(now + 0.1)
}

function playShielded(ctx: AudioContext): void {
  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(ctx.destination)

  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = 220
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 800
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.8, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)
  osc.connect(filter).connect(gain).connect(master)
  osc.start(now)
  osc.stop(now + 0.13)
}

function playWrong(ctx: AudioContext): void {
  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(ctx.destination)

  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = 110
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 400
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.8, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
  osc.connect(filter).connect(gain).connect(master)
  osc.start(now)
  osc.stop(now + 0.19)
}

/** Gated on `preferences.sound` — when false, no AudioContext is even constructed (never mind played). */
export function playFeedbackSound(outcome: Outcome, soundEnabled: boolean): void {
  if (!soundEnabled) return
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    if (outcome.kind === 'wrong') {
      playWrong(ctx)
    } else if (outcome.kind === 'shielded') {
      playShielded(ctx)
    } else {
      playCorrect(ctx, outcome.level)
    }
  } catch {
    // Degrade silently — audio is a nice-to-have, never load-bearing.
  }
}
