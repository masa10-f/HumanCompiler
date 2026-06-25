'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { getJSTDateString } from '@/lib/date-utils';
import { schedulingApi } from '@/lib/api';
import {
  clearSchedulerSolverConfig,
  loadSchedulerSolverConfig,
  saveSchedulerSolverConfig,
} from '@/lib/scheduler-config';
import type {
  ScheduleResult,
  SchedulerConfigControl,
  SchedulerSolverConfig,
  SchedulerTuningConfig,
  TimeSlot,
} from '@/types/ai-planning';

type Visibility = 'essential' | 'tuning' | 'expert';
type SlotKind = 'focused_work' | 'study' | 'light_work';

const visibilityRank: Record<Visibility, number> = {
  essential: 0,
  tuning: 1,
  expert: 2,
};

const defaultSlots: TimeSlot[] = [
  { start: '09:00', end: '12:00', kind: 'focused_work' },
  { start: '13:00', end: '17:00', kind: 'study' },
  { start: '19:00', end: '21:00', kind: 'light_work' },
];

const slotKindOptions: Array<{ value: SlotKind; label: string }> = [
  { value: 'focused_work', label: '集中作業' },
  { value: 'study', label: '学習' },
  { value: 'light_work', label: '軽作業' },
];

function mergeConfig(
  defaults: SchedulerSolverConfig,
  saved?: SchedulerSolverConfig
): SchedulerSolverConfig {
  return { ...defaults, ...(saved ?? {}) };
}

