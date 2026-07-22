'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarClock, Lock, Plus, Trash2, Unlock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { tasksApi } from '@/lib/api';
import type { WeeklyPlanResponse } from '@/types/ai-planning';
import type { Project } from '@/types/project';

interface WeeklyPlanEditorProps {
  plan: WeeklyPlanResponse;
  capacityHours: number;
  projects: Project[];
  canRecalculate: boolean;
  onChange: (plan: WeeklyPlanResponse) => void;
}

export function WeeklyPlanEditor({
  plan,
  capacityHours,
  projects,
  canRecalculate,
  onChange,
}: WeeklyPlanEditorProps) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [recalculateDate, setRecalculateDate] = useState(plan.week_start_date);
  useEffect(() => setRecalculateDate(plan.week_start_date), [plan.week_start_date]);
  const backlog = useQuery({
    queryKey: ['tasks', 'weekly-editor', plan.week_start_date],
    queryFn: () => tasksApi.getWorkspace({
      limit: 100,
      status: ['pending', 'in_progress'],
      sortBy: 'priority',
    }),
  });
  const selectedIds = new Set(plan.task_plans.map((task) => task.task_id));
  const backlogTasks = (backlog.data?.items ?? []).filter(
    (task) => !selectedIds.has(task.id) && !task.is_blocked,
  );
  const workspaceById = useMemo(
    () => new Map((backlog.data?.items ?? []).map((task) => [task.id, task])),
    [backlog.data?.items],
  );
  const assignedHours = plan.assigned_task_hours ?? Object.fromEntries(
    plan.task_plans.map((task) => [task.task_id, task.estimated_hours]),
  );
  const totalHours = Object.values(assignedHours).reduce((sum, hours) => sum + Number(hours || 0), 0);
  const pinned = new Set(plan.pinned_task_ids ?? []);
  const distribution = plan.task_plans.reduce<Record<string, number>>((result, task) => {
    const projectId = workspaceById.get(task.task_id)?.project_id ?? 'unknown';
    result[projectId] = (result[projectId] ?? 0) + Number(assignedHours[task.task_id] ?? task.estimated_hours);
    return result;
  }, {});
  const allocationTargets = new Map(
    (plan.project_allocations ?? []).map((allocation) => [
      allocation.project_id,
      allocation.target_hours,
    ]),
  );

  const updateTasks = (
    taskPlans: WeeklyPlanResponse['task_plans'],
    nextAssigned = assignedHours,
    nextPinned = [...pinned],
  ) => onChange({
    ...plan,
    task_plans: taskPlans,
    assigned_task_hours: nextAssigned,
    pinned_task_ids: nextPinned,
    total_planned_hours: Object.values(nextAssigned).reduce((sum, hours) => sum + Number(hours || 0), 0),
  });
  const addTask = (taskId: string) => {
    const task = workspaceById.get(taskId);
    if (!task || selectedIds.has(taskId)) return;
    updateTasks(
      [...plan.task_plans, {
        task_id: task.id,
        task_title: task.title,
        estimated_hours: task.remaining_estimate_hours,
        priority: task.priority,
        rationale: '週次計画エディタから手動追加',
      }],
      { ...assignedHours, [task.id]: task.remaining_estimate_hours },
    );
  };
  const removeTask = (taskId: string) => {
    const nextAssigned = { ...assignedHours };
    delete nextAssigned[taskId];
    updateTasks(
      plan.task_plans.filter((task) => task.task_id !== taskId),
      nextAssigned,
      [...pinned].filter((id) => id !== taskId),
    );
  };
  const moveTask = (taskId: string, offset: number) => {
    const index = plan.task_plans.findIndex((task) => task.task_id === taskId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= plan.task_plans.length) return;
    const next = [...plan.task_plans];
    [next[index], next[target]] = [next[target]!, next[index]!];
    updateTasks(next);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4"><div className="text-xs text-muted-foreground">割当時間</div><div className="text-2xl font-bold">{totalHours.toFixed(1)}h</div></CardContent>
        </Card>
        <Card className={totalHours > capacityHours ? 'border-destructive' : ''}>
          <CardContent className="pt-4"><div className="text-xs text-muted-foreground">週間容量</div><div className="text-2xl font-bold">{capacityHours}h</div>{totalHours > capacityHours && <p className="text-xs text-destructive">{(totalHours - capacityHours).toFixed(1)}h 超過</p>}</CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4"><div className="text-xs text-muted-foreground">計画タスク</div><div className="text-2xl font-bold">{plan.task_plans.length}</div></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => draggedTaskId && removeTask(draggedTaskId)}
        >
          <CardHeader><CardTitle className="text-base">Backlog</CardTitle></CardHeader>
          <CardContent className="max-h-96 space-y-2 overflow-y-auto">
            {backlogTasks.map((task) => (
              <div key={task.id} draggable onDragStart={() => setDraggedTaskId(task.id)} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0"><div className="truncate text-sm font-medium">{task.title}</div><div className="truncate text-xs text-muted-foreground">{task.project_title} › {task.goal_title}</div></div>
                <Button size="icon" variant="ghost" aria-label={`${task.title}を今週に追加`} onClick={() => addTask(task.id)}><Plus className="h-4 w-4" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => draggedTaskId && addTask(draggedTaskId)}
        >
          <CardHeader><CardTitle className="text-base">今週</CardTitle></CardHeader>
          <CardContent className="max-h-96 space-y-2 overflow-y-auto">
            {plan.task_plans.map((task, index) => (
              <div key={task.task_id} draggable onDragStart={() => setDraggedTaskId(task.task_id)} className="rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{task.task_title}</div><div className="text-xs text-muted-foreground">P{task.priority}</div></div>
                  <Input
                    aria-label={`${task.task_title}の割当時間`}
                    className="h-8 w-20"
                    type="number"
                    min={0.25}
                    max={999}
                    step={0.25}
                    value={assignedHours[task.task_id] ?? task.estimated_hours}
                    onChange={(event) => updateTasks(plan.task_plans, { ...assignedHours, [task.task_id]: Number(event.target.value) })}
                  />
                  <Button size="icon" variant="ghost" aria-label="固定切替" onClick={() => {
                    const next = new Set(pinned);
                    if (next.has(task.task_id)) next.delete(task.task_id); else next.add(task.task_id);
                    updateTasks(plan.task_plans, assignedHours, [...next]);
                  }}>{pinned.has(task.task_id) ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</Button>
                  <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => moveTask(task.task_id, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" disabled={index === plan.task_plans.length - 1} onClick={() => moveTask(task.task_id, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => removeTask(task.task_id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">プロジェクト別時間配分</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(distribution).map(([projectId, hours]) => (
            <Badge key={projectId} variant="outline">
              {projects.find((project) => project.id === projectId)?.title ?? '不明'}: 実績 {hours.toFixed(1)}h
              {allocationTargets.has(projectId) && ` / 目標 ${Number(allocationTargets.get(projectId)).toFixed(1)}h`}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="再計算する日"
          className="w-44"
          type="date"
          min={plan.week_start_date}
          max={new Date(new Date(`${plan.week_start_date}T00:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10)}
          value={recalculateDate}
          onChange={(event) => setRecalculateDate(event.target.value)}
        />
        {canRecalculate ? (
          <Button asChild variant="outline">
            <Link href={`/scheduling/daily?source=weekly_schedule&week_start=${encodeURIComponent(plan.week_start_date)}&date=${encodeURIComponent(recalculateDate)}`}>
              <CalendarClock className="mr-2 h-4 w-4" />
              日次計画を再計算
            </Link>
          </Button>
        ) : (
          <Button disabled variant="outline">
            <CalendarClock className="mr-2 h-4 w-4" />
            保存後に日次計画を再計算
          </Button>
        )}
      </div>
    </div>
  );
}
