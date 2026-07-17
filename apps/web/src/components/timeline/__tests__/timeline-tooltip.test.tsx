import { fireEvent, render, screen } from '@testing-library/react'
import type { LayoutGoal } from '@/lib/timeline/types'
import {
  calculateTooltipLayout,
  TimelineTooltip,
} from '../timeline-tooltip'

const goal: LayoutGoal = {
  id: 'goal-1',
  title: '画面内に収まるゴール',
  row: 0,
  x0: 100,
  x1: 300,
  progress: 0.5,
  status: 'in_progress',
  segments: [],
  originalGoal: {
    id: 'goal-1',
    title: '画面内に収まるゴール',
    description: '詳細説明',
    status: 'in_progress',
    estimate_hours: 12,
    start_date: '2026-07-01T00:00:00Z',
    end_date: '2026-07-10T00:00:00Z',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    dependencies: [],
    tasks: [],
  },
}

describe('calculateTooltipLayout', () => {
  it('keeps a bottom-right tooltip inside the viewport', () => {
    expect(
      calculateTooltipLayout({
        anchor: { x: 1180, y: 780 },
        tooltipWidth: 384,
        tooltipHeight: 500,
        viewportWidth: 1200,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 800, top: 268, placement: 'top' })
  })

  it('places the tooltip below a top-left anchor', () => {
    expect(
      calculateTooltipLayout({
        anchor: { x: 4, y: 4 },
        tooltipWidth: 384,
        tooltipHeight: 500,
        viewportWidth: 1200,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 16, top: 16, placement: 'bottom' })
  })

  it('clamps an oversized tooltip to the viewport margin', () => {
    expect(
      calculateTooltipLayout({
        anchor: { x: 200, y: 250 },
        tooltipWidth: 900,
        tooltipHeight: 900,
        viewportWidth: 400,
        viewportHeight: 500,
      }),
    ).toEqual({ left: 16, top: 16, placement: 'bottom' })
  })
})

describe('TimelineTooltip dismissal', () => {
  it('closes from the viewport backdrop', () => {
    const onClose = jest.fn()
    render(
      <TimelineTooltip
        goal={goal}
        task={null}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
    fireEvent.click(screen.getByTestId('timeline-tooltip-backdrop'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes with Escape', () => {
    const onClose = jest.fn()
    render(
      <TimelineTooltip
        goal={goal}
        task={null}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps keyboard focus on the close button', () => {
    render(
      <TimelineTooltip
        goal={goal}
        task={null}
        position={{ x: 100, y: 100 }}
        onClose={jest.fn()}
      />,
    )

    const closeButton = screen.getByRole('button', { name: '閉じる' })
    fireEvent.keyDown(closeButton, { key: 'Tab' })

    expect(closeButton).toHaveFocus()
  })
})
