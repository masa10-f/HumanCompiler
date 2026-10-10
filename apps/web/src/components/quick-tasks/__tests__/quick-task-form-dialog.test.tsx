// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { QuickTaskFormDialog } from '../quick-task-form-dialog';
import { quickTasksApi } from '@/lib/api';
import type { QuickTask } from '@/types/quick-task';

jest.mock('@/lib/api', () => ({
  quickTasksApi: {
    create: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('@/hooks/use-toast', () => ({
  toast: jest.fn(),
}));

const baseTask: QuickTask = {
  id: 'quick-task-1',
  owner_id: 'user-1',
  title: '締切付きクイックタスク',
  description: null,
  estimate_hours: 0.5,
  // 2026-10-20 00:00 JST as returned by the API
  due_date: '2026-10-19T15:00:00+00:00',
  status: 'pending',
  work_type: 'light_work',
  priority: 3,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

describe('QuickTaskFormDialog deadline payload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(quickTasksApi.create).mockResolvedValue(baseTask);
    jest.mocked(quickTasksApi.update).mockResolvedValue(baseTask);
  });

  it('sends a selected deadline as JST start of day when creating', async () => {
    render(<QuickTaskFormDialog open onOpenChange={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('タスク名 *'), {
      target: { value: '新しいクイックタスク' },
    });
    fireEvent.change(screen.getByLabelText('締切日'), {
      target: { value: '2026-10-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    await waitFor(() => {
      expect(quickTasksApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ due_date: '2026-10-20T00:00:00+09:00' }),
      );
    });
  });

  it('shows the stored deadline as its JST calendar date when editing', async () => {
    render(<QuickTaskFormDialog task={baseTask} open onOpenChange={jest.fn()} />);

    expect(screen.getByLabelText('締切日')).toHaveValue('2026-10-20');

    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(quickTasksApi.update).toHaveBeenCalledWith(
        baseTask.id,
        expect.objectContaining({ due_date: '2026-10-20T00:00:00+09:00' }),
      );
    });
  });
});
