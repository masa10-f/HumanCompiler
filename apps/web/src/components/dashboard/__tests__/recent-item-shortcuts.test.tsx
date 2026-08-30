import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { RecentItemShortcuts } from '../recent-item-shortcuts';
import { dashboardApi } from '@/lib/api';
import type { RecentDashboardItem } from '@/types/dashboard';

jest.mock('@/lib/api', () => ({
  dashboardApi: {
    getRecentItems: jest.fn(),
  },
}));

const mockGetRecentItems = dashboardApi.getRecentItems as jest.MockedFunction<
  typeof dashboardApi.getRecentItems
>;

const items: RecentDashboardItem[] = [
  {
    kind: 'task',
    id: 'task-1',
    title: '仕様を確認する',
    status: 'in_progress',
    project_id: 'project-1',
    project_title: 'HumanCompiler',
    goal_id: 'goal-1',
    goal_title: 'ダッシュボード改善',
    updated_at: '2026-08-30T15:00:00Z',
  },
  {
    kind: 'goal',
    id: 'goal-2',
    title: 'リリース準備',
    status: 'pending',
    project_id: 'project-2',
    project_title: '次期リリース',
    goal_id: 'goal-2',
    goal_title: 'リリース準備',
    updated_at: '2026-08-30T14:00:00Z',
  },
];

function renderShortcuts() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RecentItemShortcuts />
    </QueryClientProvider>,
  );
}

describe('RecentItemShortcuts', () => {
  it('links tasks and goals directly to their detail pages', async () => {
    mockGetRecentItems.mockResolvedValue(items);

    renderShortcuts();

    await waitFor(() => expect(screen.getByText('仕様を確認する')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'タスク「仕様を確認する」を開く' })).toHaveAttribute(
      'href',
      '/projects/project-1/goals/goal-1/tasks/task-1',
    );
    expect(screen.getByRole('link', { name: 'ゴール「リリース準備」を開く' })).toHaveAttribute(
      'href',
      '/projects/project-2/goals/goal-2',
    );
    expect(mockGetRecentItems).toHaveBeenCalledWith(5);
  });

  it('shows an empty-state message when no item has been updated', async () => {
    mockGetRecentItems.mockResolvedValue([]);

    renderShortcuts();

    expect(
      await screen.findByText('タスクやゴールを更新すると、ここにショートカットが表示されます'),
    ).toBeInTheDocument();
  });
});
