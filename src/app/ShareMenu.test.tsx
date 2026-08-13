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
    text: 'share text',
    onShared: vi.fn(),
    ...overrides,
  }
}

describe('ShareMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when there are no actions', () => {
    const { container } = render(<ShareMenu actions={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a single action as a plain button, not a menu', () => {
    render(<ShareMenu actions={[makeAction()]} />)
    expect(screen.getByRole('button', { name: 'Share puzzle' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the single action fires onShared and copies its text', async () => {
    const user = userEvent.setup()
    const onShared = vi.fn()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    render(<ShareMenu actions={[makeAction({ onShared, text: 'hello world' })]} />)

    await user.click(screen.getByRole('button', { name: 'Share puzzle' }))

    expect(onShared).toHaveBeenCalledTimes(1)
    expect(writeTextSpy).toHaveBeenCalledWith('hello world')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    })
  })

  it('renders two actions behind a single Share trigger, items hidden until opened', () => {
    render(
      <ShareMenu
        actions={[makeAction(), makeAction({ id: 'challenge', label: 'Share challenge' })]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Share puzzle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Share challenge' })).not.toBeInTheDocument()
  })

  it('opens the menu on trigger click, showing both actions', async () => {
    const user = userEvent.setup()
    render(
      <ShareMenu
        actions={[makeAction(), makeAction({ id: 'challenge', label: 'Share challenge' })]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Share' }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Share puzzle' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Share challenge' })).toBeInTheDocument()
  })

  it('clicking a menu item fires its onShared, copies its text, and keeps the menu open showing the confirmation', async () => {
    const user = userEvent.setup()
    const onShared = vi.fn()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    render(
      <ShareMenu
        actions={[
          makeAction(),
          makeAction({
            id: 'challenge',
            label: 'Share challenge',
            copiedLabel: 'Link copied!',
            text: 'challenge text',
            onShared,
          }),
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('menuitem', { name: 'Share challenge' }))

    expect(onShared).toHaveBeenCalledTimes(1)
    expect(writeTextSpy).toHaveBeenCalledWith('challenge text')
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Link copied!' })).toBeInTheDocument()
    })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Share puzzle' })).toBeInTheDocument()
  })

  it('closes the menu when clicking outside it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <button type="button">outside</button>
        <ShareMenu
          actions={[makeAction(), makeAction({ id: 'challenge', label: 'Share challenge' })]}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'outside' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the menu on Escape', async () => {
    const user = userEvent.setup()
    render(
      <ShareMenu
        actions={[makeAction(), makeAction({ id: 'challenge', label: 'Share challenge' })]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('reopening the menu clears a previous copy confirmation', async () => {
    const user = userEvent.setup()
    render(
      <ShareMenu
        actions={[makeAction(), makeAction({ id: 'challenge', label: 'Share challenge' })]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('menuitem', { name: 'Share puzzle' }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Copied!' })).toBeInTheDocument()
    })
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Share' }))

    expect(screen.getByRole('menuitem', { name: 'Share puzzle' })).toBeInTheDocument()
  })

  it('uses native share instead of the clipboard when navigator.share is available, and closes the menu on success', async () => {
    const user = userEvent.setup()
    const shareSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
    })
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    try {
      render(
        <ShareMenu
          actions={[makeAction(), makeAction({ id: 'challenge', label: 'Share challenge' })]}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Share' }))
      await user.click(screen.getByRole('menuitem', { name: 'Share puzzle' }))

      await waitFor(() => {
        expect(shareSpy).toHaveBeenCalledWith({ text: 'share text' })
      })
      expect(writeTextSpy).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
    } finally {
      Reflect.deleteProperty(navigator, 'share')
    }
  })

  it('does not fall back to the clipboard when the user cancels the native share sheet', async () => {
    const user = userEvent.setup()
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    const shareSpy = vi.fn().mockRejectedValue(abortError)
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
    })
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    try {
      render(<ShareMenu actions={[makeAction()]} />)

      await user.click(screen.getByRole('button', { name: 'Share puzzle' }))

      await waitFor(() => {
        expect(shareSpy).toHaveBeenCalled()
      })
      expect(writeTextSpy).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(navigator, 'share')
    }
  })

  it('falls back to the clipboard when native share rejects with a real error', async () => {
    const user = userEvent.setup()
    const shareSpy = vi.fn().mockRejectedValue(new Error('not allowed'))
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
    })
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    try {
      render(<ShareMenu actions={[makeAction()]} />)

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
})
