import { ApiError } from '@/lib/errors';
import { saveWeeklyScheduleDraft } from '@/lib/weekly-schedule-draft';
import type { SavedWeeklySchedule } from '@/types/ai-planning';

const existingSchedule = {
  id: 'schedule-1',
  week_start_date: '2026-07-20T00:00:00Z',
  schedule_json: {},
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-21T00:00:00Z',
} as SavedWeeklySchedule;

describe('saveWeeklyScheduleDraft', () => {
  it('uses the loaded schedule version without fetching it again', async () => {
    const api = {
      getByWeek: jest.fn(),
      updateDraft: jest.fn().mockResolvedValue(existingSchedule),
    };

    await saveWeeklyScheduleDraft({
      api,
      weekStartDate: '2026-07-20',
      scheduleData: { selected_tasks: [] },
      selectedSchedule: existingSchedule,
    });

    expect(api.getByWeek).not.toHaveBeenCalled();
    expect(api.updateDraft).toHaveBeenCalledWith(
      '2026-07-20',
      { selected_tasks: [] },
      existingSchedule.updated_at,
    );
  });

  it('loads the current version before replacing an existing generated week', async () => {
    const api = {
      getByWeek: jest.fn().mockResolvedValue(existingSchedule),
      updateDraft: jest.fn().mockResolvedValue(existingSchedule),
    };

    await saveWeeklyScheduleDraft({
      api,
      weekStartDate: '2026-07-20',
      scheduleData: { selected_tasks: [] },
      selectedSchedule: null,
    });

    expect(api.getByWeek).toHaveBeenCalledWith('2026-07-20');
    expect(api.updateDraft).toHaveBeenCalledWith(
      '2026-07-20',
      { selected_tasks: [] },
      existingSchedule.updated_at,
    );
  });

  it('creates a new week when no saved schedule exists', async () => {
    const api = {
      getByWeek: jest.fn().mockRejectedValue(new ApiError(404, 'Not found')),
      updateDraft: jest.fn().mockResolvedValue(existingSchedule),
    };

    await saveWeeklyScheduleDraft({
      api,
      weekStartDate: '2026-07-20',
      scheduleData: { selected_tasks: [] },
      selectedSchedule: null,
    });

    expect(api.updateDraft).toHaveBeenCalledWith(
      '2026-07-20',
      { selected_tasks: [] },
      undefined,
    );
  });

  it('does not hide lookup failures other than a missing week', async () => {
    const api = {
      getByWeek: jest.fn().mockRejectedValue(new ApiError(500, 'Server error')),
      updateDraft: jest.fn(),
    };

    await expect(
      saveWeeklyScheduleDraft({
        api,
        weekStartDate: '2026-07-20',
        scheduleData: { selected_tasks: [] },
        selectedSchedule: null,
      }),
    ).rejects.toThrow('Server error');
    expect(api.updateDraft).not.toHaveBeenCalled();
  });
});
