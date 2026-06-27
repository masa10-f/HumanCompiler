import type { SchedulerSolverConfig } from '@/types/ai-planning';

const STORAGE_KEY = 'humancompiler.scheduler.solverConfig.v1';

const USER_SCHEDULER_CONFIG_KEYS = [
  'kind_match_score',
  'kind_mismatch_score',
  'priority_score_base',
  'deadline_soon_days',
  'deadline_score',
  'overdue_score',
  'min_block_minutes',
  'block_granularity_minutes',
  'max_candidate_block_minutes',
  'project_switch_penalty',
  'project_switch_reset_gap_minutes',
  'long_continuous_threshold_minutes',
  'long_continuous_penalty',
  'break_reset_gap_minutes',
  'small_gap_minutes',
  'small_gap_fill_score',
] as const satisfies readonly (keyof SchedulerSolverConfig)[];

export function normalizeSchedulerSolverConfig(
  config?: SchedulerSolverConfig
): SchedulerSolverConfig | undefined {
  if (!config || typeof config !== 'object') return undefined;

  const normalized: Record<string, number> = {};
  for (const key of USER_SCHEDULER_CONFIG_KEYS) {
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[key] = value;
    }
  }

  if (Object.keys(normalized).length === 0) return undefined;
  return normalized as SchedulerSolverConfig;
}

export function loadSchedulerSolverConfig(): SchedulerSolverConfig | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) return undefined;
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const normalized = normalizeSchedulerSolverConfig(parsed as SchedulerSolverConfig);
    if (!normalized) {
      window.localStorage.removeItem(STORAGE_KEY);
      return undefined;
    }
    if (JSON.stringify(normalized) !== rawValue) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return undefined;
  }
}

export function saveSchedulerSolverConfig(config: SchedulerSolverConfig): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeSchedulerSolverConfig(config);
  if (!normalized) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function clearSchedulerSolverConfig(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function hasSchedulerSolverConfig(config?: SchedulerSolverConfig): boolean {
  return Boolean(normalizeSchedulerSolverConfig(config));
}
