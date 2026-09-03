/**
 * The single, first-class "Challenge a friend" affordance (challenge
 * redesign) — replaces every surface's own hand-rolled "Share challenge"
 * `ShareAction` (Practice/Daily/Rush/ChallengeComparison) and gives Boss a
 * challenge affordance for the first time. Per the design record: "one
 * challenge button, not two competing ones" — a single always-visible,
 * accent-filled button, never gated behind a streak or a finished run the
 * way the old per-surface cards were (Practice used to require
 * `streakAttempts.length > 0`; Daily/Rush/Boss only offered it at
 * completion). Each call site decides what `attempts` means for its own
 * mode (a live streak, a single just-answered puzzle, a finished run) —
 * this component doesn't care, it just encodes whatever it's given.
 *
 * Deliberately NOT styled like `ShareMenu`'s default `TRIGGER_CLASS` bordered
 * chip — the mockup calls for a prominent, accent-filled button that reads
 * as its own distinct affordance next to (not blended into) the plain
 * "Share puzzle"/"Share result" menu every surface keeps alongside it.
 *
 * Two controls, not one (post-launch feedback: on a Windows desktop,
 * `navigator.share` opens the OS's Nearby Share flyout, which has no "type
 * in an email/paste elsewhere" path at all — a share-or-copy button alone
 * left desktop users with no reliable way to actually get the link out).
 * The main button still prefers native share where it's actually useful
 * (mobile); the small dedicated icon button beside it always force-copies
 * the link to the clipboard, no `navigator.share` involved — exactly
 * `ShareMenu.tsx`'s own row shape (a label half that tries share-then-copy,
 * plus a copy-icon half that always just copies), reused here rather than
 * forked.
 *
 * Flow on click (either control):
 * 1. No `challengerName` yet (first-ever challenge from this profile) ->
 *    open `ChallengerNameSheet`, remembering which control was clicked.
 *    "Continue" persists the name (via the caller's `onNameNeeded`, e.g.
 *    `useChallengerName`'s `setName`) and dispatches that same action;
 *    "Skip" (or Escape, or the scrim) dispatches immediately with `null` —
 *    a blank/skipped name never blocks sharing (design decision).
 * 2. A `challengerName` already exists -> skip the sheet, dispatch
 *    immediately.
 * "Dispatch" means: build the payload (`buildChallengePayload`), fire
 * `trackChallengeCreate`, then either force-copy (the icon button) or hand
 * the message off to `shareOrCopy.ts`'s native-share/clipboard-fallback
 * logic (the main button) — the same util `ShareMenu.tsx` uses, not a
 * second fork of it.
 */
import { useState } from 'react'
import { buildChallengePayload, buildChallengeUrl } from '../challenge'
import type { ChallengeAttemptInput } from '../challenge'
import { trackChallengeCreate } from '../telemetry'
import type { ChallengeCreatePayload } from '../telemetry'
import { shareOrCopy } from './shareOrCopy'
import { ChallengerNameSheet } from './ChallengerNameSheet'
import { CopyIcon } from './Icons'
import { Tooltip } from './Tooltip'

export interface ChallengeButtonProps {
  /** This surface's attempts to encode — a live streak, a single just-answered puzzle, or a finished run's full attempt list. Renders nothing when empty (mirrors ShareMenu's own empty-actions self-hide). */
  attempts: readonly ChallengeAttemptInput[]
  surface: ChallengeCreatePayload['surface']
  /** A lowercase clause completing "Can you ...?" in the outbound share text — e.g. "beat my streak of 4" vs "beat this one" (Practice's two cases), "beat today's Daily", "beat my run of 8". */
  introLabel: string
  /** The player's saved display name, or null if never set — drives whether the name-prompt sheet opens first. */
  challengerName: string | null
  /** Persists a newly-entered name (e.g. `useChallengerName`'s `setName`). Only called when the player actually enters a name — never on skip. */
  onNameNeeded: (name: string) => Promise<void>
}

const BUTTON_ROW_CLASS = 'inline-flex items-stretch gap-2'

const BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1.5 min-h-11 py-2 px-4 rounded-sm border-0 bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const COPY_BUTTON_CLASS =
  'flex items-center justify-center shrink-0 min-w-11 min-h-11 rounded-sm border border-border bg-surface-1 text-accent cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

type ConfirmState = 'idle' | 'copied'
/** Which control was activated — decides share-or-copy vs. always-copy once a name is ready (see this file's module doc comment). */
type PendingAction = 'send' | 'copy'

export function ChallengeButton({
  attempts,
  surface,
  introLabel,
  challengerName,
  onNameNeeded,
}: ChallengeButtonProps) {
  // Non-null exactly while the name sheet is open; also records WHICH
  // control triggered it, so "Continue"/"Skip" dispatch the same action the
  // player actually clicked rather than always defaulting to share-or-copy.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>('idle')

  if (attempts.length === 0) return null

  async function dispatch(action: PendingAction, name: string | null) {
    const payload = buildChallengePayload([...attempts], name)
    const url = buildChallengeUrl(payload)
    const text = `Can you ${introLabel}? ${url}`
    // Fired on activation, before the share/copy resolves — matches every
    // other challenge-creating surface's pre-2b.4 "fire on click" convention
    // (see ShareAction.onShared's own doc comment in ShareMenu.tsx).
    trackChallengeCreate({ surface, puzzle_count: payload.ids.length })
    if (action === 'copy') {
      await navigator.clipboard.writeText(text)
      setConfirm('copied')
      return
    }
    const result = await shareOrCopy(text)
    // Only a real copy gets a lasting label swap — a completed native share
    // already had its own OS-level confirmation (the share sheet closing),
    // same reasoning ShareMenu's own `activate` uses for closing vs. not.
    setConfirm(result === 'copied' ? 'copied' : 'idle')
  }

  function handleClick(action: PendingAction) {
    if (challengerName === null) {
      setPendingAction(action)
      return
    }
    void dispatch(action, challengerName)
  }

  return (
    <>
      <div className={BUTTON_ROW_CLASS}>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => {
            handleClick('send')
          }}
        >
          {confirm === 'copied' ? 'Link copied!' : '⚔ Challenge a friend'}
        </button>
        <Tooltip label="Copy challenge link" className="shrink-0">
          <button
            type="button"
            aria-label="Copy challenge link"
            className={COPY_BUTTON_CLASS}
            onClick={() => {
              handleClick('copy')
            }}
          >
            <CopyIcon size={16} />
          </button>
        </Tooltip>
      </div>
      {pendingAction && (
        <ChallengerNameSheet
          onContinue={(name) => {
            const action = pendingAction
            setPendingAction(null)
            void onNameNeeded(name).then(() => dispatch(action, name))
          }}
          onSkip={() => {
            const action = pendingAction
            setPendingAction(null)
            void dispatch(action, null)
          }}
        />
      )}
    </>
  )
}
