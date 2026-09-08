// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SchedulingPage from '../page';
import { dailyPlansApi, slotTemplatesApi } from '@/lib/api';
import type { DailyPlanDocumentV1 } from '@/types/daily-plan';
import type { TimeSlot } from '@/types/ai-planning';
import { getIsoDayOfWeek } from '@/lib/date-utils';

const mockUser = { id: 'user-1' };
const mockProjects: never[] = [];
const mockToast = jest.fn();
const mockDocument: DailyPlanDocumentV1 = {
  schema_version: 1,
  availability_windows: [{ start: '09:00', end: '18:00', work_type: 'light_work' }],
  blocks: [{ id: 'meeting', type: 'timed_line', start: '12:00', end: '13:00', title: 'Day D meeting' }],
};

jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }));
jest.mock('@/hooks/use-project-query', () => ({ useProjectOptions: () => ({ data: mockProjects }) }));
jest.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));
jest.mock('@/components/layout/app-header', () => ({ AppHeader: () => null }));
jest.mock('@/components/scheduling', () => ({
  DroppableSlot: ({ slot }: { slot: TimeSlot }) => <div data-testid="slot">{slot.kind}</div>,
  TaskPool: () => null, DraggableTask: () => null,
}));
jest.mock('@/components/scheduling/lightweight-daily-planner', () => ({
  LightweightDailyPlanner: ({ onSwitchDetailed }: {
    onSwitchDetailed: (document: DailyPlanDocumentV1, revision: number) => void;
  }) => <button onClick={() => onSwitchDetailed(mockDocument, 1)}>Open details</button>,
}));
jest.mock('@/lib/api', () => ({
  dailyPlansApi: { get: jest.fn(), update: jest.fn() },
  schedulingApi: { getWeeklyScheduleOptions: jest.fn().mockResolvedValue([]) },
  slotTemplatesApi: { getByDay: jest.fn().mockResolvedValue([]) },
  tasksApi: { getByProject: jest.fn().mockResolvedValue([]) },
  quickTasksApi: { getAll: jest.fn().mockResolvedValue([]) },
}));

describe('daily planner mode and date transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/scheduling/daily?date=2030-01-02');
    jest.mocked(slotTemplatesApi.getByDay).mockResolvedValue([]);
    jest.mocked(dailyPlansApi.get).mockImplementation(async (date) => ({
      date, revision: 1, document: date === '2030-01-02' ? mockDocument : {
        ...mockDocument, blocks: [],
      }, schedule: null,
    }));
    jest.mocked(dailyPlansApi.update).mockImplementation(async (date, revision, document) => ({
      date, revision: revision + 1, document, schedule: null,
    }));
  });

  it('does not copy fixed events to another date without a template', async () => {
    render(<SchedulingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
    fireEvent.change(screen.getByDisplayValue('2030-01-02'), { target: { value: '2030-01-03' } });
    fireEvent.click(screen.getByRole('button', { name: '軽量モード' }));
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled());
    expect(jest.mocked(dailyPlansApi.update).mock.calls[0]?.[2].blocks).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('preserves one copy of a stored event after switching dates and back', async () => {
    render(<SchedulingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
    fireEvent.change(screen.getByDisplayValue('2030-01-02'), { target: { value: '2030-01-03' } });
    fireEvent.change(screen.getByDisplayValue('2030-01-03'), { target: { value: '2030-01-02' } });
    fireEvent.click(screen.getByRole('button', { name: '軽量モード' }));
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled());
    expect(jest.mocked(dailyPlansApi.update).mock.calls[0]?.[2].blocks).toEqual(mockDocument.blocks);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('replaces emitted event IDs even when entering detailed mode directly', async () => {
    window.history.replaceState({}, '', '/scheduling/daily?date=2030-01-02&mode=detailed');
    const event = { id: 'detailed-event:0', type: 'timed_line' as const,
      start: '12:00', end: '13:00', title: 'Stored event' };
    jest.mocked(dailyPlansApi.get).mockResolvedValue({
      date: '2030-01-02', revision: 1,
      document: { ...mockDocument, blocks: [event] },
    });
    jest.mocked(slotTemplatesApi.getByDay).mockResolvedValue([{
      day_of_week: getIsoDayOfWeek('2030-01-02'), day_name: 'Wednesday', templates: [], default_template: {
        id: 'template', name: 'Meeting', day_of_week: getIsoDayOfWeek('2030-01-02'), is_default: true,
        user_id: 'user-1', created_at: '2030-01-01', updated_at: '2030-01-01',
        slots: [{ start: '12:00', end: '13:00', kind: 'meeting' }],
      },
    }]);
    render(<SchedulingPage />);
    await waitFor(() => expect(screen.getAllByTestId('slot')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '軽量モード' }));
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled());
    expect(jest.mocked(dailyPlansApi.update).mock.calls[0]?.[2].blocks).toHaveLength(1);
    expect(mockToast).not.toHaveBeenCalled();
  });
});
