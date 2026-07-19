import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from './StatusBar'

describe('StatusBar', () => {
  it('renders the rating and streak pills', () => {
    render(<StatusBar rating={1342} streak={5} combo={0} solvedThisSession={3} />)
    expect(screen.getByText('1342')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('hides the combo badge below 2', () => {
    render(<StatusBar rating={1200} streak={0} combo={1} solvedThisSession={0} />)
    expect(screen.queryByTestId('combo-badge')).not.toBeInTheDocument()
  })

  it('hides the combo badge at 0', () => {
    render(<StatusBar rating={1200} streak={0} combo={0} solvedThisSession={0} />)
    expect(screen.queryByTestId('combo-badge')).not.toBeInTheDocument()
  })

  it('shows the combo badge at exactly 2', () => {
    render(<StatusBar rating={1200} streak={0} combo={2} solvedThisSession={0} />)
    const badge = screen.getByTestId('combo-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('2')
  })

  it('shows the combo badge above 2', () => {
    render(<StatusBar rating={1200} streak={0} combo={7} solvedThisSession={0} />)
    expect(screen.getByTestId('combo-badge')).toHaveTextContent('7')
  })

  it('shows the uncapped solved-this-session count', () => {
    render(<StatusBar rating={1200} streak={0} combo={0} solvedThisSession={42} />)
    expect(screen.getByText(/42/)).toBeInTheDocument()
  })
})
