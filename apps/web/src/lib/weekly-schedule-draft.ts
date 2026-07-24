import { ApiError } from '@/lib/errors';
import type { SavedWeeklySchedule } from '@/types/ai-planning';

interface WeeklyScheduleDraftApi {
  getByWeek: (weekStartDate: string) => Promise<SavedWeeklySchedule>;
  updateDraft: (
    weekStartDate: string,
    scheduleData: Record<string, unknown>,
    expectedUpdatedAt?: string | null,
  ) => Promise<SavedWeeklySchedule>;
}

interface SaveWeeklyScheduleDraftOptions {
  api: WeeklyScheduleDraftApi;
  weekStartDate: string;
  scheduleData: Record<string, unknown>;
  selectedSchedule: SavedWeeklySchedule | null;
}

function isSameWeek(
  schedule: SavedWeeklySchedule | null,
  weekStartDate: string,
): schedule is SavedWeeklySchedule {
  return schedule?.week_start_date.slice(0, 10) === weekStartDate;
}

export async function saveWeeklyScheduleDraft({
  api,
  weekStartDate,
  scheduleData,
  selectedSchedule,
}: SaveWeeklyScheduleDraftOptions): Promise<SavedWeeklySchedule> {
  let currentSchedule = isSameWeek(selectedSchedule, weekStartDate)
    ? selectedSchedule
    : null;

  if (!currentSchedule) {
    try {
      currentSchedule = await api.getByWeek(weekStartDate);
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 404) {
        throw error;
      }
    }
  }

  return api.updateDraft(
    weekStartDate,
    scheduleData,
    currentSchedule?.updated_at,
  );
}
