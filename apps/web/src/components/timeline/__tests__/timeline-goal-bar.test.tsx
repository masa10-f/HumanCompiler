import { fireEvent, render, screen } from '@testing-library/react'
import { TimelineGoalBar } from '../timeline-goal-bar'
import type { LayoutGoal } from '@/lib/timeline/types'

const task = {
  id: 'task-1',
  goal_id: 'goal-1',
  title: '操作できるタスク',
  description: null,
  status: 'in_progress' as const,
  estimate_hours: 4,
  due_date: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  progress_percentage: 50,
  status_color: '#2563eb',
  actual_hours: 2,
  logs_count: 1,
}

const goal: LayoutGoal = {
  id: 'goal-1',
  title: '操作できるゴール',
  row: 0,
  x0: 340,
  x1: 640,
  progress: 0.5,
  status: 'in_progress',
  segments: [
    {
      id: 'goal-1-task-1',
      task_id: task.id,
      title: task.title,
      x0: 340,
      x1: 640,
      progress: 0.5,
      progress_percentage: 50,
      status_color: task.status_color,
      originalTask: task,
    },
  ],
  originalGoal: {
    id: 'goal-1',
    title: '操作できるゴール',
    description: null,
    status: 'in_progress',
    estimate_hours: 4,
    start_date: '2026-07-01T00:00:00Z',
    end_date: '2026-07-08T00:00:00Z',
    due_date: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    dependencies: [],
    tasks: [task],
  },
}

const dimensions = {
  row_height: 108,
  goal_bar_height: 42,
  goal_bar_offset_y: 47,
  padding: { top: 72, left: 330 },
}

describe('TimelineGoalBar interactions', () => {
  it('opens a goal with Enter', () => {
    const onGoalClick = jest.fn()
    render(
      <svg>
        <TimelineGoalBar
          goal={goal}
          dimensions={dimensions}
          isSelected={false}
          onGoalClick={onGoalClick}
          onTaskClick={jest.fn()}
          showTaskSegments
        />
      </svg>,
    )

    fireEvent.keyDown(screen.getByRole('button', { name: /ゴール 操作できるゴール/ }), {
      key: 'Enter',
    })

    expect(onGoalClick).toHaveBeenCalledWith(goal, expect.any(Object))
  })

  it('opens a task with Space', () => {
    const onTaskClick = jest.fn()
    render(
      <svg>
        <TimelineGoalBar
          goal={goal}
          dimensions={dimensions}
          isSelected={false}
          onGoalClick={jest.fn()}
          onTaskClick={onTaskClick}
          showTaskSegments
        />
      </svg>,
    )

    fireEvent.keyDown(screen.getByRole('button', { name: /タスク 操作できるタスク/ }), {
      key: ' ',
    })

    expect(onTaskClick).toHaveBeenCalledWith(goal.segments[0], expect.any(Object))
  })

  it('opens a task from its full visible segment area', () => {
    const onGoalClick = jest.fn()
    const onTaskClick = jest.fn()
    const { container } = render(
      <svg>
        <TimelineGoalBar
          goal={goal}
          dimensions={dimensions}
          isSelected={false}
          onGoalClick={onGoalClick}
          onTaskClick={onTaskClick}
          showTaskSegments
        />
      </svg>,
    )
    const hitArea = container.querySelector(
      '[data-task-hit-area="task-1"]',
    )

    expect(hitArea).toHaveAttribute('fill', 'transparent')
    fireEvent.click(hitArea!)

    expect(onTaskClick).toHaveBeenCalledWith(goal.segments[0], expect.any(Object))
    expect(onGoalClick).not.toHaveBeenCalled()
  })
})
