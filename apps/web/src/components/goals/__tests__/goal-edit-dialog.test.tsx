// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GoalEditDialog } from '../goal-edit-dialog';
import { goalsApi } from '@/lib/api';
import type { Goal } from '@/types/goal';

const mockUpdateGoal = jest.fn();

jest.mock('@/hooks/use-goals-query', () => ({
  useUpdateGoal: () => ({ mutateAsync: mockUpdateGoal, isPending: false }),
  useGoalsByProject: () => ({ data: [] }),
}));

jest.mock('@/lib/api', () => ({
  goalsApi: {
    getDependencies: jest.fn().mockResolvedValue([]),
    addDependency: jest.fn(),
    deleteDependency: jest.fn(),
  },
}));

jest.mock('@/hooks/use-toast', () => ({
  toast: jest.fn(),
}));

const baseGoal: Goal = {
  id: 'goal-1',
  title: '期限付きゴール',
  description: '説明',
  estimate_hours: 10,
  due_date: '2026-09-30T00:00:00+09:00',
  status: 'pending',
  project_id: 'project-1',
  created_at: '2026-08-30T00:00:00Z',
  updated_at: '2026-08-30T00:00:00Z',
};

function renderDialog(goal: Goal) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

  render(
    <QueryClientProvider client={queryClient}>
      <GoalEditDialog goal={goal}>
        <button type="button">編集する</button>
      </GoalEditDialog>
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: '編集する' }));

  return { invalidateSpy };
}

describe('GoalEditDialog deadline payload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateGoal.mockResolvedValue(baseGoal);
  });

  it('sends null when clearing an existing deadline', async () => {
    renderDialog(baseGoal);

    fireEvent.change(screen.getByLabelText('期限'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(mockUpdateGoal).toHaveBeenCalledWith({
        id: baseGoal.id,
        data: expect.objectContaining({ due_date: null }),
      });
    });
  });

  it('sends a selected deadline as JST start of day', async () => {
    renderDialog({ ...baseGoal, due_date: null });

    fireEvent.change(screen.getByLabelText('期限'), {
      target: { value: '2026-10-15' },
    });
    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(mockUpdateGoal).toHaveBeenCalledWith({
        id: baseGoal.id,
        data: expect.objectContaining({
          due_date: '2026-10-15T00:00:00+09:00',
        }),
      });
    });
  });
});

describe('GoalEditDialog dependencies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refreshes the project goal list after removing a dependency', async () => {
    jest.mocked(goalsApi.getDependencies).mockResolvedValue([
      {
        id: 'dep-1',
        goal_id: baseGoal.id,
        depends_on_goal_id: 'goal-0',
        created_at: '2026-08-30T00:00:00Z',
      },
    ]);
    jest.mocked(goalsApi.deleteDependency).mockResolvedValue(undefined as never);

    const { invalidateSpy } = renderDialog(baseGoal);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /依存関係/ }));

    const label = await screen.findByText('このゴールの完了を待つ');
    const card = label.closest('.flex.items-center.justify-between') as HTMLElement;
    fireEvent.click(card.querySelector('button') as HTMLButtonElement);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['goals', 'project', baseGoal.project_id],
      });
    });
  });
});
