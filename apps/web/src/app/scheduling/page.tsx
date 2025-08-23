'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  Clock,
  Settings,
  CheckCircle,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  ExternalLink,
  Save
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { toast } from '@/hooks/use-toast';
import { schedulingApi, projectsApi, weeklyRecurringTasksApi } from '@/lib/api';
import { getSlotKindLabel, getSlotKindColor } from '@/constants/schedule';
import type {
  ScheduleRequest,
  ScheduleResult,
  TimeSlot,
  TaskSource,
  WeeklyScheduleOption
} from '@/types/ai-planning';
import type { Project } from '@/types/project';
import type { WeeklyRecurringTask } from '@/types/weekly-recurring-task';

export default function SchedulingPage() {
  const { user, loading: authLoading } = useAuth();

  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([
    { start: '09:00', end: '12:00', kind: 'focused_work' },
    { start: '13:00', end: '17:00', kind: 'study' },
    { start: '19:00', end: '21:00', kind: 'light_work' },
  ]);

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Task source configuration
  const [taskSource, setTaskSource] = useState<TaskSource>({ type: 'all_tasks' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [weeklyScheduleOptions, setWeeklyScheduleOptions] = useState<WeeklyScheduleOption[]>([]);
  const [weeklyRecurringTasks, setWeeklyRecurringTasks] = useState<WeeklyRecurringTask[]>([]);
  const [loading, setLoading] = useState(false);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      if (!user) return;

      try {
        setLoading(true);

        // Load projects, goals, weekly schedule options, and weekly recurring tasks in parallel
        const [projectsResult, weeklyOptionsResult, weeklyTasksResult] = await Promise.all([
          projectsApi.getAll(),
          schedulingApi.getWeeklyScheduleOptions(),
          weeklyRecurringTasksApi.getAll(0, 100, undefined, true), // Get all active weekly tasks
        ]);

        setProjects(projectsResult);
        setWeeklyScheduleOptions(weeklyOptionsResult);
        setWeeklyRecurringTasks(weeklyTasksResult as WeeklyRecurringTask[]);

      } catch (error) {
        console.error('Failed to load initial data:', error);
        toast({
          title: 'データ読み込みエラー',
          description: '初期データの読み込みに失敗しました',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, [user]);


  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const addTimeSlot = () => {
    setTimeSlots(prev => [...prev, {
      start: '09:00',
      end: '12:00',
      kind: 'light_work'
    }]);
  };

  const updateTimeSlot = (index: number, field: keyof TimeSlot, value: string | number | undefined) => {
    setTimeSlots(prev => prev.map((slot, i) =>
      i === index ? { ...slot, [field]: value } : slot
    ));
  };

  const removeTimeSlot = (index: number) => {
    setTimeSlots(prev => prev.filter((_, i) => i !== index));
  };

  const optimizeSchedule = async () => {
    try {
      setIsOptimizing(true);

      const request: ScheduleRequest = {
        date: selectedDate as string,
        time_slots: timeSlots,
        task_source: taskSource,
        // Legacy fields maintained for backward compatibility
        project_id: taskSource.type === 'project' ? taskSource.project_id : undefined,
        use_weekly_schedule: taskSource.type === 'weekly_schedule',
      };

      const result = await schedulingApi.optimizeDaily(request);
      setScheduleResult(result);

      if (result.success) {
        toast({
          title: 'スケジュール最適化完了',
          description: `${result.assignments.length}個のタスクがスケジュールされました`,
        });
      } else {
        toast({
          title: '最適化に失敗しました',
          description: `ステータス: ${result.optimization_status}`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: '最適化エラー',
        description: error instanceof Error ? error.message : '不明なエラーが発生しました',
        variant: 'destructive',
      });
    } finally {
      setIsOptimizing(false);
    }
  };

  const saveSchedule = async () => {
    if (!scheduleResult) return;

    try {
      setIsSaving(true);

      const scheduleData = {
        ...scheduleResult,
        date: selectedDate as string,
        generated_at: new Date().toISOString()
      };

      await schedulingApi.save(scheduleData);

      toast({
        title: 'スケジュール保存完了',
        description: '本日のスケジュールが保存されました',
      });
    } catch (error) {
      toast({
        title: '保存エラー',
        description: error instanceof Error ? error.message : 'スケジュールの保存に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="scheduling" />

      <div className="container mx-auto py-8">
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Settings className="h-8 w-8 text-blue-600" />
              スケジュール最適化
            </h1>
          </div>
          <p className="text-gray-600">
            OR-Toolsを使用してタスクの最適なスケジューリングを行います。
          </p>
        </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Schedule Configuration */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                スケジュール設定
              </CardTitle>
              <CardDescription>
                最適化する日付と利用可能時間を設定してください。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="schedule-date">対象日</Label>
                <Input
                  id="schedule-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>

              <div className="space-y-4">
                <Label>タスクソース</Label>
                <div className="space-y-3">
                  {/* Task source type selection */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">ソースタイプ</Label>
                    <Select
                      value={taskSource.type}
                      onValueChange={(value: TaskSource['type']) =>
                        setTaskSource({ type: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all_tasks">すべてのタスク</SelectItem>
                        <SelectItem value="project">プロジェクトから選択</SelectItem>
                        <SelectItem value="weekly_schedule">週間スケジュールから選択</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Project selection */}
                  {taskSource.type === 'project' && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">プロジェクト選択</Label>
                      <Select
                        value={taskSource.project_id || ''}
                        onValueChange={(value) =>
                          setTaskSource(prev => ({ ...prev, project_id: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="プロジェクトを選択..." />
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}


                  {/* Weekly schedule selection */}
                  {taskSource.type === 'weekly_schedule' && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">週間スケジュール選択</Label>
                      <Select
                        value={taskSource.weekly_schedule_date || ''}
                        onValueChange={(value) =>
                          setTaskSource(prev => ({ ...prev, weekly_schedule_date: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="週間スケジュールを選択..." />
                        </SelectTrigger>
                        <SelectContent>
                          {weeklyScheduleOptions.map((option) => (
                            <SelectItem key={option.week_start_date} value={option.week_start_date}>
                              {option.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {weeklyScheduleOptions.length === 0 && !loading && (
                        <p className="text-sm text-gray-500">
                          利用可能な週間スケジュールがありません
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>利用可能時間スロット</Label>
                  <Button onClick={addTimeSlot} size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-2" />
                    追加
                  </Button>
                </div>

                <div className="space-y-3">
                  {timeSlots.map((slot, index) => (
                    <div key={index} className="p-3 border rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">スロット {index + 1}</span>
                        <Button
                          onClick={() => removeTimeSlot(index)}
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">開始時刻</Label>
                          <Input
                            type="time"
                            value={slot.start}
                            onChange={(e) => updateTimeSlot(index, 'start', e.target.value)}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">終了時刻</Label>
                          <Input
                            type="time"
                            value={slot.end}
                            onChange={(e) => updateTimeSlot(index, 'end', e.target.value)}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">種別</Label>
                          <Select
                            value={slot.kind}
                            onValueChange={(value) => updateTimeSlot(index, 'kind', value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="study">学習</SelectItem>
                              <SelectItem value="focused_work">集中作業</SelectItem>
                              <SelectItem value="light_work">軽作業</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Slot-level assignment fields */}
                      <div className="grid grid-cols-2 gap-2 pt-3 border-t">
                        <div className="space-y-1">
                          <Label className="text-xs">指定プロジェクト</Label>
                          <Select
                            value={slot.assigned_project_id || ''}
                            onValueChange={(value) =>
                              updateTimeSlot(index, 'assigned_project_id', value || undefined)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="未指定" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">未指定</SelectItem>
                              {projects.map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                  {project.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">指定週次タスク</Label>
                          <Select
                            value={slot.assigned_weekly_task_id || ''}
                            onValueChange={(value) =>
                              updateTimeSlot(index, 'assigned_weekly_task_id', value || undefined)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="未指定" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">未指定</SelectItem>
                              {weeklyRecurringTasks.map((task) => (
                                <SelectItem key={task.id} value={task.id}>
                                  {task.title} ({task.estimate_hours}h)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                onClick={optimizeSchedule}
                disabled={isOptimizing || timeSlots.length === 0}
                className="w-full"
              >
                {isOptimizing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                スケジュールを最適化
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Optimization Results */}
        <div className="space-y-6">
          {scheduleResult && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {scheduleResult.success ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-600" />
                      )}
                      最適化結果
                    </CardTitle>
                    <CardDescription>
                      {new Date(selectedDate as string).toLocaleDateString('ja-JP')}のスケジュール
                    </CardDescription>
                  </div>
                  {scheduleResult.success && scheduleResult.assignments.length > 0 && (
                    <Button
                      onClick={saveSchedule}
                      disabled={isSaving}
                      size="sm"
                      className="flex items-center gap-2"
                    >
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      スケジュールを保存
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <div>
                          <div className="text-2xl font-bold">
                            {scheduleResult.assignments.length}
                          </div>
                          <div className="text-xs text-gray-500">スケジュール済み</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-blue-600" />
                        <div>
                          <div className="text-2xl font-bold">
                            {scheduleResult.total_scheduled_hours.toFixed(1)}h
                          </div>
                          <div className="text-xs text-gray-500">総スケジュール時間</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Optimization Details */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>最適化ステータス:</span>
                    <Badge variant={scheduleResult.success ? 'default' : 'destructive'}>
                      {scheduleResult.optimization_status}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>計算時間:</span>
                    <span>{scheduleResult.solve_time_seconds.toFixed(2)}秒</span>
                  </div>
                  {scheduleResult.objective_value !== undefined && (
                    <div className="flex justify-between text-sm">
                      <span>目的関数値:</span>
                      <span>{scheduleResult.objective_value}</span>
                    </div>
                  )}
                </div>

                {/* Task Assignments */}
                {scheduleResult.assignments.length > 0 && (
                  <div>
                    <h4 className="text-lg font-semibold mb-3">タスク割り当て</h4>
                    <div className="space-y-2">
                      {scheduleResult.assignments
                        .sort((a, b) => a.start_time.localeCompare(b.start_time))
                        .map((assignment, index) => {
                        const slotInfo = timeSlots[assignment.slot_index];
                        const taskLink = assignment.project_id && assignment.goal_id
                          ? `/projects/${assignment.project_id}/goals/${assignment.goal_id}`
                          : null;

                        return (
                          <div key={index} className="p-3 border rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className="font-medium">
                                  {assignment.task_title}
                                </div>
                                {taskLink && (
                                  <Link
                                    href={taskLink || '#'}
                                    className="text-blue-500 hover:text-blue-700 transition-colors"
                                    title="タスク詳細を表示"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </Link>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge className={getSlotKindColor(slotInfo?.kind || 'light_work')}>
                                  {getSlotKindLabel(slotInfo?.kind || 'light_work')}
                                </Badge>
                                <span className="text-sm text-gray-500">
                                  {assignment.duration_hours.toFixed(1)}h
                                </span>
                              </div>
                            </div>
                            <div className="text-sm text-gray-600">
                              {assignment.start_time} - スロット{assignment.slot_index + 1}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              ID: {assignment.task_id}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Note: Unscheduled tasks are intentionally not displayed per issue #85 */}
              </CardContent>
            </Card>
          )}

          {/* Time Slots Preview */}
          <Card>
            <CardHeader>
              <CardTitle>時間スロット一覧</CardTitle>
              <CardDescription>
                設定された利用可能時間の確認
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {timeSlots.map((slot, index) => {
                  const startTime = new Date(`2000-01-01T${slot.start}`);
                  const endTime = new Date(`2000-01-01T${slot.end}`);
                  const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

                  return (
                    <div key={index} className="flex items-center justify-between p-2 border rounded">
                      <div className="flex items-center gap-2">
                        <Badge className={getSlotKindColor(slot.kind)}>
                          {getSlotKindLabel(slot.kind)}
                        </Badge>
                        <span className="text-sm">
                          {slot.start} - {slot.end}
                        </span>
                      </div>
                      <span className="text-sm text-gray-500">
                        {duration.toFixed(1)}時間
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  );
}
