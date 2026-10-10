// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TaskFormDialog } from '../task-form-dialog';

const mockCreateTask = jest.fn();

jest.mock('@/hooks/use-tasks-query', () => ({
  useCreateTask: () => ({ mutateAsync: mockCreateTask, isPending: false }),
}));

jest.mock('@/hooks/use-toast', () => ({
  toast: jest.fn(),
}));

describe('TaskFormDialog deadline payload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateTask.mockResolvedValue({});
  });

  it('sends a selected deadline as JST start of day', async () => {
    render(
      <TaskFormDialog goalId="goal-1">
        <button type="button">タスクを追加</button>
      </TaskFormDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'タスクを追加' }));

    fireEvent.change(screen.getByLabelText('タスク名 *'), {
      target: { value: '締切付きタスク' },
    });
    fireEvent.change(screen.getByLabelText('締切日'), {
      target: { value: '2026-10-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          goal_id: 'goal-1',
          due_date: '2026-10-20T00:00:00+09:00',
        }),
      );
    });
  });
});
