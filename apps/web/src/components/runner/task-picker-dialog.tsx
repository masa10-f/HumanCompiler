'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Calendar, Clock3, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { tasksApi } from '@/lib/api';
import { getOpenProjects } from '@/lib/project-filters';
import { useProjectOptions } from '@/hooks/use-project-query';
import { useGoalsByProjects } from '@/hooks/use-goals-query';
import type { TaskWorkspaceItem } from '@/types/task';

type PickerView = 'recommended' | 'today' | 'recent' | 'all';

interface TaskPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (task: TaskWorkspaceItem) => void;
  excludeTaskId?: string;
  title?: string;
}

export function TaskPickerDialog({
  open,
  onOpenChange,
  onSelect,
  excludeTaskId,
  title = 'タスクを選択',
}: TaskPickerDialogProps) {
  const [view, setView] = useState<PickerView>('recommended');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [projectId, setProjectId] = useState('');
  const [goalId, setGoalId] = useState('');

  const projects = useProjectOptions({
    enabled: open,
  });
  // Runner is for choosing the next actionable task, so archived projects
  // intentionally stay out of both project and goal selectors.
  const openProjects = useMemo(
    () => getOpenProjects(projects.data ?? []),
    [projects.data],
  );
  const goalProjectIds = useMemo(
    () => openProjects.map((project) => project.id),
    [openProjects],
  );
  const goals = useGoalsByProjects(goalProjectIds, {
    enabled: open && goalProjectIds.length > 0,
    limit: 100,
  });
  const recommendations = useQuery({
    queryKey: ['tasks', 'picker', 'recommendations'],
    queryFn: () => tasksApi.getRecommendations(),
    enabled: open && view === 'recommended',
  });
  const workspace = useQuery({
    queryKey: ['tasks', 'picker', view, deferredSearch, projectId, goalId],
    queryFn: () =>
      tasksApi.getWorkspace({
        limit: 100,
        status: ['pending', 'in_progress'],
        plan: view === 'today' ? 'today' : undefined,
        sortBy: view === 'recent' ? 'last_worked_at' : 'priority',
        sortOrder: view === 'recent' ? 'desc' : 'asc',
        search: view === 'all' ? deferredSearch || undefined : undefined,
        projectId: projectId || undefined,
        goalId: goalId || undefined,
      }),
    enabled: open && view !== 'recommended',
  });

  const items = useMemo(() => {
    const source =
      view === 'recommended'
        ? (recommendations.data ?? []).map((item) => ({
            task: item.task,
            reason: item.reason,
          }))
        : (workspace.data?.items ?? []).map((task) => ({ task, reason: undefined }));
    return source.filter(
      ({ task }) => task.id !== excludeTaskId && !task.is_blocked,
    );
  }, [excludeTaskId, recommendations.data, view, workspace.data?.items]);
  const filteredGoals = projectId
    ? (goals.data ?? []).filter((goal) => goal.project_id === projectId)
    : goals.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            おすすめ、今日の予定、最近の作業、全タスクから横断的に選べます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {([
            ['recommended', 'おすすめ', Bot],
            ['today', '今日', Calendar],
            ['recent', '最近', Clock3],
            ['all', '全タスク', Search],
          ] as const).map(([id, label, Icon]) => (
            <Button
              key={id}
              size="sm"
              variant={view === id ? 'default' : 'outline'}
              onClick={() => setView(id)}
            >
              <Icon className="mr-1 h-4 w-4" />
              {label}
            </Button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {view === 'all' && (
            <div className="relative sm:col-span-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="タイトル・説明・メモを検索"
                className="pl-9"
              />
            </div>
          )}
          <select
            aria-label="プロジェクトで絞り込み"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setGoalId('');
            }}
          >
            <option value="">全プロジェクト</option>
            {openProjects.map((project) => (
              <option key={project.id} value={project.id}>{project.title}</option>
            ))}
          </select>
          <select
            aria-label="ゴールで絞り込み"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={goalId}
            onChange={(event) => setGoalId(event.target.value)}
          >
            <option value="">全ゴール</option>
            {filteredGoals.map((goal) => (
              <option key={goal.id} value={goal.id}>{goal.title}</option>
            ))}
          </select>
        </div>

        <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {(recommendations.isLoading || workspace.isLoading) && (
            <p className="py-8 text-center text-muted-foreground">読み込み中...</p>
          )}
          {items.map(({ task, reason }) => (
            <button
              key={task.id}
              className="w-full rounded-lg border p-3 text-left hover:border-primary hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                onSelect(task);
                onOpenChange(false);
              }}
            >
              <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="break-words font-medium">{task.title}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {task.project_title} › {task.goal_title}
                  </div>
                  {reason && <div className="mt-2 text-xs">{reason}</div>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {task.planned_today && (
                    <Badge variant="info">
                      {task.planned_today_unplaced ? '今日・未配置' : '今日'}
                    </Badge>
                  )}
                  <Badge variant="outline">P{task.priority}</Badge>
                </div>
              </div>
            </button>
          ))}
          {!recommendations.isLoading && !workspace.isLoading && items.length === 0 && (
            <p className="py-8 text-center text-muted-foreground">選択可能なタスクはありません</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
