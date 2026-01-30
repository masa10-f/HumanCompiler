'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
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
  ExternalLink,
  Save,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { toast } from '@/hooks/use-toast';
import { schedulingApi, projectsApi, tasksApi, quickTasksApi } from '@/lib/api';
import { getSlotKindLabel, getSlotKindColor } from '@/constants/schedule';
import { DroppableSlot, TaskPool, DraggableTask } from '@/components/scheduling';
import type {
  ScheduleRequest,
  ScheduleResult,
  TimeSlot,
  TaskSource,
  TaskInfo,
  FixedAssignment,
  WeeklyScheduleOption,
} from '@/types/ai-planning';
import type { Project } from '@/types/project';
import { getJSTDateString } from '@/lib/date-utils';
import { logger } from '@/lib/logger';

interface ManualAssignment {
  taskId: string;
  slotIndex: number;
  durationHours?: number;
}

export default function SchedulingPage() {
  const { user, loading: authLoading } = useAuth();

  const [selectedDate, setSelectedDate] = useState(() => getJSTDateString());

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

  // Available tasks for scheduling
  const [availableTasks, setAvailableTasks] = useState<TaskInfo[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);

  // Manual assignments (user-defined fixed assignments)
  const [manualAssignments, setManualAssignments] = useState<ManualAssignment[]>([]);

  // Active dragging state
  const [activeDragTask, setActiveDragTask] = useState<TaskInfo | null>(null);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      if (!user) return;

      try {
        const [projectsResult, weeklyOptionsResult] = await Promise.all([
          projectsApi.getAll(),
          schedulingApi.getWeeklyScheduleOptions().catch(err => {
            logger.error('Weekly schedule options loading failed', err instanceof Error ? err : new Error(String(err)), { component: 'SchedulingPage' });
            return [];
          }),
        ]);

        setProjects(projectsResult);
        setWeeklyScheduleOptions(weeklyOptionsResult);

      } catch (error) {
        logger.error('Failed to load initial data', error instanceof Error ? error : new Error(String(error)), { component: 'SchedulingPage' });
        toast({
          title: 'データ読み込みエラー',
          description: '初期データの読み込みに失敗しました',
          variant: 'destructive',
        });
      } finally {
        // Loading complete
      }
    };

    loadInitialData();
  }, [user]);

  // Load available tasks when task source changes
  useEffect(() => {
    const loadTasks = async () => {
      if (!user) return;

      try {
        setIsLoadingTasks(true);

        let tasks: TaskInfo[] = [];

        if (taskSource.type === 'project' && taskSource.project_id) {
          const projectTasks = await tasksApi.getByProject(taskSource.project_id);
          tasks = projectTasks
            .filter(t => t.status !== 'completed' && t.status !== 'cancelled')
            .map(t => ({
              id: t.id,
              title: t.title,
              estimate_hours: Number(t.estimate_hours) || 1,
              priority: t.priority || 3,
              kind: t.work_type || 'light_work',
              due_date: t.due_date ?? undefined,
              goal_id: t.goal_id,
              project_id: taskSource.project_id,
            }));
        } else if (taskSource.type === 'all_tasks') {
          // Load tasks from all projects
          const allTasks: TaskInfo[] = [];
          for (const project of projects) {
            try {
              const projectTasks = await tasksApi.getByProject(project.id);
              const filtered = projectTasks
                .filter(t => t.status !== 'completed' && t.status !== 'cancelled')
                .map(t => ({
                  id: t.id,
                  title: t.title,
                  estimate_hours: Number(t.estimate_hours) || 1,
                  priority: t.priority || 3,
                  kind: t.work_type || 'light_work',
                  due_date: t.due_date ?? undefined,
                  goal_id: t.goal_id,
                  project_id: project.id,
                }));
              allTasks.push(...(filtered as TaskInfo[]));
            } catch (err) {
              logger.error(`Failed to load tasks for project ${project.id}`, err instanceof Error ? err : new Error(String(err)));
            }
          }

          // Also load quick tasks (unclassified tasks)
          try {
            const quickTasks = await quickTasksApi.getAll();
            const filteredQuickTasks = quickTasks
              .filter(qt => qt.status !== 'completed' && qt.status !== 'cancelled')
              .map(qt => ({
                id: `quick_${qt.id}`,  // Prefix to match backend convention
                title: `📥 ${qt.title}`,  // Mark as quick task
                estimate_hours: Number(qt.estimate_hours) || 0.5,
                priority: qt.priority || 3,
                kind: qt.work_type || 'light_work',
                due_date: qt.due_date ?? undefined,
                goal_id: undefined,
                project_id: undefined,
              }));
            allTasks.push(...(filteredQuickTasks as TaskInfo[]));
          } catch (err) {
            logger.error('Failed to load quick tasks', err instanceof Error ? err : new Error(String(err)));
          }

          tasks = allTasks;
        }

        setAvailableTasks(tasks);
        // Clear manual assignments when task source changes
        setManualAssignments([]);
        setScheduleResult(null);

      } catch (error) {
        logger.error('Failed to load tasks', error instanceof Error ? error : new Error(String(error)), { component: 'SchedulingPage' });
        toast({
          title: 'タスク読み込みエラー',
          description: 'タスクの読み込みに失敗しました',
          variant: 'destructive',
        });
      } finally {
        setIsLoadingTasks(false);
      }
    };

    if (projects.length > 0 || taskSource.type === 'weekly_schedule') {
      loadTasks();
    }
  }, [user, taskSource, projects]);

  // Get assigned task IDs
  const assignedTaskIds = useMemo(() => {
    const ids = new Set<string>();
    manualAssignments.forEach(a => ids.add(a.taskId));
    return ids;
  }, [manualAssignments]);

  // Get tasks assigned to each slot
  const getSlotTasks = useCallback((slotIndex: number) => {
    const assignments = manualAssignments.filter(a => a.slotIndex === slotIndex);
    return assignments.map(a => {
      const task = availableTasks.find(t => t.id === a.taskId);
      return {
        task: task!,
        isFixed: false,  // Allow removal and re-dragging before optimization
        duration_hours: a.durationHours,
      };
    }).filter(t => t.task);
  }, [manualAssignments, availableTasks]);

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const task = active.data?.current?.task as TaskInfo | undefined;
    if (task) {
      setActiveDragTask(task);
    }
  }, []);

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    // Dropping on task pool (remove from slot)
    if (overId === 'task-pool') {
      setManualAssignments(prev => prev.filter(a => a.taskId !== taskId));
      return;
    }

    // Dropping on a slot
    if (overId.startsWith('slot-')) {
      const slotIndex = parseInt(overId.replace('slot-', ''), 10);

      // Remove from any previous slot
      setManualAssignments(prev => {
        const filtered = prev.filter(a => a.taskId !== taskId);
        return [...filtered, { taskId, slotIndex }];
      });
    }
  }, []);

  // Slot management
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
    // Also remove any manual assignments for this slot
    setManualAssignments(prev => prev.filter(a => a.slotIndex !== index));
  };

  const removeTaskFromSlot = (taskId: string) => {
    setManualAssignments(prev => prev.filter(a => a.taskId !== taskId));
  };

  const updateTaskDuration = (taskId: string, durationHours: number | undefined) => {
    setManualAssignments(prev => prev.map(a =>
      a.taskId === taskId ? { ...a, durationHours } : a
    ));
  };

  const clearAllAssignments = () => {
    setManualAssignments([]);
    setScheduleResult(null);
  };

  // Optimize schedule
  const optimizeSchedule = async () => {
    try {
      setIsOptimizing(true);

      // Convert manual assignments to fixed assignments
      const fixedAssignments: FixedAssignment[] = manualAssignments.map(a => ({
        task_id: a.taskId,
        slot_index: a.slotIndex,
        duration_hours: a.durationHours,
      }));

      const request: ScheduleRequest = {
        date: selectedDate,
        time_slots: timeSlots,
        task_source: taskSource,
        project_id: taskSource.type === 'project' ? taskSource.project_id : undefined,
        use_weekly_schedule: taskSource.type === 'weekly_schedule',
        fixed_assignments: fixedAssignments,
      };

      const result = await schedulingApi.optimizeDaily(request);
      setScheduleResult(result);

      if (result.success) {
        toast({
          title: 'スケジュール最適化完了',
          description: `${result.assignments.length}個のタスクがスケジュールされました（${manualAssignments.length}個は手動配置）`,
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

  // Save schedule
  const saveSchedule = async () => {
    if (!scheduleResult) return;

    try {
      setIsSaving(true);

      const scheduleData = {
        ...scheduleResult,
        date: selectedDate,
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

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="scheduling" />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="container mx-auto py-6 px-4">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Settings className="h-7 w-7 text-blue-600" />
                日次スケジューラ
              </h1>
              <div className="flex items-center gap-2">
                <Button
                  onClick={clearAllAssignments}
                  variant="outline"
                  size="sm"
                  disabled={manualAssignments.length === 0}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  リセット
                </Button>
                <Button
                  onClick={optimizeSchedule}
                  disabled={isOptimizing || timeSlots.length === 0}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  {isOptimizing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {manualAssignments.length > 0 ? '残りを自動補完' : '自動スケジュール'}
                </Button>
              </div>
            </div>
            <p className="text-gray-600 text-sm">
              タスクをドラッグ&ドロップでスロットに配置し、残りをAIが自動補完します
            </p>
          </div>

          {/* Configuration Bar */}
          <Card className="mb-6">
            <CardContent className="py-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">対象日</Label>
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-[160px] h-9"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">タスクソース</Label>
                  <Select
                    value={taskSource.type}
                    onValueChange={(value: TaskSource['type']) =>
                      setTaskSource({ type: value })
                    }
                  >
                    <SelectTrigger className="w-[180px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_tasks">すべてのタスク</SelectItem>
                      <SelectItem value="project">プロジェクト</SelectItem>
                      <SelectItem value="weekly_schedule">週間スケジュール</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {taskSource.type === 'project' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">プロジェクト</Label>
                    <Select
                      value={taskSource.project_id || ''}
                      onValueChange={(value) =>
                        setTaskSource(prev => ({ ...prev, project_id: value }))
                      }
                    >
                      <SelectTrigger className="w-[200px] h-9">
                        <SelectValue placeholder="選択..." />
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

                {taskSource.type === 'weekly_schedule' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">週間スケジュール</Label>
                    <Select
                      value={taskSource.weekly_schedule_date || ''}
                      onValueChange={(value) =>
                        setTaskSource(prev => ({ ...prev, weekly_schedule_date: value }))
                      }
                    >
                      <SelectTrigger className="w-[250px] h-9">
                        <SelectValue placeholder="選択..." />
                      </SelectTrigger>
                      <SelectContent>
                        {weeklyScheduleOptions.map((option) => (
                          <SelectItem key={option.week_start_date} value={option.week_start_date}>
                            {option.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Button onClick={addTimeSlot} variant="outline" size="sm" className="h-9">
                  <Plus className="h-4 w-4 mr-1" />
                  スロット追加
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Main Content - 3 Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Task Pool - Left */}
            <div className="lg:col-span-4 xl:col-span-3">
              <TaskPool
                tasks={availableTasks}
                assignedTaskIds={assignedTaskIds}
                isLoading={isLoadingTasks}
                projects={projects}
              />
            </div>

            {/* Slots - Center */}
            <div className="lg:col-span-5 xl:col-span-6">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Calendar className="h-5 w-5 text-purple-600" />
                        タイムスロット
                      </CardTitle>
                      <CardDescription>
                        タスクをドロップして配置
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="text-sm">
                      {manualAssignments.length}個 配置済み
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {timeSlots.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p>スロットがありません</p>
                      <p className="text-sm">上のボタンでスロットを追加してください</p>
                    </div>
                  ) : (
                    timeSlots.map((slot, index) => (
                      <DroppableSlot
                        key={index}
                        slot={slot}
                        slotIndex={index}
                        assignedTasks={getSlotTasks(index)}
                        projects={projects}
                        onSlotChange={updateTimeSlot}
                        onRemoveSlot={removeTimeSlot}
                        onRemoveTask={removeTaskFromSlot}
                        onTaskDurationChange={updateTaskDuration}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Results - Right */}
            <div className="lg:col-span-3 xl:col-span-3">
              {scheduleResult && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        {scheduleResult.success ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-red-600" />
                        )}
                        最適化結果
                      </CardTitle>
                      {scheduleResult.success && scheduleResult.assignments.length > 0 && (
                        <Button
                          onClick={saveSchedule}
                          disabled={isSaving}
                          size="sm"
                          variant="outline"
                        >
                          {isSaving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-green-700">
                          {scheduleResult.assignments.length}
                        </div>
                        <div className="text-xs text-green-600">タスク</div>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-blue-700">
                          {scheduleResult.total_scheduled_hours.toFixed(1)}h
                        </div>
                        <div className="text-xs text-blue-600">合計時間</div>
                      </div>
                    </div>

                    {/* Optimization Details */}
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">ステータス</span>
                        <Badge variant={scheduleResult.success ? 'default' : 'destructive'} className="text-xs">
                          {scheduleResult.optimization_status}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">計算時間</span>
                        <span>{scheduleResult.solve_time_seconds.toFixed(2)}秒</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">手動配置</span>
                        <span>{scheduleResult.assignments.filter(a => a.is_fixed).length}件</span>
                      </div>
                    </div>

                    {/* Task List */}
                    {scheduleResult.assignments.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">割り当て一覧</h4>
                        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                          {scheduleResult.assignments
                            .sort((a, b) => a.start_time.localeCompare(b.start_time))
                            .map((assignment, index) => {
                              const slotInfo = timeSlots[assignment.slot_index];
                              const taskLink = assignment.project_id && assignment.goal_id
                                ? `/projects/${assignment.project_id}/goals/${assignment.goal_id}`
                                : null;

                              return (
                                <div
                                  key={index}
                                  className={`p-2 rounded border text-xs ${assignment.is_fixed ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium truncate flex-1">
                                      {assignment.is_fixed && '📌 '}
                                      {assignment.task_title}
                                    </span>
                                    {taskLink && (
                                      <Link href={taskLink} className="text-blue-500 hover:text-blue-700 ml-1">
                                        <ExternalLink className="h-3 w-3" />
                                      </Link>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 text-gray-500">
                                    <Clock className="h-3 w-3" />
                                    <span>{assignment.start_time}</span>
                                    <span>•</span>
                                    <Badge className={`text-[10px] py-0 ${getSlotKindColor(slotInfo?.kind || 'light_work')}`}>
                                      {getSlotKindLabel(slotInfo?.kind || 'light_work')}
                                    </Badge>
                                    <span>{assignment.duration_hours.toFixed(1)}h</span>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {!scheduleResult && (
                <Card className="bg-gray-50 border-dashed">
                  <CardContent className="py-12 text-center text-gray-500">
                    <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">最適化結果がここに表示されます</p>
                    <p className="text-sm mt-1">
                      タスクを配置して「自動補完」をクリック
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeDragTask ? (
            <div className="opacity-90 transform scale-105">
              <DraggableTask task={activeDragTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
