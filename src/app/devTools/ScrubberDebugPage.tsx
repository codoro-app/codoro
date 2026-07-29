/**
 * Bare, dev-only harness for stepping through a scrubber puzzle's trace and
 * answering its checkpoints — the Phase 2 spike's proof that the format is
 * playable at all. Deliberately ugly (`<pre>`-grade): the deliverable this
 * phase is the trace format, engine scoring, and generator tooling, not UI
 * polish, which is explicitly out of scope until Phase 3.
 *
 * Self-checks `import.meta.env.DEV` at render time, same belt-and-suspenders
 * pattern as DevPuzzleToggle/devPuzzleMode — the mount site below also only
 * renders this behind the same check, so an accidental unconditional import
 * still can't surface it in a built app, and Vite inlines the check as a
 * literal `false` in production, letting Rollup drop this whole subtree
 * (including this component) from the bundle. Verified by grepping `dist/`
 * after a production build, not just by reasoning about it — see the Phase 2
 * go/no-go amendment.
 *
 * All local plumbing (step/checkpoint state) lives entirely in this file —
 * no interactionTypes.ts/CommitPayload/PuzzleCardShell changes. That shape
 * assumes one commit per puzzle; a scrubber attempt has N per-checkpoint
 * commits, which is Phase 3's reshaping job once the real UI is in hand.
 */
import { useState } from 'react'
import { scrubberPool } from '../../content'
import type { ScrubberPuzzle } from '../../content'
import { scoreScrubberAttempt } from '../../engine'
import type { CheckpointResult } from '../../engine'

export function ScrubberDebugPage() {
  // Hooks must run unconditionally on every render (rules-of-hooks) — the
  // DEV self-check below returns null AFTER them, not before. The mount
  // site in App.tsx is what actually keeps this component out of a
  // production render tree; this is the same belt-and-suspenders guard
  // DevPuzzleToggle uses, just placed where React allows it.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (!import.meta.env.DEV) return null

  const selected = scrubberPool.find((puzzle) => puzzle.id === selectedId) ?? null

  return (
    <div className="app-shell__main">
      <pre>
        {'=== Scrubber debug harness (dev only) ===\n'}
        {'This route does not exist in a production build.\n'}
      </pre>
      {selected ? (
        <ScrubberRunner
          key={selected.id}
          puzzle={selected}
          onExit={() => {
            setSelectedId(null)
          }}
        />
      ) : (
        <PuzzlePicker puzzles={scrubberPool} onSelect={setSelectedId} />
      )}
    </div>
  )
}

function PuzzlePicker({
  puzzles,
  onSelect,
}: {
  puzzles: readonly ScrubberPuzzle[]
  onSelect: (id: string) => void
}) {
  if (puzzles.length === 0) {
    return <pre>No scrubber puzzles in the pool.</pre>
  }
  return (
    <pre>
      {puzzles.map((puzzle) => (
        <div key={puzzle.id}>
          <button
            type="button"
            onClick={() => {
              onSelect(puzzle.id)
            }}
          >
            [{puzzle.id}] {puzzle.pattern} ({puzzle.language}, {puzzle.difficulty_rating}) —{' '}
            {puzzle.steps.length} steps, {puzzle.checkpoints.length} checkpoints
          </button>
        </div>
      ))}
    </pre>
  )
}

function ScrubberRunner({ puzzle, onExit }: { puzzle: ScrubberPuzzle; onExit: () => void }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [results, setResults] = useState<CheckpointResult[]>([])

  const lines = puzzle.snippet.split('\n')
  const step = puzzle.steps[stepIndex]
  if (!step) {
    throw new Error(`ScrubberRunner: stepIndex ${String(stepIndex)} out of range`)
  }

  // The next checkpoint not yet answered — results[i] always corresponds to
  // checkpoints[i], since checkpoints are answered strictly in order. Only
  // non-undefined when the scrubber has actually arrived at that
  // checkpoint's step; everywhere below reads this instead of re-deriving
  // "are we there yet" separately, so TS keeps it narrowed.
  const pendingCheckpoint = puzzle.checkpoints[results.length]
  const checkpointHere = pendingCheckpoint?.afterStep === stepIndex ? pendingCheckpoint : undefined
  const allAnswered = results.length === puzzle.checkpoints.length
  const atFinalStep = stepIndex === puzzle.steps.length - 1
  const lastResult = results.at(-1)
  const lastCheckpoint = results.length > 0 ? puzzle.checkpoints[results.length - 1] : undefined

  function answerCheckpoint(choiceIndex: number) {
    if (!checkpointHere) return
    const result: CheckpointResult = {
      correct: choiceIndex === checkpointHere.correct,
      choiceIndex,
    }
    setResults((prev) => [...prev, result])
  }

  return (
    <pre>
      {'--- '}
      {puzzle.id}
      {' ---\n'}
      {puzzle.prompt}
      {'\n\n'}
      {lines.map((lineText, i) => `${i === step.line ? '->' : '  '} ${String(i)}  ${lineText}\n`)}
      {'\nvars:\n'}
      {Object.entries(step.vars)
        .map(([name, value]) => `  ${name} = ${value}\n`)
        .join('')}
      {step.output !== undefined ? `output so far: ${step.output}\n` : ''}
      {'\n'}

      {checkpointHere ? (
        <div>
          {'checkpoint ('}
          {checkpointHere.question}
          {checkpointHere.target ? `: ${checkpointHere.target}` : ''}
          {'):\n'}
          {checkpointHere.choices.map((choice, i) => (
            <div key={i}>
              <button
                type="button"
                onClick={() => {
                  answerCheckpoint(i)
                }}
              >
                {choice}
              </button>
            </div>
          ))}
        </div>
      ) : lastResult && lastCheckpoint && !atFinalStep ? (
        <div>
          {'last answer: '}
          {lastResult.correct ? 'correct' : 'incorrect'}
          {' (correct choice was "'}
          {lastCheckpoint.choices[lastCheckpoint.correct] ?? ''}
          {'")\n'}
        </div>
      ) : null}

      {!checkpointHere && !atFinalStep && (
        <button
          type="button"
          onClick={() => {
            setStepIndex((i) => Math.min(i + 1, puzzle.steps.length - 1))
          }}
        >
          Next step
        </button>
      )}

      {atFinalStep && allAnswered && (
        <div>
          {'\n=== '}
          {scoreScrubberAttempt(results) ? 'SOLVED' : 'FAILED'}
          {' ==='}
          {'\n'}
          {puzzle.explanation}
        </div>
      )}

      <div>
        <button type="button" onClick={onExit}>
          Back to puzzle list
        </button>
      </div>
    </pre>
  )
}
