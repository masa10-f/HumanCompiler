"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  ListTodo,
  Play,
  Search,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { QuickTaskList } from "@/components/quick-tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import {
  useTaskRecommendations,
  useTaskWorkspace,
  useUpdateTask,
} from "@/hooks/use-tasks-query";
import { goalsApi, projectsApi, quickTasksApi } from "@/lib/api";
import type { Goal } from "@/types/goal";
import type { QuickTask } from "@/types/quick-task";
import type {
  TaskStatus,
  TaskWorkspaceFilters,
  TaskWorkspaceItem,
} from "@/types/task";
import { taskStatusLabels } from "@/types/task";

type Preset =
  | "next"
  | "today"
  | "week"
  | "in_progress"
  | "overdue"
  | "blocked"
  | "unplanned"
  | "inbox"
  | "all";

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "next", label: "次にやる" },
  { id: "today", label: "今日" },
  { id: "week", label: "今週" },
  { id: "in_progress", label: "作業中" },
  { id: "overdue", label: "期限切れ" },
  { id: "blocked", label: "ブロック中" },
  { id: "unplanned", label: "未計画" },
  { id: "inbox", label: "Inbox" },
  { id: "all", label: "全タスク" },
];

const actionableStatuses: TaskStatus[] = ["pending", "in_progress"];

function dateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function TaskRow({
  task,
  goals,
  onOpen,
}: {
  task: TaskWorkspaceItem;
  goals: Goal[];
  onOpen: () => void;
}) {
  const updateTask = useUpdateTask();

  const update = async (
    data: Parameters<typeof updateTask.mutateAsync>[0]["data"],
  ) => {
    try {
      await updateTask.mutateAsync({ id: task.id, data });
    } catch {
      toast({
        title: "タスクを更新できませんでした",
        description: "入力内容を確認して、もう一度お試しください。",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="grid gap-3 border-b border-border px-4 py-4 last:border-b-0 xl:grid-cols-[minmax(260px,2fr)_140px_110px_150px_120px_minmax(210px,1fr)_110px] xl:items-center">
      <div className="min-w-0">
        <button className="block max-w-full text-left" onClick={onOpen}>
          <span className="block truncate font-medium hover:text-primary hover:underline">
            {task.title}
          </span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {task.project_title} › {task.goal_title}
          </span>
          {task.is_blocked && <Badge variant="destructive">ブロック中</Badge>}
          {task.planned_today && <Badge variant="info">今日</Badge>}
          {!task.planned_today && task.planned_this_week && (
            <Badge variant="secondary">今週</Badge>
          )}
        </div>
      </div>

      <label className="text-xs text-muted-foreground">
        <span className="mb-1 block xl:hidden">ステータス</span>
        <select
          aria-label={`${task.title}のステータス`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={task.status}
          disabled={updateTask.isPending}
          onChange={(event) =>
            update({ status: event.target.value as TaskStatus })
          }
        >
          {Object.entries(taskStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-muted-foreground">
        <span className="mb-1 block xl:hidden">優先度</span>
        <select
          aria-label={`${task.title}の優先度`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={task.priority}
          disabled={updateTask.isPending}
          onChange={(event) => update({ priority: Number(event.target.value) })}
        >
          {[1, 2, 3, 4, 5].map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-muted-foreground">
        <span className="mb-1 block xl:hidden">期限</span>
        <Input
          aria-label={`${task.title}の期限`}
          type="date"
          defaultValue={dateInputValue(task.due_date)}
          disabled={updateTask.isPending}
          onChange={(event) =>
            update({
              due_date: event.target.value
                ? new Date(`${event.target.value}T23:59:59`).toISOString()
                : null,
            })
          }
        />
      </label>

      <label className="text-xs text-muted-foreground">
        <span className="mb-1 block xl:hidden">見積時間</span>
        <Input
          aria-label={`${task.title}の見積時間`}
          type="number"
          min="0.01"
          step="0.25"
          defaultValue={task.estimate_hours}
          disabled={updateTask.isPending}
          onBlur={(event) => {
            const value = Number(event.target.value);
            if (value > 0 && value !== task.estimate_hours)
              update({ estimate_hours: value });
          }}
        />
      </label>

      <label className="text-xs text-muted-foreground">
        <span className="mb-1 block xl:hidden">所属ゴール</span>
        <select
          aria-label={`${task.title}の所属ゴール`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={task.goal_id}
          disabled={updateTask.isPending}
          onChange={(event) => update({ goal_id: event.target.value })}
        >
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.title}
            </option>
          ))}
        </select>
      </label>

      <Button size="sm" asChild>
        <Link href={`/runner?taskId=${encodeURIComponent(task.id)}`}>
          <Play className="mr-1 h-4 w-4" />
          開始
        </Link>
      </Button>
    </div>
  );
}

export default function TasksPage() {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<Preset>("next");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [projectId, setProjectId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [page, setPage] = useState(0);
  const [selectedTask, setSelectedTask] = useState<TaskWorkspaceItem | null>(
    null,
  );
  const [convertingTask, setConvertingTask] = useState<QuickTask | null>(null);
  const [convertGoalId, setConvertGoalId] = useState("");
  const [inboxVersion, setInboxVersion] = useState(0);
  const [isConverting, setIsConverting] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "task-workspace"],
    queryFn: () => projectsApi.getAll(0, 100),
    enabled: Boolean(user),
  });
  const { data: goals = [] } = useQuery({
    queryKey: [
      "goals",
      "task-workspace",
      projects.map((project) => project.id).join(","),
    ],
    queryFn: async () => {
      const results = await Promise.allSettled(
        projects.map((project) => goalsApi.getByProject(project.id, 0, 100)),
      );
      return results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
    },
    enabled: projects.length > 0,
  });

  const filters = useMemo<TaskWorkspaceFilters>(() => {
    let statuses = status ? [status] : undefined;
    if (
      !status &&
      (preset === "next" ||
        preset === "overdue" ||
        preset === "today" ||
        preset === "week" ||
        preset === "unplanned")
    ) {
      statuses = actionableStatuses;
    }
    if (!status && preset === "in_progress") statuses = ["in_progress"];

    return {
      skip: page * 50,
      limit: 50,
      status: statuses,
      projectId: projectId || undefined,
      goalId: goalId || undefined,
      dueBefore: preset === "overdue" ? new Date().toISOString() : undefined,
      search: deferredSearch || undefined,
      blocked: preset === "blocked" ? true : undefined,
      plan:
        preset === "today" || preset === "week" || preset === "unplanned"
          ? preset
          : undefined,
      sortBy: preset === "next" ? "priority" : "due_date",
    };
  }, [
    deferredSearch,
    goalId,
    page,
    preset,
    projectId,
    status,
  ]);

  const workspace = useTaskWorkspace(filters, Boolean(user));
  const recommendations = useTaskRecommendations(Boolean(user));
  const visibleTasks = workspace.data?.items ?? [];

  const filteredGoals = projectId
    ? goals.filter((goal) => goal.project_id === projectId)
    : goals;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-muted/20">
        <AppHeader currentPage="tasks" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        ログインしてください
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <AppHeader currentPage="tasks" />
      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ListTodo className="h-6 w-6" />
            タスクワークスペース
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            プロジェクト階層をまたいで、次に取り組むタスクを探して調整できます。
          </p>
        </div>

        {recommendations.data &&
          recommendations.data.length > 0 &&
          preset !== "inbox" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="h-5 w-5" />
                  次のおすすめ
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                {recommendations.data.map((recommendation) => (
                  <Link
                    key={recommendation.task.id}
                    href={`/runner?taskId=${encodeURIComponent(recommendation.task.id)}`}
                    className="rounded-lg border border-border p-3 transition-colors hover:bg-muted/60"
                  >
                    <div className="truncate font-medium">
                      {recommendation.task.title}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {recommendation.task.project_title} ›{" "}
                      {recommendation.task.goal_title}
                    </div>
                    <p className="mt-2 text-xs">{recommendation.reason}</p>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {PRESETS.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={preset === item.id ? "default" : "outline"}
              onClick={() => {
                setPreset(item.id);
                setPage(0);
              }}
            >
              {item.id === "inbox" && <Inbox className="mr-1 h-4 w-4" />}
              {item.label}
            </Button>
          ))}
        </div>

        {preset === "inbox" ? (
          <QuickTaskList
            key={inboxVersion}
            limit={100}
            onConvertToTask={(task) => {
              setConvertingTask(task);
              setConvertGoalId(goals[0]?.id ?? "");
            }}
          />
        ) : (
          <>
            <Card>
              <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="relative md:col-span-2">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(0);
                    }}
                    placeholder="タイトル・説明・メモを検索"
                    className="pl-9"
                  />
                </div>
                <select
                  aria-label="プロジェクトで絞り込み"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={projectId}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setGoalId("");
                    setPage(0);
                  }}
                >
                  <option value="">全プロジェクト</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="ゴールで絞り込み"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={goalId}
                  onChange={(event) => {
                    setGoalId(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">全ゴール</option>
                  {filteredGoals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="ステータスで絞り込み"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as TaskStatus | "");
                    setPage(0);
                  }}
                >
                  <option value="">全ステータス</option>
                  {Object.entries(taskStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <div className="hidden grid-cols-[minmax(260px,2fr)_140px_110px_150px_120px_minmax(210px,1fr)_110px] gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground xl:grid">
                <span>タスク</span>
                <span>ステータス</span>
                <span>優先度</span>
                <span>期限</span>
                <span>見積時間</span>
                <span>所属ゴール</span>
                <span>Runner</span>
              </div>
              {workspace.isLoading ? (
                <div className="p-12 text-center text-muted-foreground">
                  読み込み中...
                </div>
              ) : workspace.isError ? (
                <div className="p-12 text-center text-destructive">
                  タスクの取得に失敗しました
                </div>
              ) : visibleTasks.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  条件に一致するタスクはありません
                </div>
              ) : (
                visibleTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    goals={goals}
                    onOpen={() => setSelectedTask(task)}
                  />
                ))
              )}
            </Card>

            {(workspace.data?.total ?? 0) > 50 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {page * 50 + 1}–
                  {Math.min((page + 1) * 50, workspace.data?.total ?? 0)} /{" "}
                  {workspace.data?.total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    前へ
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * 50 >= (workspace.data?.total ?? 0)}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    次へ
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <Dialog
        open={Boolean(selectedTask)}
        onOpenChange={(open) => !open && setSelectedTask(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {selectedTask && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedTask.title}</DialogTitle>
                <DialogDescription>
                  {selectedTask.project_title} › {selectedTask.goal_title}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <p className="whitespace-pre-wrap">
                  {selectedTask.description || "説明はありません。"}
                </p>
                {selectedTask.memo && (
                  <div className="rounded-md bg-muted p-3 whitespace-pre-wrap">
                    {selectedTask.memo}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    残り見積 {selectedTask.remaining_estimate_hours}時間
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    最終作業{" "}
                    {selectedTask.last_worked_at
                      ? new Date(selectedTask.last_worked_at).toLocaleString(
                          "ja-JP",
                        )
                      : "なし"}
                  </div>
                </div>
                {selectedTask.is_blocked && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                    <span>
                      未完了の依存タスクが{" "}
                      {selectedTask.blocking_task_ids.length} 件あります。
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(convertingTask)}
        onOpenChange={(open) => !open && setConvertingTask(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inboxからタスクへ整理</DialogTitle>
            <DialogDescription>
              「{convertingTask?.title}」の所属ゴールを選択してください。
            </DialogDescription>
          </DialogHeader>
          <select
            aria-label="変換先ゴール"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={convertGoalId}
            onChange={(event) => setConvertGoalId(event.target.value)}
          >
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConvertingTask(null)}>
              キャンセル
            </Button>
            <Button
              disabled={!convertGoalId || isConverting}
              onClick={async () => {
                if (!convertingTask || !convertGoalId) return;
                setIsConverting(true);
                try {
                  await quickTasksApi.convertToTask(
                    convertingTask.id,
                    convertGoalId,
                  );
                  await queryClient.invalidateQueries({ queryKey: ["tasks"] });
                  setConvertingTask(null);
                  setInboxVersion((value) => value + 1);
                  toast({ title: "通常タスクへ移動しました" });
                } catch {
                  toast({
                    title: "タスクを変換できませんでした",
                    variant: "destructive",
                  });
                } finally {
                  setIsConverting(false);
                }
              }}
            >
              {isConverting ? "移動中..." : "移動"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