export default function SchedulerTuningPage() {
  const { user, loading: authLoading } = useAuth();

  const [tuningConfig, setTuningConfig] = useState<SchedulerTuningConfig | null>(null);
  const [config, setConfig] = useState<SchedulerSolverConfig | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('essential');
  const [selectedDate, setSelectedDate] = useState(() => getJSTDateString());
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(defaultSlots);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<ScheduleResult | null>(null);

  useEffect(() => {
    const loadConfig = async () => {
      if (!user) return;

      setIsLoadingConfig(true);
      try {
        const payload = await schedulingApi.getTuningConfig();
        setTuningConfig(payload);
        setConfig(mergeConfig(payload.defaults, loadSchedulerSolverConfig()));
      } catch (error) {
        toast({
          title: '設定取得エラー',
          description: error instanceof Error ? error.message : 'Scheduler設定の取得に失敗しました',
          variant: 'destructive',
        });
      } finally {
        setIsLoadingConfig(false);
      }
    };

    void loadConfig();
  }, [user]);

  const groupedControls = useMemo(() => {
    if (!tuningConfig) return [];
    const visibleControls = tuningConfig.schema.filter(
      (control) => visibilityRank[control.visibility] <= visibilityRank[visibility]
    );
    const groups = new Map<string, SchedulerConfigControl[]>();
    for (const control of visibleControls) {
      const controls = groups.get(control.group) ?? [];
      controls.push(control);
      groups.set(control.group, controls);
    }
    return Array.from(groups.entries());
  }, [tuningConfig, visibility]);

  const updateConfigValue = (key: keyof SchedulerSolverConfig, value: number) => {
    setConfig((current) => {
      if (!current) return current;
      return { ...current, [key]: value };
    });
  };

  const updateSlot = (index: number, patch: Partial<TimeSlot>) => {
    setTimeSlots((current) =>
      current.map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, ...patch } : slot
      )
    );
  };

  const addSlot = () => {
    setTimeSlots((current) => [
      ...current,
      { start: '15:00', end: '16:00', kind: 'light_work' },
    ]);
  };

  const removeSlot = (index: number) => {
    setTimeSlots((current) => current.filter((_, slotIndex) => slotIndex !== index));
  };

  const saveConfig = () => {
    if (!config) return;
    saveSchedulerSolverConfig(config);
    toast({
      title: 'Scheduler設定を保存しました',
      description: '日次スケジューラに反映されます',
    });
  };

  const resetConfig = () => {
    if (!tuningConfig) return;
    clearSchedulerSolverConfig();
    setConfig(tuningConfig.defaults);
    toast({
      title: 'Scheduler設定をリセットしました',
    });
  };

  const runPreview = async () => {
    if (!config) return;

    setIsPreviewing(true);
    try {
      const result = await schedulingApi.optimizeDaily({
        date: selectedDate,
        time_slots: timeSlots,
        task_source: { type: 'all_tasks' },
        solver_config: config,
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
              Scheduler調整
            </h1>
            {tuningConfig && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">{tuningConfig.backend_package}</Badge>
                <Badge variant="secondary">v{tuningConfig.backend_version}</Badge>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={resetConfig} disabled={!config}>
              <RotateCcw className="mr-2 h-4 w-4" />
              リセット
            </Button>
            <Button variant="outline" onClick={saveConfig} disabled={!config}>
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
            <Button onClick={runPreview} disabled={!config || isPreviewing || timeSlots.length === 0}>
              {isPreviewing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              プレビュー
            </Button>
          </div>
        </div>

        {isLoadingConfig || !config ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              読み込み中...
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.95fr)_minmax(420px,1.05fr)]">
            <section className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">パラメータ</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <Tabs value={visibility} onValueChange={(value) => setVisibility(value as Visibility)}>
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="essential">基本</TabsTrigger>
                      <TabsTrigger value="tuning">調整</TabsTrigger>
                      <TabsTrigger value="expert">詳細</TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {groupedControls.map(([group, controls]) => (
                    <div key={group} className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
                      <h2 className="text-sm font-semibold text-muted-foreground">{group}</h2>
                      {controls.map((control) => {
                        const controlId = `scheduler-control-${control.key}`;
                        const helpId = `${controlId}-help`;
                        const controlValue =
                          config[control.key] ?? tuningConfig?.defaults[control.key] ?? control.min;

                        return (
                          <div key={control.key} className="space-y-2">
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_96px] sm:items-start">
                              <div className="min-w-0">
                                <Label htmlFor={controlId} className="text-sm">
                                  {control.label}
                                </Label>
                                <p id={helpId} className="mt-1 text-xs leading-5 text-muted-foreground">
                                  {control.help}
                                </p>
                              </div>
                              <Input
                                id={controlId}
                                aria-describedby={helpId}
                                type="number"
                                min={control.min}
                                max={control.max}
                                step={control.step}
                                value={controlValue}
                                onChange={(event) => updateConfigValue(control.key, Number(event.target.value))}
                                className="h-8 w-full sm:w-24 sm:justify-self-end"
                              />
                            </div>
                            <Slider
                              aria-label={`${control.label}を調整`}
                              min={control.min}
                              max={control.max}
                              step={control.step}
                              value={[controlValue]}
                              onValueChange={([value]) => {
                                if (value !== undefined) {
                                  updateConfigValue(control.key, value);
                                }
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
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
                      onChange={(event) => setSelectedDate(event.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <div className="space-y-3">
                    {timeSlots.map((slot, index) => (
                      <div key={`${slot.start}-${index}`} className="grid gap-2 rounded-md border border-border bg-background p-3 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
                        <Input
                          type="time"
                          value={slot.start}
                          onChange={(event) => updateSlot(index, { start: event.target.value })}
                        />
                        <Input
                          type="time"
                          value={slot.end}
                          onChange={(event) => updateSlot(index, { end: event.target.value })}
                        />
                        <Select
                          value={slot.kind}
                          onValueChange={(value) => updateSlot(index, { kind: value as SlotKind })}
                        >
                          <SelectTrigger>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeSlot(index)}
                          disabled={timeSlots.length === 1}
                          aria-label="スロットを削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" onClick={addSlot}>
                      <Plus className="mr-2 h-4 w-4" />
                      スロット追加
                    </Button>
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
                              <Badge variant="outline">{assignment.duration_hours.toFixed(1)}h</Badge>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
