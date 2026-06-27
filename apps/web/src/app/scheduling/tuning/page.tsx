'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Boxes,
  Calendar,
  Check,
  Clock,
  Flag,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  TimerReset,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { getJSTDateString } from '@/lib/date-utils';
import { schedulingApi } from '@/lib/api';
import {
  clearSchedulerSolverConfig,
  loadSchedulerSolverConfig,
  saveSchedulerSolverConfig,
} from '@/lib/scheduler-config';
import { cn } from '@/lib/utils';
import type {
  ScheduleResult,
  SchedulerSolverConfig,
  SchedulerTuningConfig,
  TimeSlot,
} from '@/types/ai-planning';

type SlotKind = 'focused_work' | 'study' | 'light_work';

type PreferenceState = {
  blockLength: 'short' | 'balanced' | 'long';
  workKind: 'flexible' | 'balanced' | 'strict';
  priority: 'flat' | 'balanced' | 'strong';
  deadline: 'relaxed' | 'balanced' | 'urgent';
  projectFlow: 'flexible' | 'balanced' | 'stable';
  protectFocus: boolean;
  fillSmallGaps: boolean;
};

type PreferenceKey = Exclude<keyof PreferenceState, 'protectFocus' | 'fillSmallGaps'>;

type PreferenceOption = {
  value: PreferenceState[PreferenceKey];
  label: string;
  description: string;
};

type PreferenceControl = {
  key: PreferenceKey;
  label: string;
  description: string;
  icon: typeof Boxes;
  options: PreferenceOption[];
};

const defaultSlots: TimeSlot[] = [
  { start: '09:00', end: '12:00', kind: 'focused_work' },
  { start: '13:00', end: '17:00', kind: 'study' },
  { start: '19:00', end: '21:00', kind: 'light_work' },
];

const defaultPreferences: PreferenceState = {
  blockLength: 'balanced',
  workKind: 'balanced',
  priority: 'balanced',
  deadline: 'balanced',
  projectFlow: 'balanced',
  protectFocus: true,
  fillSmallGaps: true,
};

const preferenceControls: PreferenceControl[] = [
  {
    key: 'blockLength',
    label: '作業ブロック',
    description: 'タスクをどのくらいのまとまりで日次枠へ入れるかを決めます。',
    icon: Boxes,
    options: [
      { value: 'short', label: '短め', description: '30から90分で細かく刻みます' },
      { value: 'balanced', label: '標準', description: '15から180分で柔軟に置きます' },
      { value: 'long', label: '長め', description: '30から240分の深い作業を許します' },
    ],
  },
  {
    key: 'workKind',
    label: '作業種別',
    description: '集中作業・学習・軽作業の枠をどれだけ厳密に合わせるかを決めます。',
    icon: Layers,
    options: [
      { value: 'flexible', label: '柔軟', description: '違う種別の枠にも置きやすくします' },
      { value: 'balanced', label: '標準', description: '一致する枠を自然に優先します' },
      { value: 'strict', label: '厳密', description: '一致しない枠をかなり避けます' },
    ],
  },
  {
    key: 'priority',
    label: '優先度',
    description: 'タスクの優先度番号をスケジュール順へどれだけ反映するかを決めます。',
    icon: Flag,
    options: [
      { value: 'flat', label: '控えめ', description: '優先度差を弱めます' },
      { value: 'balanced', label: '標準', description: '通常の優先度差で並べます' },
      { value: 'strong', label: '強め', description: '高優先度を前に出しやすくします' },
    ],
  },
  {
    key: 'deadline',
    label: '期限',
    description: '期限が近いタスクや期限超過タスクをどれだけ前倒しするかを決めます。',
    icon: Clock,
    options: [
      { value: 'relaxed', label: '穏やか', description: '期限の影響を控えめにします' },
      { value: 'balanced', label: '標準', description: '近い期限を自然に優先します' },
      { value: 'urgent', label: '強め', description: '期限が近いタスクを強く押し上げます' },
    ],
  },
  {
    key: 'projectFlow',
    label: 'プロジェクト切替',
    description: '短い間隔で別プロジェクトへ移る配置をどれだけ避けるかを決めます。',
    icon: ArrowRightLeft,
    options: [
      { value: 'flexible', label: '柔軟', description: '切替をほぼ気にしません' },
      { value: 'balanced', label: '標準', description: '短い切替だけ少し避けます' },
      { value: 'stable', label: '安定', description: '同じプロジェクトを続けやすくします' },
    ],
  },
];

