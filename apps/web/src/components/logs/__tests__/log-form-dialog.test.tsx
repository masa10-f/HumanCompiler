// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LogFormDialog } from '../log-form-dialog';

const mockCreate = jest.fn();

jest.mock('@/lib/api', () => ({
  logsApi: { create: (...args: unknown[]) => mockCreate(...args) },
}));
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));
jest.mock('@/lib/error-toast', () => ({ showErrorToast: jest.fn() }));

function openDialog() {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <LogFormDialog taskId="task-1" taskTitle="序論を書く" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '時間記録' }));
  fireEvent.change(screen.getByLabelText('実作業時間（時間）'), { target: { value: '1.5' } });
  return invalidate;
}

describe('LogFormDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'log-1', task_id: 'task-1', actual_minutes: 90 });
  });

  it('records only the time when nothing else is filled in', async () => {
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: '記録' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toEqual({
      task_id: 'task-1',
      actual_minutes: 90,
      comment: undefined,
      remaining_estimate_hours: undefined,
      complete_task: undefined,
    });
  });

  it('sends what remains, so the estimate follows the record', async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('残りの見込み（時間・任意）'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '記録' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      actual_minutes: 90,
      remaining_estimate_hours: 2,
    });
  });

  it('accepts zero remaining hours', async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('残りの見込み（時間・任意）'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: '記録' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0].remaining_estimate_hours).toBe(0);
  });

  it('completes the task with the record, and then nothing remains', async () => {
    openDialog();
    const remaining = screen.getByLabelText('残りの見込み（時間・任意）');
    fireEvent.change(remaining, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'このタスクを完了にする' }));
    expect(remaining).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '記録' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      complete_task: true,
      remaining_estimate_hours: undefined,
    });
  });

  it('refreshes the task, its logs and the list totals after a record', async () => {
    const invalidate = openDialog();
    fireEvent.click(screen.getByRole('button', { name: '記録' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['logs', 'task', 'task-1'] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['logs', 'batch'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    // The goal shows the sum of its tasks' estimates.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['goals'] });
  });

  it('does not record a negative remaining time', async () => {
    openDialog();
    const remaining = screen.getByLabelText('残りの見込み（時間・任意）');
    fireEvent.change(remaining, { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: '記録' }));

    // The field's own minimum stops the form before it is sent.
    expect(remaining).toBeInvalid();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
