import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareMenu } from './ShareMenu'
import type { ShareAction } from './ShareMenu'

function makeAction(overrides: Partial<ShareAction> = {}): ShareAction {
  return {
    id: 'puzzle',
    label: 'Share puzzle',
    copiedLabel: 'Copied!',
    copyAriaLabel: 'Copy puzzle link',
    text: 'share text',
    onShared: vi.fn(),
    ...overrides,
  }
}

// Locates the full-viewport scrim behind the open sheet — its previous DOM
// sibling (2b.13: scrim and sheet render as siblings, not parent/child —
// see ShareMenu.tsx's render). Clicking it is how every "dismiss" test
// below closes the sheet, matching what a real click "outside" the sheet
// does now that dismissal is scrim-driven rather than a document-level
// outside-click listener (2b.11 — a modal sheet should block interaction
// with the rest of the page while open, which the scrim already does
// visually; there's no longer a separate document listener to also close
// on a click that lands on some unrelated page element).
function getScrim(): HTMLElement {
  const dialog = screen.getByRole('dialog')
  const scrim = dialog.previousElementSibling
  if (!(scrim instanceof HTMLElement)) {
    throw new Error('expected the sheet dialog to have a scrim previous sibling')
  }
  return scrim
}

describe('ShareMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when there are no actions', () => {
    const { container } = render(<ShareMenu actions={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a "Share" trigger even for a single action — no special-cased inline button', () => {
    render(<ShareMenu actions={[makeAction()]} />)
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the sheet on trigger click, showing the single action as a full row', async () => {
    const user = userEvent.setup()
    render(<ShareMenu actions={[makeAction()]} />)

    await user.click(screen.getByRole('button', { name: 'Share' }))

    expect(screen.getByRole('dialog', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share puzzle' })).toBeInTheDocument()
  })

  it('opens the sheet showing every action when there are several', async () => {
    const user = userEvent.setup()
    render(
      <ShareMenu
        actions={[makeAction(), makeAction({ id: 'challenge', label: 'Share challenge' })]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Share' }))

    expect(screen.getByRole('button', { name: 'Share puzzle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share challenge' })).toBeInTheDocument()
  })

  it("shows each action's description under its label, without it leaking into the row's accessible name", async () => {
    const user = userEvent.setup()
    render(
      <ShareMenu actions={[makeAction({ description: 'Copy a link to this exact puzzle' })]} />,
    )

    await user.click(screen.getByRole('button', { name: 'Share' }))

    expect(screen.getByText('Copy a link to this exact puzzle')).toBeInTheDocument()
    // Exact-name match would fail if the description text had folded into
    // the button's computed accessible name (aria-describedby keeps it out).
    expect(screen.getByRole('button', { name: 'Share puzzle' })).toBeInTheDocument()
  })

  it('clicking a row label fires onShared, copies its text, and swaps the label to confirm — the sheet stays open', async () => {
    const user = userEvent.setup()
    const onShared = vi.fn()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    render(<ShareMenu actions={[makeAction({ onShared, text: 'hello world' })]} />)

    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('button', { name: 'Share puzzle' }))

    expect(onShared).toHaveBeenCalledTimes(1)
    expect(writeTextSpy).toHaveBeenCalledWith('hello world')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it("clicking a row's dedicated copy-icon button always force-copies, even with navigator.share available, and keeps the sheet open", async () => {
    const user = userEvent.setup()
    const onShared = vi.fn()
    const shareSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true })
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    try {
      render(<ShareMenu actions={[makeAction({ onShared, text: 'hello world' })]} />)

      await user.click(screen.getByRole('button', { name: 'Share' }))
      await user.click(screen.getByRole('button', { name: 'Copy puzzle link' }))

      expect(shareSpy).not.toHaveBeenCalled()
      expect(writeTextSpy).toHaveBeenCalledWith('hello world')
      expect(onShared).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
      })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(navigator, 'share')
    }
  })

  it('uses native share instead of the clipboard when navigator.share is available, and closes the sheet on success', async () => {
    const user = userEvent.setup()
    const shareSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true })
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    try {
      render(<ShareMenu actions={[makeAction()]} />)

      await user.click(screen.getByRole('button', { name: 'Share' }))
      await user.click(screen.getByRole('button', { name: 'Share puzzle' }))

      await waitFor(() => {
        expect(shareSpy).toHaveBeenCalledWith({ text: 'share text' })
      })
      expect(writeTextSpy).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    } finally {
      Reflect.deleteProperty(navigator, 'share')
    }
  })

  it('does not fall back to the clipboard when the user cancels the native share sheet', async () => {
    const user = userEvent.setup()
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    const shareSpy = vi.fn().mockRejectedValue(abortError)
    Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true })
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    try {
      render(<ShareMenu actions={[makeAction()]} />)

      await user.click(screen.getByRole('button', { name: 'Share' }))
      await user.click(screen.getByRole('button', { name: 'Share puzzle' }))

      await waitFor(() => {
        expect(shareSpy).toHaveBeenCalled()
      })
      expect(writeTextSpy).not.toHaveBeenCalled()
      // 2b.15: dismissing the native OS share sheet must return the user
      // to THIS sheet, still open — not drop them past it to whatever's
      // underneath (reported on-device).
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(navigator, 'share')
    }
  })

  it('falls back to the clipboard when native share rejects with a real error', async () => {
    const user = userEvent.setup()
    const shareSpy = vi.fn().mockRejectedValue(new Error('not allowed'))
    Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true })
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    try {
      render(<ShareMenu actions={[makeAction()]} />)

      await user.click(screen.getByRole('button', { name: 'Share' }))
      await user.click(screen.getByRole('button', { name: 'Share puzzle' }))

      await waitFor(() => {
        expect(writeTextSpy).toHaveBeenCalledWith('share text')
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
      })
    } finally {
      Reflect.deleteProperty(navigator, 'share')
    }
  })

  it('closes the sheet when clicking the scrim', async () => {
    const user = userEvent.setup()
    render(<ShareMenu actions={[makeAction()]} />)

    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(getScrim())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not close when clicking inside the sheet itself', async () => {
    const user = userEvent.setup()
    render(<ShareMenu actions={[makeAction()]} />)

    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('dialog'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes the sheet on Escape', async () => {
    const user = userEvent.setup()
    render(<ShareMenu actions={[makeAction()]} />)

    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reopening the sheet clears a previous copy confirmation', async () => {
    const user = userEvent.setup()
    render(<ShareMenu actions={[makeAction()]} />)

    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('button', { name: 'Share puzzle' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    })
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Share' }))

    expect(screen.getByRole('button', { name: 'Share puzzle' })).toBeInTheDocument()
  })

  it('locks body scroll while open and restores it on close', async () => {
    const user = userEvent.setup()
    render(<ShareMenu actions={[makeAction()]} />)
    const originalOverflow = document.body.style.overflow

    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe(originalOverflow)
  })

  it('trigger="icon" renders a compact icon-only button with an accessible "Share" name, opening the same sheet', async () => {
    const user = userEvent.setup()
    render(<ShareMenu actions={[makeAction()]} trigger="icon" />)

    const trigger = screen.getByRole('button', { name: 'Share' })
    expect(trigger).toHaveAccessibleName('Share')
    expect(trigger).not.toHaveTextContent('Share')

    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share puzzle' })).toBeInTheDocument()
  })
})
