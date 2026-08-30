import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export type RovingAxis = 'vertical' | 'horizontal'

export interface RovingFocusItemProps {
  tabIndex: 0 | -1
  ref: (el: HTMLElement | null) => void
  onFocus: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

/**
 * Roving-tabindex arrow-key navigation (the standard radiogroup/listbox
 * pattern) for a flat list of `count` focusable items — one shared hook for
 * every quiz interaction's choice list (Mcq, CheckpointPanel) and line list
 * (TapLine via CodeSnippet, SwipeBinary's two fallback buttons), rather than
 * four separate re-implementations. Generalizes the `selected`-on-focus
 * pattern DragOrder.tsx already uses for its own rows.
 *
 * Only one item is ever tabbable at a time (`tabIndex={0}` on the roving
 * index, `-1` on every other item) — Tab always lands exactly where arrow
 * navigation left off, and Shift+Tab/Tab still leave the list entirely as
 * usual. `onFocus` syncs the roving index to whatever actually received
 * focus (a mouse click, or Tab landing on the list for the first time), so
 * arrow keys always continue from the truly focused item, not a stale one.
 *
 * Deliberately does NOT handle Enter/Space — every consumer's items are
 * real `<button>` elements, and the browser's own native activation
 * behavior already fires their `onClick` (and therefore the interaction's
 * `onCommit`) on Enter or Space once an item has real DOM focus. This hook
 * only has to get real focus onto the right item; commit follows for free.
 */
export function useRovingFocus(count: number, locked: boolean, axis: RovingAxis = 'vertical') {
  const [focused, setFocused] = useState(0)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  const nextKey = axis === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const prevKey = axis === 'vertical' ? 'ArrowUp' : 'ArrowLeft'

  function moveFocus(index: number) {
    setFocused(index)
    itemRefs.current[index]?.focus()
  }

  function itemProps(index: number): RovingFocusItemProps {
    return {
      tabIndex: focused === index ? 0 : -1,
      ref: (el) => {
        itemRefs.current[index] = el
      },
      onFocus: () => {
        setFocused(index)
      },
      onKeyDown: (event) => {
        if (locked || count <= 1) return
        if (event.key === nextKey) {
          event.preventDefault()
          moveFocus((index + 1) % count)
        } else if (event.key === prevKey) {
          event.preventDefault()
          moveFocus((index - 1 + count) % count)
        }
      },
    }
  }

  return { itemProps }
}
