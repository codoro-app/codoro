import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StatusBar } from './StatusBar'

describe('StatusBar', () => {
  it('renders the rating and streak pills', () => {
    render(
      <StatusBar
        rating={1342}
        streak={5}
        combo={0}
        solvedThisSession={3}
        shields={0}
        soundEnabled
        onToggleSound={vi.fn()}
      />,
    )
    expect(screen.getByText('1342')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('hides the combo badge below 2', () => {
    render(
      <StatusBar
        rating={1200}
        streak={0}
        combo={1}
        solvedThisSession={0}
        shields={0}
        soundEnabled
        onToggleSound={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('combo-badge')).not.toBeInTheDocument()
  })

  it('hides the combo badge at 0', () => {
    render(
      <StatusBar
        rating={1200}
        streak={0}
        combo={0}
        solvedThisSession={0}
        shields={0}
        soundEnabled
        onToggleSound={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('combo-badge')).not.toBeInTheDocument()
  })

  it('shows the combo badge at exactly 2', () => {
    render(
      <StatusBar
        rating={1200}
        streak={0}
        combo={2}
        solvedThisSession={0}
        shields={0}
        soundEnabled
        onToggleSound={vi.fn()}
      />,
    )
    const badge = screen.getByTestId('combo-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('2')
  })

  it('shows the combo badge above 2', () => {
    render(
      <StatusBar
        rating={1200}
        streak={0}
        combo={7}
        solvedThisSession={0}
        shields={0}
        soundEnabled
        onToggleSound={vi.fn()}
      />,
    )
    expect(screen.getByTestId('combo-badge')).toHaveTextContent('7')
  })

  it('shows the uncapped solved-this-session count', () => {
    render(
      <StatusBar
        rating={1200}
        streak={0}
        combo={0}
        solvedThisSession={42}
        shields={0}
        soundEnabled
        onToggleSound={vi.fn()}
      />,
    )
    expect(screen.getByText(/42/)).toBeInTheDocument()
  })

  it('renders no shield pips at 0 shields', () => {
    render(
      <StatusBar
        rating={1200}
        streak={0}
        combo={2}
        solvedThisSession={0}
        shields={0}
        soundEnabled
        onToggleSound={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('shield-pip')).not.toBeInTheDocument()
  })

  it('renders one pip per banked shield', () => {
    render(
      <StatusBar
        rating={1200}
        streak={0}
        combo={3}
        solvedThisSession={0}
        shields={2}
        soundEnabled
        onToggleSound={vi.fn()}
      />,
    )
    expect(screen.getAllByTestId('shield-pip')).toHaveLength(2)
  })

  it('mute toggle reflects soundEnabled via aria-pressed and calls onToggleSound on click', () => {
    const onToggleSound = vi.fn()
    render(
      <StatusBar
        rating={1200}
        streak={0}
        combo={0}
        solvedThisSession={0}
        shields={0}
        soundEnabled
        onToggleSound={onToggleSound}
      />,
    )
    const toggle = screen.getByRole('button', { name: /mute|sound/i })
    // aria-pressed = muted; sound ON means not pressed.
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(onToggleSound).toHaveBeenCalledTimes(1)
  })

  it('mute toggle shows aria-pressed true when sound is off', () => {
    render(
      <StatusBar
        rating={1200}
        streak={0}
        combo={0}
        solvedThisSession={0}
        shields={0}
        soundEnabled={false}
        onToggleSound={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /mute|sound/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
