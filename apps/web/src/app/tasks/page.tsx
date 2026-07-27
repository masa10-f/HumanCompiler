"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ListTodo,
  Network,
  Play,
  Rows3,
  Search,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { QuickTaskList } from "@/components/quick-tasks";
import { TaskDependencyMap } from "@/components/tasks/task-dependency-map";
import { TaskDependencyPanel } from "@/components/tasks/task-dependency-panel";
import { TaskBulkToolbar } from "@/components/tasks/task-bulk-toolbar";
import { TaskPickerDialog } from "@/components/runner/task-picker-dialog";
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
  useTaskDependencyGraph,
  useTaskWorkspace,
  useTaskWorkspaceSummary,
  useUpdateTask,
} from "@/hooks/use-tasks-query";
import { quickTasksApi } from "@/lib/api";
import { useProjectOptions } from "@/hooks/use-project-query";
import { useGoalsByProjects } from "@/hooks/use-goals-query";
import {
  buildTaskWorkspaceFilters,
  DEFAULT_TASK_WORKSPACE_PRESET,
  type TaskWorkspacePreset,
} from "@/lib/tasks/workspace-filters";
import type { QuickTask } from "@/types/quick-task";
import type {
  TaskStatus,
  TaskWorkspaceFilters,
  TaskWorkspaceItem,
} from "@/types/task";
import { taskStatusLabels } from "@/types/task";

type Preset = TaskWorkspacePreset;

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "ready", label: "Ready" },
  { id: "today", label: "今日" },
  { id: "week", label: "今週" },
  { id: "in_progress", label: "作業中" },
  { id: "overdue", label: "期限切れ" },
  { id: "blocked", label: "ブロック中" },
  { id: "unplanned", label: "未計画" },
  { id: "inbox", label: "Inbox" },
  { id: "all", label: "全タスク" },
];

