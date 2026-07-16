/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { projectsApi, tasksApi } from '@/lib/api';
import { ManualTaskSelectDialog } from '../manual-task-select-dialog';

jest.mock('@/lib/api', () => ({
  projectsApi: {
    getAll: jest.fn(),
  },
  tasksApi: {
    getById: jest.fn(),
    getWorkspace: jest.fn(),
  },
}));

const task = {
  id: 'task-from-recommendation',
  title: 'おすすめされたタスク',
  description: 'このタスクをそのまま開始する',
  estimate_hours: 2,
  due_date: null,
  status: 'pending' as const,
  priority: 1,
  goal_id: 'goal-1',
  created_at: '2026-07-15T00:00:00Z',
  updated_at: '2026-07-15T00:00:00Z',
};

function renderDialog(onStart = jest.fn().mockResolvedValue(undefined)) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ManualTaskSelectDialog
        open
        onOpenChange={jest.fn()}
        isStarting={false}
        initialTaskId={task.id}
        onStart={onStart}
      />
    </QueryClientProvider>
  );

  return { onStart };
}

describe('ManualTaskSelectDialog recommended task flow', () => {
  it('loads the selected task directly and starts it without opening the task picker', async () => {
    jest.mocked(tasksApi.getById).mockResolvedValue(task);

    const { onStart } = renderDialog();

    expect(await screen.findByText(task.title)).toBeInTheDocument();
    expect(screen.getByText('開始するタスク')).toBeInTheDocument();
    expect(screen.getByText('タスク選択').closest('div')).toHaveClass('hidden');
    expect(tasksApi.getById).toHaveBeenCalledWith(task.id);
    expect(tasksApi.getWorkspace).not.toHaveBeenCalled();
    expect(projectsApi.getAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'セッション開始' }));

    await waitFor(() => {
      expect(onStart).toHaveBeenCalledWith(
        task.id,
        expect.any(String),
        undefined,
        true
      );
    });
  });

  it('limits the all-project picker to active projects', async () => {
    jest.mocked(projectsApi.getAll).mockResolvedValue([]);
    jest.mocked(tasksApi.getWorkspace).mockResolvedValue({
      items: [],
      total: 0,
      skip: 0,
      limit: 100,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ManualTaskSelectDialog
          open
          onOpenChange={jest.fn()}
          isStarting={false}
          onStart={jest.fn()}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(tasksApi.getWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ projectStatus: 'in_progress' })
      );
    });
  });
});
