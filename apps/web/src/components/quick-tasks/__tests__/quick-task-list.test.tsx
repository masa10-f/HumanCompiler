/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { toast } from '@/hooks/use-toast';
import { quickTasksApi } from '@/lib/api';
import type { QuickTask } from '@/types/quick-task';
import { QuickTaskList } from '../quick-task-list';

jest.mock('@/lib/api', () => ({
  quickTasksApi: {
    getAll: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@/hooks/use-toast', () => ({
  toast: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  log: {
    error: jest.fn(),
  },
}));

jest.mock('../quick-task-form-dialog', () => ({
  QuickTaskFormDialog: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const task: QuickTask = {
  id: 'quick-task-1',
  owner_id: 'user-1',
  title: 'テストタスク',
  description: null,
  estimate_hours: 0.5,
  due_date: null,
  status: 'pending',
  work_type: 'light_work',
  priority: 3,
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:00:00Z',
};

const otherTask: QuickTask = {
  ...task,
  id: 'quick-task-2',
  title: '別のテストタスク',
};

describe('QuickTaskList completion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(quickTasksApi.getAll).mockResolvedValue([task]);
  });

  it('marks a quick task as completed and removes it from the active list', async () => {
    jest.mocked(quickTasksApi.update).mockResolvedValue({
      ...task,
      status: 'completed',
    });

    render(<QuickTaskList />);

    fireEvent.click(await screen.findByRole('button', { name: '「テストタスク」を完了' }));

    await waitFor(() => {
      expect(quickTasksApi.update).toHaveBeenCalledWith(task.id, { status: 'completed' });
    });
    await waitFor(() => {
      expect(screen.queryByText(task.title)).not.toBeInTheDocument();
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'クイックタスクを完了しました' })
    );
  });

  it('keeps the quick task visible when completion fails', async () => {
    jest.mocked(quickTasksApi.update).mockRejectedValue(new Error('network error'));

    render(<QuickTaskList />);

    fireEvent.click(await screen.findByRole('button', { name: '「テストタスク」を完了' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'エラー',
          variant: 'destructive',
        })
      );
    });
    expect(screen.getByText(task.title)).toBeInTheDocument();
  });

  it('allows different quick tasks to be completed concurrently', async () => {
    jest.mocked(quickTasksApi.getAll).mockResolvedValue([task, otherTask]);

    let resolveFirst!: (value: QuickTask) => void;
    let resolveSecond!: (value: QuickTask) => void;
    jest.mocked(quickTasksApi.update)
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveSecond = resolve;
        })
      );

    render(<QuickTaskList />);

    fireEvent.click(await screen.findByRole('button', { name: '「テストタスク」を完了' }));
    fireEvent.click(screen.getByRole('button', { name: '「別のテストタスク」を完了' }));

    expect(quickTasksApi.update).toHaveBeenNthCalledWith(1, task.id, { status: 'completed' });
    expect(quickTasksApi.update).toHaveBeenNthCalledWith(2, otherTask.id, { status: 'completed' });

    await act(async () => {
      resolveFirst({ ...task, status: 'completed' });
      resolveSecond({ ...otherTask, status: 'completed' });
    });
  });
});