const slotKindOptions: Array<{ value: SlotKind; label: string }> = [
  { value: 'focused_work', label: '集中作業' },
  { value: 'study', label: '学習' },
  { value: 'light_work', label: '軽作業' },
];

function inferPreferences(config?: SchedulerSolverConfig): PreferenceState {
  if (!config) return defaultPreferences;

  const preferences: PreferenceState = { ...defaultPreferences };

  if ((config.max_candidate_block_minutes ?? 180) <= 90) {
    preferences.blockLength = 'short';
  } else if ((config.max_candidate_block_minutes ?? 180) >= 240) {
    preferences.blockLength = 'long';
  }

  if ((config.kind_mismatch_score ?? 1) >= 3) {
    preferences.workKind = 'flexible';
  } else if ((config.kind_match_score ?? 8) >= 12 || (config.kind_mismatch_score ?? 1) === 0) {
    preferences.workKind = 'strict';
  }

  if ((config.priority_score_base ?? 6) <= 4) {
    preferences.priority = 'flat';
  } else if ((config.priority_score_base ?? 6) >= 9) {
    preferences.priority = 'strong';
  }

  if ((config.deadline_score ?? 4) <= 2 && (config.overdue_score ?? 20) <= 12) {
    preferences.deadline = 'relaxed';
  } else if ((config.deadline_score ?? 4) >= 8 || (config.overdue_score ?? 20) >= 30) {
    preferences.deadline = 'urgent';
  }

  if ((config.project_switch_penalty ?? 4) <= 1) {
    preferences.projectFlow = 'flexible';
  } else if ((config.project_switch_penalty ?? 4) >= 8) {
    preferences.projectFlow = 'stable';
  }

  preferences.protectFocus = (config.long_continuous_penalty ?? 5) > 0;
  preferences.fillSmallGaps = (config.small_gap_fill_score ?? 2) > 0;

  return preferences;
}

function buildSolverConfig(preferences: PreferenceState): SchedulerSolverConfig {
  const config: SchedulerSolverConfig = {};

  if (preferences.blockLength === 'short') {
    Object.assign(config, {
      min_block_minutes: 15,
      block_granularity_minutes: 15,
      max_candidate_block_minutes: 90,
    });
  } else if (preferences.blockLength === 'long') {
    Object.assign(config, {
      min_block_minutes: 30,
      block_granularity_minutes: 30,
      max_candidate_block_minutes: 240,
    });
  } else {
    Object.assign(config, {
      min_block_minutes: 15,
      block_granularity_minutes: 15,
      max_candidate_block_minutes: 180,
    });
  }

  if (preferences.workKind === 'flexible') {
    Object.assign(config, { kind_match_score: 6, kind_mismatch_score: 4 });
  } else if (preferences.workKind === 'strict') {
    Object.assign(config, { kind_match_score: 12, kind_mismatch_score: 0 });
  } else {
    Object.assign(config, { kind_match_score: 8, kind_mismatch_score: 1 });
  }

  config.priority_score_base =
    preferences.priority === 'flat' ? 4 : preferences.priority === 'strong' ? 10 : 6;

  if (preferences.deadline === 'relaxed') {
    Object.assign(config, {
      deadline_soon_days: 1,
      deadline_score: 2,
      overdue_score: 10,
    });
  } else if (preferences.deadline === 'urgent') {
    Object.assign(config, {
      deadline_soon_days: 5,
      deadline_score: 8,
      overdue_score: 32,
    });
  } else {
    Object.assign(config, {
      deadline_soon_days: 2,
      deadline_score: 4,
      overdue_score: 20,
    });
  }

  if (preferences.projectFlow === 'flexible') {
    Object.assign(config, {
      project_switch_penalty: 0,
      project_switch_reset_gap_minutes: 15,
    });
  } else if (preferences.projectFlow === 'stable') {
    Object.assign(config, {
      project_switch_penalty: 10,
      project_switch_reset_gap_minutes: 60,
    });
  } else {
    Object.assign(config, {
      project_switch_penalty: 4,
      project_switch_reset_gap_minutes: 30,
    });
  }

  Object.assign(
    config,
    preferences.protectFocus
      ? {
          long_continuous_threshold_minutes: 120,
          long_continuous_penalty: 5,
          break_reset_gap_minutes: 20,
        }
      : {
          long_continuous_threshold_minutes: 240,
          long_continuous_penalty: 0,
          break_reset_gap_minutes: 20,
        }
  );

  Object.assign(
    config,
    preferences.fillSmallGaps
      ? { small_gap_minutes: 15, small_gap_fill_score: 2 }
      : { small_gap_minutes: 15, small_gap_fill_score: 0 }
  );

  return config;
}

