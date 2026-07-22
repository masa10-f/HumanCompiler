/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { tasksApi } from '@/lib/api';
import { TaskBulkToolbar } from '../task-bulk-toolbar';

jest.mock('@/lib/api', () => ({
  tasksApi: {
    previewBulk: jest.fn(),
    previewNaturalLanguage: jest.fn(),
    applyBulk: jest.fn(),
  },
}));

describe('TaskBulkToolbar', () => {
  it('never applies before preview confirmation', async () => {
    const preview = {
      mutations: [{ task_id: 'task-1', patch: { status: 'pending' }, plans: [] }],
      items: [{
        task_id: 'task-1',
        title: 'Task one',
        diffs: [{ field: 'status', before: 'in_progress', after: 'pending' }],
      }],
      affected_count: 1,
      warnings: [],
      expected_task_versions: { 'task-1': '2026-07-20T00:00:00Z' },
      expected_plan_versions: {},
    };
    jest.mocked(tasksApi.previewBulk).mockResolvedValue(preview);
    jest.mocked(tasksApi.applyBulk).mockResolvedValue(preview);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TaskBulkToolbar
          selectedTaskIds={['task-1']}
          goals={[]}
          onClear={jest.fn()}
          onApplied={jest.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '差分を確認' }));
    expect(tasksApi.applyBulk).not.toHaveBeenCalled();
    expect(await screen.findByText('1件の変更を適用しますか？')).toBeInTheDocument();
    expect(screen.getByText(/in_progress.*pending/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '確認して適用' }));
    await waitFor(() => expect(tasksApi.applyBulk).toHaveBeenCalledWith({
      mutations: preview.mutations,
      expected_task_versions: preview.expected_task_versions,
      expected_plan_versions: preview.expected_plan_versions,
    }));
  });
});