function TaskRow({
  task,
  onOpen,
  selected,
  onToggle,
}: {
  task: TaskWorkspaceItem;
  onOpen: () => void;
  selected: boolean;
  onToggle: () => void;
}) {
  const updateTask = useUpdateTask();
  const [dependenciesOpen, setDependenciesOpen] = useState(false);
  const dependencies = task.dependencies ?? [];
  const completedDependencies = dependencies.filter(
    (dependency) => dependency.depends_on_task?.status === "completed",
  ).length;
  const blockingDependencies = dependencies.filter(
    (dependency) => dependency.depends_on_task?.status !== "completed",
  );
  const canStart =
    !task.is_blocked &&
    task.status !== "completed" &&
    task.status !== "cancelled";

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
    <div className="border-b border-border last:border-b-0">
      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[36px_100px_minmax(240px,2fr)_minmax(180px,1fr)_120px_100px_80px_70px_170px] lg:items-center">
        <input
          type="checkbox"
          aria-label={`${task.title}を選択`}
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4"
        />
        <div>
          {task.status === "completed" ? (
            <Badge variant="success">完了</Badge>
          ) : task.status === "cancelled" ? (
            <Badge variant="secondary">キャンセル</Badge>
          ) : task.is_blocked ? (
            <Badge variant="warning">ブロック中</Badge>
          ) : (
            <Badge variant="info">Ready</Badge>
          )}
        </div>

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
            {task.planned_today && (
              <Badge variant="info">
                {task.planned_today_unplaced ? "今日・未配置" : "今日"}
              </Badge>
            )}
            {!task.planned_today && task.planned_this_week && (
              <Badge variant="secondary">今週</Badge>
            )}
          </div>
        </div>

        <div className="text-sm">
          {dependencies.length === 0 ? (
            <span className="text-muted-foreground">依存なし</span>
          ) : (
            <button
              className="flex items-center gap-1 rounded px-1 py-1 text-left hover:bg-muted"
              aria-expanded={dependenciesOpen}
              onClick={() => setDependenciesOpen((value) => !value)}
            >
              <span>
                {completedDependencies}/{dependencies.length} 完了
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${dependenciesOpen ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>

        <label className="text-xs text-muted-foreground">
          <span className="mb-1 block lg:hidden">ステータス</span>
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

        <div className="text-sm">
          <span className="mr-2 text-xs text-muted-foreground lg:hidden">
            期限
          </span>
          {task.due_date
            ? new Date(task.due_date).toLocaleDateString("ja-JP", {
                month: "numeric",
                day: "numeric",
              })
            : "—"}
        </div>
        <div className="text-sm">
          <span className="mr-2 text-xs text-muted-foreground lg:hidden">
            残り
          </span>
          {task.remaining_estimate_hours}h
        </div>
        <div className="text-sm">
          <span className="mr-2 text-xs text-muted-foreground lg:hidden">
            優先度
          </span>
          P{task.priority}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onOpen}>
            詳細
          </Button>
          {canStart ? (
            <Button size="sm" asChild>
              <Link href={`/runner?taskId=${encodeURIComponent(task.id)}`}>
                <Play className="mr-1 h-4 w-4" />
                開始
              </Link>
            </Button>
          ) : (
            <Button size="sm" disabled>
              <Play className="mr-1 h-4 w-4" />
              開始
            </Button>
          )}
        </div>
      </div>

      {dependenciesOpen && dependencies.length > 0 && (
        <div className="border-t bg-muted/30 px-4 py-3 lg:pl-[372px]">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            先に完了すべきタスク
          </div>
          <div className="flex flex-wrap gap-2">
            {dependencies.map((dependency) => (
              <button
                key={dependency.id}
                className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs hover:border-primary"
                onClick={onOpen}
              >
                {dependency.depends_on_task?.status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                )}
                {dependency.depends_on_task?.title ?? "不明なタスク"}
                {dependency.depends_on_task?.status === "cancelled" && (
                  <span className="text-destructive">要確認</span>
                )}
              </button>
            ))}
          </div>
          {blockingDependencies.length > 0 && (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              未完了の依存タスクが {blockingDependencies.length} 件あります。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<Preset>(DEFAULT_TASK_WORKSPACE_PRESET);
  const [view, setView] = useState<"list" | "graph">("list");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [projectId, setProjectId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [page, setPage] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [convertingTask, setConvertingTask] = useState<QuickTask | null>(null);
  const [convertGoalId, setConvertGoalId] = useState("");
  const [inboxVersion, setInboxVersion] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);

  const { data: projects = [] } = useProjectOptions({
    enabled: Boolean(user),
  });
  const { data: goals } = useGoalsByProjects(
    projects.map((project) => project.id),
    {
      enabled: projects.length > 0,
      limit: 100,
    },
  );

  const filters = useMemo<TaskWorkspaceFilters>(() => {
    return buildTaskWorkspaceFilters({
      preset,
      page,
      status,
      projectId,
      goalId,
      search: deferredSearch,
    });
  }, [deferredSearch, goalId, page, preset, projectId, status]);

  const workspace = useTaskWorkspace(filters, Boolean(user));
  const recommendations = useTaskRecommendations(Boolean(user));
  const summaryFilters = useMemo(
    () => ({
      projectId: projectId || undefined,
      goalId: goalId || undefined,
      search: deferredSearch || undefined,
    }),
    [deferredSearch, goalId, projectId],
  );
  const summary = useTaskWorkspaceSummary(summaryFilters, Boolean(user));
  const dependencyGraph = useTaskDependencyGraph(
    {
      ...filters,
      skip: undefined,
      limit: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    },
    Boolean(user) && view === "graph" && preset !== "inbox",
  );
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <ListTodo className="h-6 w-6" />
              タスクワークスペース
            </h1>
            <Button variant="outline" onClick={() => setTaskPickerOpen(true)}>
              <Play className="mr-2 h-4 w-4" />
              タスクを選んでRunnerへ
            </Button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            プロジェクト階層をまたいで、次に取り組むタスクを探して調整できます。
          </p>
        </div>

        <TaskBulkToolbar
          selectedTaskIds={[...selectedTaskIds]}
          goals={goals}
          onClear={() => setSelectedTaskIds(new Set())}
          onApplied={() => setPage(0)}
        />

        <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch xl:justify-between">
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              {
                id: "ready" as Preset,
                label: "Ready",
                value: summary.data?.ready ?? 0,
                tone: "text-blue-600",
              },
              {
                id: "blocked" as Preset,
                label: "ブロック",
                value: summary.data?.blocked ?? 0,
                tone: "text-amber-600",
              },
              {
                id: "in_progress" as Preset,
                label: "作業中",
                value: summary.data?.in_progress ?? 0,
                tone: "text-violet-600",
              },
              {
                id: "overdue" as Preset,
                label: "期限切れ",
                value: summary.data?.overdue ?? 0,
                tone: "text-red-600",
              },
              {
                id: "all" as Preset,
                label: "全タスク",
                value: summary.data?.total ?? 0,
                tone: "text-foreground",
              },
            ].map((item) => (
              <button
                key={item.id}
                className={`rounded-lg border bg-card px-3 py-3 text-left transition-colors hover:border-primary/60 ${preset === item.id ? "border-primary ring-1 ring-primary/30" : ""}`}
                onClick={() => {
                  setPreset(item.id);
                  setPage(0);
                }}
              >
                <div className="text-xs text-muted-foreground">
                  {item.label}
                </div>
                <div className={`mt-1 text-xl font-semibold ${item.tone}`}>
                  {summary.isLoading ? "—" : item.value}
                </div>
              </button>
            ))}
          </div>
          <div className="flex self-start rounded-lg border bg-card p-1">
            <Button
              size="sm"
              variant={view === "list" ? "secondary" : "ghost"}
              onClick={() => setView("list")}
            >
              <Rows3 className="mr-2 h-4 w-4" />
              一覧
            </Button>
            <Button
              size="sm"
              variant={view === "graph" ? "secondary" : "ghost"}
              onClick={() => setView("graph")}
            >
              <Network className="mr-2 h-4 w-4" />
              依存マップ
            </Button>
          </div>
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

            {view === "list" ? (
              <Card className="overflow-hidden">
                <div className="sticky top-0 z-10 hidden grid-cols-[36px_100px_minmax(240px,2fr)_minmax(180px,1fr)_120px_100px_80px_70px_170px] gap-3 border-b bg-muted/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur lg:grid">
                  <input
                    type="checkbox"
                    aria-label="表示中のタスクをすべて選択"
                    checked={visibleTasks.length > 0 && visibleTasks.every((task) => selectedTaskIds.has(task.id))}
                    onChange={(event) => {
                      setSelectedTaskIds((current) => {
                        const next = new Set(current);
                        visibleTasks.forEach((task) => {
                          if (event.target.checked && next.size < 100) next.add(task.id);
                          if (!event.target.checked) next.delete(task.id);
                        });
                        return next;
                      });
                    }}
                  />
                  <span>実行状態</span>
                  <span>タスク</span>
                  <span>依存状況</span>
                  <span>ステータス</span>
                  <span>期限</span>
                  <span>残り</span>
                  <span>優先度</span>
                  <span>操作</span>
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
                      onOpen={() => setSelectedTaskId(task.id)}
                      selected={selectedTaskIds.has(task.id)}
                      onToggle={() => {
                        setSelectedTaskIds((current) => {
                          const next = new Set(current);
                          if (next.has(task.id)) next.delete(task.id);
                          else if (next.size < 100) next.add(task.id);
                          else toast({ title: "一度に選択できるのは100件までです", variant: "destructive" });
                          return next;
                        });
                      }}
                    />
                  ))
                )}
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <TaskDependencyMap
                  graph={dependencyGraph.data}
                  isLoading={dependencyGraph.isLoading}
                  isError={dependencyGraph.isError}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={(node) => setSelectedTaskId(node.id)}
                />
              </Card>
            )}

            {view === "list" && (workspace.data?.total ?? 0) > 50 && (
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

      <TaskDependencyPanel
        taskId={selectedTaskId}
        availableTasks={visibleTasks}
        onClose={() => setSelectedTaskId(null)}
        onSelectTask={setSelectedTaskId}
      />

      <TaskPickerDialog
        open={taskPickerOpen}
        onOpenChange={setTaskPickerOpen}
        onSelect={(task) => router.push(`/runner?taskId=${encodeURIComponent(task.id)}`)}
      />

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
