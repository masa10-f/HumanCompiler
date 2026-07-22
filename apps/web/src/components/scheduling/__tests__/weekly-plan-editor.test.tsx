/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { tasksApi } from '@/lib/api';
import type { WeeklyPlanResponse } from '@/types/ai-planning';
import { WeeklyPlanEditor } from '../weekly-plan-editor';

jest.mock('@/lib/api', () => ({
  tasksApi: { getWorkspace: jest.fn() },
}));

const backlogTask = {
  id: 'task-backlog',
  title: 'Backlog task',
  description: null,
  memo: null,
  estimate_hours: 3,
  due_date: null,
  status: 'pending' as const,
  work_type: 'deep_work' as const,
  priority: 2,
  goal_id: 'goal-1',
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
  dependencies: [],
  project_id: 'project-1',
  project_title: 'Project',
  goal_title: 'Goal',
  remaining_estimate_hours: 3,
  is_blocked: false,
  is_ready: true,
  blocking_task_ids: [],
  last_worked_at: null,
  planned_today: false,
  planned_today_unplaced: false,
  planned_this_week: false,
};

const plan: WeeklyPlanResponse = {
  success: true,
  week_start_date: '2026-07-20',
  total_planned_hours: 2,
  task_plans: [{
    task_id: 'task-selected',
    task_title: 'Selected task',
    estimated_hours: 2,
    priority: 1,
    rationale: 'test',
  }],
  assigned_task_hours: { 'task-selected': 2 },
  project_allocations: [{
    project_id: 'project-1',
    project_title: 'Project',
    target_hours: 4,
    max_hours: 6,
    priority_weight: 1,
  }],
  recommendations: [],
  insights: [],
  generated_at: '2026-07-20T00:00:00Z',
};

function renderEditor(onChange = jest.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WeeklyPlanEditor
        plan={plan}
        capacityHours={1}
        canRecalculate
        projects={[{
          id: 'project-1',
          title: 'Project',
          description: null,
          status: 'in_progress',
          owner_id: 'user-1',
          created_at: '2026-07-20T00:00:00Z',
          updated_at: '2026-07-20T00:00:00Z',
        }]}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('WeeklyPlanEditor', () => {
  it('shows capacity and allocation feedback and supports keyboard-friendly add', async () => {
    jest.mocked(tasksApi.getWorkspace).mockResolvedValue({
      items: [
        backlogTask,
        { ...backlogTask, id: 'task-selected', title: 'Selected task' },
      ],
      total: 2,
      skip: 0,
      limit: 100,
    });
    const onChange = renderEditor();

    const addButton = await screen.findByRole('button', { name: 'Backlog taskを今週に追加' });
    expect(screen.getByText('1.0h 超過')).toBeInTheDocument();
    expect(screen.getByText(/実績 2.0h \/ 目標 4.0h/)).toBeInTheDocument();
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          task_plans: expect.arrayContaining([
            expect.objectContaining({ task_id: backlogTask.id }),
          ]),
        }),
      );
    });
  });
});
