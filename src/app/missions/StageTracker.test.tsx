import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StageTracker } from './StageTracker'
import type { MissionStageSummary } from '../../storage'

const traceCompleted: MissionStageSummary = {
  stats: { stageId: 'trace', puzzlesCompleted: 3, solvedCount: 3 },
  endedReason: 'native',
  completedAt: '2026-08-12T18:00:00.000Z',
}

describe('StageTracker variant="mobile"', () => {
  it('renders collapsed by default: no per-stage label text, just a summary aria-label', () => {
    render(
      <StageTracker currentStage="speed" completedStages={[traceCompleted]} variant="mobile" />,
    )

    const toggle = screen.getByRole('button', { name: /stage 2 of 3.*speed round/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Collapsed: no stage label text anywhere yet (icons/dots only).
    expect(screen.queryByText('Speed Round')).not.toBeInTheDocument()
    expect(screen.queryByText('Boss')).not.toBeInTheDocument()
  })

  it('expands on tap to show every stage’s label, description, and status; collapses again on a second tap', async () => {
    const user = userEvent.setup()
    render(
      <StageTracker currentStage="speed" completedStages={[traceCompleted]} variant="mobile" />,
    )

    const toggle = screen.getByRole('button', { name: /stage 2 of 3/i })
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Trace')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Speed Round')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Boss')).toBeInTheDocument()
    expect(screen.getByText('Up next')).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Speed Round')).not.toBeInTheDocument()
  })
})

describe('StageTracker variant="desktop"', () => {
  it('renders every stage’s label persistently, no expand/collapse control', () => {
    render(
      <StageTracker currentStage="boss" completedStages={[traceCompleted]} variant="desktop" />,
    )

    expect(screen.getByText('Trace')).toBeInTheDocument()
    expect(screen.getByText('Speed Round')).toBeInTheDocument()
    expect(screen.getByText('Boss')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('marks the current stage distinctly from completed/upcoming ones', () => {
    render(
      <StageTracker currentStage="boss" completedStages={[traceCompleted]} variant="desktop" />,
    )

    // Trace: completed, Speed: upcoming (not yet reached), Boss: current.
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Trace')
    expect(items[0]).toHaveTextContent('Done')
    expect(items[1]).toHaveTextContent('Speed Round')
    expect(items[1]).toHaveTextContent('Up next')
    expect(items[2]).toHaveTextContent('Boss')
    expect(items[2]).toHaveTextContent('In progress')
  })
})
