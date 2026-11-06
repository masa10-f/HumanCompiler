import { fireEvent, render, screen } from '@testing-library/react'
import type { ProjectTimelineData, TimelineGoal } from '@/types/timeline'
import { TimelineVisualizer } from '../timeline-visualizer'

jest.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }))

const goal = (
  id: string,
  title: string,
  status: TimelineGoal['status'],
  dependencies: string[] = [],
): TimelineGoal => ({
  id,
  title,
  description: null,
  status,
  estimate_hours: 10,
  start_date: null,
  end_date: null,
  due_date: null,
  dependencies,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-05T00:00:00Z',
  tasks: [],
})

const data: ProjectTimelineData = {
  project: { id: 'p', title: 'Project', description: null, weekly_work_hours: 20, created_at: '', updated_at: '' },
  timeline: { start_date: '', end_date: '', time_unit: 'day' },
  goals: [goal('done', '完了した前提', 'completed'), goal('next', '次のゴール', 'pending', ['done'])],
}

describe('TimelineVisualizer', () => {
  beforeAll(() => {
    // jsdom does not implement scrolling.
    Element.prototype.scrollTo = jest.fn()
  })

  it('reveals hidden completed goals when navigating to one from the detail panel', () => {
    const { container } = render(
      <TimelineVisualizer data={data} isLoading={false} weeklyWorkHours={20} onRefresh={jest.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '完了済み' }))
    expect(container.querySelector('[data-goal-row="done"]')).toBeNull()

    fireEvent.click(container.querySelector('[data-goal-row="next"]')!)
    fireEvent.click(screen.getAllByRole('button', { name: /完了した前提/ })[0]!)

    expect(container.querySelector('[data-goal-row="done"]')).not.toBeNull()
    expect(screen.getAllByRole('region', { name: '完了した前提の詳細' }).length).toBeGreaterThan(0)
  })
})