export default function SchedulerTuningPage() {
  const { user, loading: authLoading } = useAuth();

  const [preferences, setPreferences] = useState<PreferenceState>(() =>
    inferPreferences(loadSchedulerSolverConfig())
  );
  const [selectedDate, setSelectedDate] = useState(() => getJSTDateString());
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(defaultSlots);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<ScheduleResult | null>(null);

  const solverConfig = useMemo(() => buildSolverConfig(preferences), [preferences]);

  const {
    data: tuningConfig,
    error: tuningConfigError,
    isFetching: isFetchingTuningConfig,
    isLoading: isLoadingTuningConfig,
  } = useQuery<SchedulerTuningConfig>({
    queryKey: ['scheduler-tuning-config'],
    queryFn: schedulingApi.getTuningConfig,
    enabled: Boolean(user),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  const updatePreference = <Key extends keyof PreferenceState>(
    key: Key,
    value: PreferenceState[Key]
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    setPreviewResult(null);
  };

  const updateSlot = (index: number, patch: Partial<TimeSlot>) => {
    setTimeSlots((current) =>
      current.map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, ...patch } : slot
      )
    );
    setPreviewResult(null);
  };

  const saveConfig = () => {
    saveSchedulerSolverConfig(solverConfig);
    toast({
      title: 'スケジュール調整を保存しました',
      description: '日次計画の自動配置に反映されます',
    });
  };

  const resetConfig = () => {
    clearSchedulerSolverConfig();
    setPreferences(defaultPreferences);
    setPreviewResult(null);
    toast({
      title: 'スケジュール調整をリセットしました',
    });
  };

  const runPreview = async () => {
    setIsPreviewing(true);
    try {
      const result = await schedulingApi.optimizeDaily({
        date: selectedDate,
        time_slots: timeSlots,
        task_source: { type: 'all_tasks' },
        solver_config: solverConfig,
      });
      setPreviewResult(result);
      toast({
        title: 'プレビューを更新しました',
        description: `${result.assignments.length}件を配置しました`,
      });
    } catch (error) {
      toast({
        title: 'プレビューエラー',
        description: error instanceof Error ? error.message : 'プレビューに失敗しました',
        variant: 'destructive',
      });
    } finally {
      setIsPreviewing(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="scheduler-tuning" />
      <main className="container mx-auto px-4 py-6">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <SlidersHorizontal className="h-7 w-7 text-blue-600" />
              スケジュール調整
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {tuningConfig && (
                <>
                  <Badge variant="outline">{tuningConfig.backend_package}</Badge>
                  <Badge variant="secondary">v{tuningConfig.backend_version}</Badge>
                </>
              )}
              {isFetchingTuningConfig && !isLoadingTuningConfig && (
                <Badge variant="outline">更新中</Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={resetConfig}>
              <RotateCcw className="mr-2 h-4 w-4" />
              リセット
            </Button>
            <Button variant="outline" onClick={saveConfig}>
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
            <Button onClick={runPreview} disabled={isPreviewing || timeSlots.length === 0}>
              {isPreviewing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              プレビュー
            </Button>
          </div>
        </div>

        {tuningConfigError && (
          <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            Scheduler情報を取得できませんでした。保存済みの調整とプレビューは利用できます。
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(420px,1fr)_minmax(420px,0.9fr)]">
          <section className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">配置の好み</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {preferenceControls.map((control) => {
                  const Icon = control.icon;
                  const selectedValue = preferences[control.key];

                  return (
                    <div
                      key={control.key}
                      className="grid gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0"
                    >
                      <div className="flex min-w-0 gap-3">
                        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold">{control.label}</h2>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {control.description}
                          </p>
                        </div>
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={control.label}
                        className="grid gap-1 rounded-md bg-muted p-1 sm:grid-cols-3"
                      >
                        {control.options.map((option) => {
                          const isSelected = selectedValue === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              onClick={() =>
                                updatePreference(
                                  control.key,
                                  option.value as PreferenceState[typeof control.key]
                                )
                              }
                              className={cn(
                                'min-h-[72px] rounded-sm px-3 py-2 text-left text-sm transition-colors',
                                isSelected
                                  ? 'bg-background text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                              )}
                            >
                              <span className="flex items-center justify-between gap-2 font-medium">
                                {option.label}
                                {isSelected && <Check className="h-4 w-4 text-blue-600" />}
                              </span>
                              <span className="mt-1 block text-xs leading-5">
                                {option.description}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div className="grid gap-4 border-t border-border pt-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      <TimerReset className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                      <div className="min-w-0">
                        <Label htmlFor="protect-focus" className="text-sm font-semibold">
                          長時間連続を避ける
                        </Label>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          休憩なしで長いブロックが続く配置を少し避けます。
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="protect-focus"
                      checked={preferences.protectFocus}
                      onCheckedChange={(checked) => updatePreference('protectFocus', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                      <div className="min-w-0">
                        <Label htmlFor="fill-small-gaps" className="text-sm font-semibold">
                          小さな空き時間を埋める
                        </Label>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          15分程度の余り時間が出にくい配置を選びます。
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="fill-small-gaps"
                      checked={preferences.fillSmallGaps}
                      onCheckedChange={(checked) => updatePreference('fillSmallGaps', checked)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="h-5 w-5 text-blue-600" />
                  プレビュー条件
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="preview-date">日付</Label>
                  <Input
                    id="preview-date"
                    type="date"
                    value={selectedDate}
                    onChange={(event) => {
                      setSelectedDate(event.target.value);
                      setPreviewResult(null);
                    }}
                    className="mt-1"
                  />
                </div>

                <div className="space-y-3">
                  {timeSlots.map((slot, index) => (
                    <div
                      key={`${slot.start}-${index}`}
                      className="grid gap-2 rounded-md border border-border bg-background p-3 sm:grid-cols-[1fr_1fr_1.2fr]"
                    >
                      <Input
                        type="time"
                        value={slot.start}
                        aria-label={`${index + 1}枠目の開始時刻`}
                        onChange={(event) => updateSlot(index, { start: event.target.value })}
                      />
                      <Input
                        type="time"
                        value={slot.end}
                        aria-label={`${index + 1}枠目の終了時刻`}
                        onChange={(event) => updateSlot(index, { end: event.target.value })}
                      />
                      <Select
                        value={slot.kind}
                        onValueChange={(value) => updateSlot(index, { kind: value as SlotKind })}
                      >
                        <SelectTrigger aria-label={`${index + 1}枠目の作業種別`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {slotKindOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">プレビュー結果</CardTitle>
              </CardHeader>
              <CardContent>
                {!previewResult ? (
                  <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    未実行
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-md border border-border bg-background p-3">
                        <div className="text-xl font-bold text-blue-600">
                          {previewResult.assignments.length}
                        </div>
                        <div className="text-xs text-muted-foreground">配置</div>
                      </div>
                      <div className="rounded-md border border-border bg-background p-3">
                        <div className="text-xl font-bold text-green-600">
                          {previewResult.total_scheduled_hours.toFixed(1)}h
                        </div>
                        <div className="text-xs text-muted-foreground">合計</div>
                      </div>
                      <div className="rounded-md border border-border bg-background p-3">
                        <div className="text-xl font-bold text-amber-600">
                          {previewResult.unscheduled_tasks.length}
                        </div>
                        <div className="text-xs text-muted-foreground">未配置</div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {previewResult.assignments
                        .slice()
                        .sort((a, b) => a.start_time.localeCompare(b.start_time))
                        .map((assignment) => (
                          <div
                            key={`${assignment.task_id}-${assignment.start_time}`}
                            className="grid grid-cols-[70px_minmax(0,1fr)_64px] items-center gap-3 rounded-md border border-border bg-background p-3"
                          >
                            <span className="text-sm tabular-nums text-muted-foreground">
                              {assignment.start_time}
                            </span>
                            <span className="min-w-0 truncate text-sm font-medium">
                              {assignment.task_title}
                            </span>
                            <Badge variant="outline">
                              {assignment.duration_hours.toFixed(1)}h
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}
