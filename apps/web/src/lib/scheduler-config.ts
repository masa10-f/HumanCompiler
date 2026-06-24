import type { SchedulerSolverConfig } from '@/types/ai-planning';

const STORAGE_KEY = 'humancompiler.scheduler.solverConfig.v1';

export function loadSchedulerSolverConfig(): SchedulerSolverConfig | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) return undefined;
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed as SchedulerSolverConfig;
  } catch {
    return undefined;
  }
}

export function saveSchedulerSolverConfig(config: SchedulerSolverConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearSchedulerSolverConfig(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function hasSchedulerSolverConfig(config?: SchedulerSolverConfig): boolean {
  return Boolean(config && Object.keys(config).length > 0);
}
