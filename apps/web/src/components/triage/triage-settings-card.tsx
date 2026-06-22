'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, ListChecks, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { projectsApi, triageApi } from '@/lib/api';
import type { Project } from '@/types/project';
import type { WorkType } from '@/types/task';
import { workTypeLabels } from '@/types/task';

const workTypes: WorkType[] = ['focused_work', 'study', 'light_work'];

export function TriageSettingsCard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [weeklyCapacityHours, setWeeklyCapacityHours] = useState(40);
  const [meetingBufferHours, setMeetingBufferHours] = useState(5);
  const [cadenceDays, setCadenceDays] = useState(7);
  const [autoGenerateEnabled, setAutoGenerateEnabled] = useState(false);
  const [useAiRankAdjustment, setUseAiRankAdjustment] = useState(false);
  const [projectAllocations, setProjectAllocations] = useState<Record<string, number>>({});
  const [inboxAllocationPercent, setInboxAllocationPercent] = useState(0);
  const [workTypeCaps, setWorkTypeCaps] = useState<Record<WorkType, string>>({
    focused_work: '',
    study: '',
    light_work: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [projectData, settings] = await Promise.all([
          projectsApi.getAll(0, 100),
          triageApi.getSettings(),
        ]);
        if (cancelled) return;

        setProjects(projectData);
        setWeeklyCapacityHours(settings.weekly_capacity_hours);
        setMeetingBufferHours(settings.meeting_buffer_hours);
        setCadenceDays(settings.cadence_days);
        setAutoGenerateEnabled(settings.auto_generate_enabled);
        setUseAiRankAdjustment(settings.use_ai_rank_adjustment);
        setProjectAllocations(settings.project_allocations || {});
        setInboxAllocationPercent(settings.inbox_allocation_percent || 0);
        setWorkTypeCaps({
          focused_work: settings.work_type_caps.focused_work?.toString() || '',
          study: settings.work_type_caps.study?.toString() || '',
          light_work: settings.work_type_caps.light_work?.toString() || '',
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'トリアージ設定の取得に失敗しました');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const allocationTotal = useMemo(() => {
    const projectTotal = projects.reduce(
      (total, project) => total + (projectAllocations[project.id] || 0),
      0
    );
    return projectTotal + inboxAllocationPercent;
  }, [inboxAllocationPercent, projectAllocations, projects]);

  const effectiveCapacity = Math.max(0, weeklyCapacityHours - meetingBufferHours);

  const updateProjectAllocation = (projectId: string, value: number) => {
    setProjectAllocations((current) => ({ ...current, [projectId]: value }));
  };

  const balanceAllocations = () => {
    const bucketCount = projects.length + 1;
    if (bucketCount <= 0) return;
    const base = Math.floor(100 / bucketCount);
    const remainder = 100 - base * bucketCount;
    const nextAllocations: Record<string, number> = {};
    projects.forEach((project, index) => {
      nextAllocations[project.id] = base + (index === 0 ? remainder : 0);
    });
    setProjectAllocations(nextAllocations);
    setInboxAllocationPercent(base);
  };

  const saveSettings = async () => {
    setError('');
    setSuccess('');

    if (allocationTotal !== 100) {
      setError(`配分の合計を100%にしてください（現在: ${allocationTotal}%）`);
      return;
    }
    if (meetingBufferHours >= weeklyCapacityHours) {
      setError('バッファ時間は週間キャパシティより小さくしてください');
      return;
    }

    const parsedWorkTypeCaps: Record<string, number> = {};
    workTypes.forEach((workType) => {
      const rawValue = workTypeCaps[workType].trim();
      if (rawValue !== '') {
        parsedWorkTypeCaps[workType] = Number(rawValue);
      }
    });

    setSaving(true);
    try {
      await triageApi.updateSettings({
        weekly_capacity_hours: weeklyCapacityHours,
        meeting_buffer_hours: meetingBufferHours,
        project_allocations: projects.reduce<Record<string, number>>((acc, project) => {
          acc[project.id] = projectAllocations[project.id] || 0;
          return acc;
        }, {}),
        inbox_allocation_percent: inboxAllocationPercent,
        work_type_caps: parsedWorkTypeCaps,
        cadence_days: cadenceDays,
        auto_generate_enabled: autoGenerateEnabled,
        use_ai_rank_adjustment: useAiRankAdjustment,
      });
      setSuccess('トリアージ設定を保存しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'トリアージ設定の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-5 w-5" />
          キャパシティトリアージ
        </CardTitle>
        <CardDescription>
          週ごとの処理可能量とプロジェクト別配分を設定します
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="triage-weekly-capacity">週間キャパシティ</Label>
                <Input
                  id="triage-weekly-capacity"
                  type="number"
                  min={1}
                  step={0.5}
                  value={weeklyCapacityHours}
                  onChange={(event) => setWeeklyCapacityHours(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="triage-meeting-buffer">バッファ時間</Label>
                <Input
                  id="triage-meeting-buffer"
                  type="number"
                  min={0}
                  step={0.5}
                  value={meetingBufferHours}
                  onChange={(event) => setMeetingBufferHours(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="triage-cadence">生成間隔（日）</Label>
                <Input
                  id="triage-cadence"
                  type="number"
                  min={1}
                  max={365}
                  value={cadenceDays}
                  onChange={(event) => setCadenceDays(Number(event.target.value))}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="secondary">実効 {effectiveCapacity.toFixed(1)}h</Badge>
              <Badge variant={allocationTotal === 100 ? 'default' : 'destructive'}>
                配分 {allocationTotal}%
              </Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="triage-auto-generate" className="font-medium">
                  自動候補生成
                </Label>
                <Switch
                  id="triage-auto-generate"
                  checked={autoGenerateEnabled}
                  onCheckedChange={setAutoGenerateEnabled}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="triage-ai-adjustment" className="font-medium">
                  AI順位補正
                </Label>
                <Switch
                  id="triage-ai-adjustment"
                  checked={useAiRankAdjustment}
                  onCheckedChange={setUseAiRankAdjustment}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">配分</h3>
                <Button type="button" variant="outline" size="sm" onClick={balanceAllocations}>
                  均等配分
                </Button>
              </div>

              {projects.map((project) => {
                const allocation = projectAllocations[project.id] || 0;
                return (
                  <div key={project.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="truncate">{project.title}</Label>
                      <span className="text-sm font-medium">{allocation}%</span>
                    </div>
                    <Slider
                      value={[allocation]}
                      max={100}
                      step={5}
                      onValueChange={(values) => updateProjectAllocation(project.id, values[0] ?? 0)}
                    />
                  </div>
                );
              })}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Inbox</Label>
                  <span className="text-sm font-medium">{inboxAllocationPercent}%</span>
                </div>
                <Slider
                  value={[inboxAllocationPercent]}
                  max={100}
                  step={5}
                  onValueChange={(values) => setInboxAllocationPercent(values[0] ?? 0)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">作業種別上限</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {workTypes.map((workType) => (
                  <div key={workType} className="space-y-2">
                    <Label htmlFor={`triage-cap-${workType}`}>{workTypeLabels[workType]}</Label>
                    <Input
                      id={`triage-cap-${workType}`}
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="任意"
                      value={workTypeCaps[workType]}
                      onChange={(event) =>
                        setWorkTypeCaps((current) => ({
                          ...current,
                          [workType]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={saveSettings} disabled={saving} className="w-full sm:w-auto">
              <Save className="mr-2 h-4 w-4" />
              {saving ? '保存中...' : 'トリアージ設定を保存'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
