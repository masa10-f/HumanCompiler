// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RecentItemShortcuts } from '../recent-item-shortcuts';
import { dashboardApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
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

function renderShortcuts(cachedItems?: RecentDashboardItem[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cachedItems) {
    queryClient.setQueryData(queryKeys.dashboard.recentItems(5), cachedItems);
  }

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <RecentItemShortcuts />
    </QueryClientProvider>,
  );

  return { ...rendered, queryClient };
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
    expect(screen.getByText('8/31 00:00 更新')).toBeInTheDocument();
    expect(screen.getByTitle('次期リリース')).toHaveTextContent('次期リリース');
  });

  it('shows an empty-state message when no item has been updated', async () => {
    mockGetRecentItems.mockResolvedValue([]);

    renderShortcuts();

    expect(
      await screen.findByText('タスクやゴールを更新すると、ここにショートカットが表示されます'),
    ).toBeInTheDocument();
  });

  it('keeps cached shortcuts visible when a background refresh fails', async () => {
    mockGetRecentItems.mockRejectedValue(new Error('temporary failure'));
    const { queryClient } = renderShortcuts(items);

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: queryKeys.dashboard.recentItems(5),
      });
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryState(queryKeys.dashboard.recentItems(5))?.status,
      ).toBe('error'),
    );
    expect(
      screen.getByRole('link', { name: 'タスク「仕様を確認する」を開く' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('最近触った項目を取得できませんでした'),
    ).not.toBeInTheDocument();
  });

  it('retries an initial load failure', async () => {
    mockGetRecentItems
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(items);

    renderShortcuts();

    fireEvent.click(await screen.findByRole('button', { name: '再試行' }));

    expect(
      await screen.findByRole('link', {
        name: 'タスク「仕様を確認する」を開く',
      }),
    ).toBeInTheDocument();
    expect(mockGetRecentItems).toHaveBeenCalledTimes(2);
  });
});
