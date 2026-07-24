/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { toast } from '@/hooks/use-toast';
import { workSessionsApi } from '@/lib/api';
import { TaskSwitchDialog } from '../task-switch-dialog';

jest.mock('@/lib/api', () => ({
  workSessionsApi: { getResumeContext: jest.fn() },
}));
jest.mock('@/hooks/use-toast', () => ({
  toast: jest.fn(),
}));

const task = {
  id: 'task-next',
  title: 'Next task',
  description: null,
  memo: null,
  estimate_hours: 1,
  due_date: null,
  status: 'pending' as const,
  work_type: 'deep_work' as const,
  priority: 1,
  goal_id: 'goal-1',
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
  dependencies: [],
  project_id: 'project-1',
  project_title: 'Project',
  goal_title: 'Goal',
  remaining_estimate_hours: 1,
  is_blocked: false,
  is_ready: true,
  blocking_task_ids: [],
  last_worked_at: null,
  planned_today: false,
  planned_today_unplaced: false,
  planned_this_week: false,
};

describe('TaskSwitchDialog', () => {
  it('requires an interruption note for pause and shows resume context', async () => {
    jest.mocked(workSessionsApi.getResumeContext).mockResolvedValue({
      task_id: task.id,
      interruption_note: '前回の続き',
      interrupted_at: '2026-07-20T01:00:00Z',
      disposition: 'pause',
      remaining_estimate_hours: 0.75,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TaskSwitchDialog
          open
          onOpenChange={jest.fn()}
          task={task}
          isSwitching={false}
          onSwitch={jest.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: '記録して切替' })).toBeDisabled();
    expect(await screen.findByText(/前回の続き/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('中断メモ'), { target: { value: 'ここから再開' } });
    expect(screen.getByRole('button', { name: '記録して切替' })).toBeEnabled();
  });

  it('shows a switch error and keeps the dialog open', async () => {
    jest.mocked(workSessionsApi.getResumeContext).mockResolvedValue(null);
    const onOpenChange = jest.fn();
    const onSwitch = jest.fn().mockRejectedValue(new Error('Next task is blocked'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TaskSwitchDialog
          open
          onOpenChange={onOpenChange}
          task={task}
          isSwitching={false}
          onSwitch={onSwitch}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('中断メモ'), { target: { value: 'ここから再開' } });
    fireEvent.click(screen.getByRole('button', { name: '記録して切替' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: 'タスクの切替に失敗しました',
        description: 'Next task is blocked',
        variant: 'destructive',
      });
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('中断メモ')).toHaveValue('ここから再開');
  });
});
