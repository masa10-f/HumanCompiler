// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { toast } from '@/hooks/use-toast';
import { schedulingApi, tasksApi, workSessionsApi } from '@/lib/api';
import { RunnerPage } from '../runner-page';

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));
jest.mock('@/hooks/use-reschedule', () => ({
  useReschedule: () => ({
    acceptSuggestion: jest.fn(),
    rejectSuggestion: jest.fn(),
    isAccepting: false,
    isRejecting: false,
  }),
}));
jest.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({
    currentNotification: null,
    dismissNotification: jest.fn(),
    snooze: jest.fn(),
    isSnoozing: false,
  }),
}));
jest.mock('@/hooks/use-project-query', () => ({
  useProjectOptions: () => ({ data: [], isLoading: false }),
}));
jest.mock('@/components/layout/app-header', () => ({ AppHeader: () => null }));
jest.mock('../task-notes-section', () => ({ TaskNotesSection: () => null }));
jest.mock('@/lib/api', () => ({
  schedulingApi: { getByDate: jest.fn() },
  tasksApi: { getById: jest.fn(), getWorkspace: jest.fn() },
  goalsApi: { getById: jest.fn() },
  projectsApi: { getById: jest.fn() },
  workSessionsApi: {
    getCurrent: jest.fn(),
    getUnresponsive: jest.fn(),
    getResumeContext: jest.fn(),
    start: jest.fn(),
  },
}));

function assignment(taskId: string, title: string, startTime: string, hours: number) {
  return {
    task_id: taskId,
    task_title: title,
    goal_id: taskId.startsWith('quick_') ? '' : 'goal-1',
    project_id: taskId.startsWith('quick_') ? '' : 'project-1',
    slot_index: 0,
    start_time: startTime,
    duration_hours: hours,
    slot_start: startTime,
    slot_end: startTime,
    slot_kind: 'focused_work',
  };
}

// The daily plan note places Quick Tasks and can split one task into blocks.
const todaySchedule = {
  id: 'schedule-1',
  user_id: 'user-1',
  date: '2026-09-28T00:00:00',
  plan_json: {
    success: true,
    assignments: [
      assignment('quick_11111111-1111-4111-8111-111111111111', 'Quick inbox item', '09:00', 0.5),
      assignment('task-a', 'Write draft', '09:30', 1.5),
      assignment('task-b', 'Review figures', '11:00', 1),
      assignment('task-a', 'Write draft', '12:00', 0.5),
    ],
    unscheduled_tasks: [],
  },
};

const task = {
  id: 'task-a',
  title: 'Write draft',
  description: null,
  estimate_hours: 2,
  due_date: null,
  status: 'pending',
  priority: 1,
  goal_id: 'goal-1',
  created_at: '2026-09-28T00:00:00Z',
  updated_at: '2026-09-28T00:00:00Z',
};

function renderRunner(url: string) {
  window.history.replaceState({}, '', url);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RunnerPage />
    </QueryClientProvider>
  );
}

describe('RunnerPage session start', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(workSessionsApi.getCurrent).mockResolvedValue(null);
    jest.mocked(workSessionsApi.getUnresponsive).mockResolvedValue(null);
    jest.mocked(workSessionsApi.getResumeContext).mockResolvedValue(null);
    jest.mocked(tasksApi.getById).mockResolvedValue(task as never);
  });

  it("starts the task picked from today's list, without Quick Tasks or duplicates", async () => {
    jest.mocked(schedulingApi.getByDate).mockResolvedValue(todaySchedule as never);
    jest.mocked(workSessionsApi.start).mockResolvedValue({} as never);
    renderRunner('/runner');

    expect(await screen.findByText('本日のタスク')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Write draft/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Write draft/ })).toHaveTextContent('09:30 (1.5h)');
    expect(screen.queryByRole('button', { name: /Quick inbox item/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Review figures/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Quick inbox item')).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2);
    expect(within(dialog).getByRole('radio', { name: 'Review figures' })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    fireEvent.click(within(dialog).getByRole('button', { name: '開始' }));

    await waitFor(() => {
      expect(workSessionsApi.start).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: 'task-b', is_manual_execution: false })
      );
    });
  });

  it('reports a failed start from the task list and keeps the dialog open', async () => {
    jest.mocked(schedulingApi.getByDate).mockResolvedValue(todaySchedule as never);
    jest
      .mocked(workSessionsApi.start)
      .mockRejectedValue(new Error('An active session already exists. Please end it first.'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    renderRunner('/runner?taskId=task-a');

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Write draft')).toBeInTheDocument();
    const startButton = within(dialog).getByRole('button', { name: 'セッション開始' });
    await waitFor(() => expect(startButton).toBeEnabled());

    fireEvent.click(startButton);

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'セッションを開始できませんでした',
          description: 'An active session already exists. Please end it first.',
          variant: 'destructive',
        })
      );
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Write draft')).toBeInTheDocument();
  });
});
