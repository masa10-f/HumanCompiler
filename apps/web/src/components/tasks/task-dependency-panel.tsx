// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Pencil,
  Play,
  X,
} from "lucide-react";

import { TaskEditDialog } from "@/components/tasks/task-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGoal } from "@/hooks/use-goals-query";
import { useTask, useTaskDependencyContext } from "@/hooks/use-tasks-query";
import type {
  Task,
  TaskDependencyContextTask,
  TaskWorkspaceItem,
} from "@/types/task";
import { taskStatusLabels } from "@/types/task";

interface TaskDependencyPanelProps {
  taskId: string | null;
  availableTasks: Task[];
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}

function DependencyItem({
  item,
  onSelect,
}: {
  item: TaskDependencyContextTask;
  onSelect: () => void;
}) {
  return (
    <button
      className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
        <Badge
          variant={
            item.status === "completed"
              ? "success"
              : item.status === "cancelled"
                ? "destructive"
                : item.is_blocked
                  ? "warning"
                  : "outline"
          }
        >
          {item.status === "cancelled"
            ? "要確認"
            : taskStatusLabels[item.status]}
        </Badge>
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {item.project_title} › {item.goal_title}
      </div>
    </button>
  );
}

export function TaskDependencyPanel({
  taskId,
  availableTasks,
  onClose,
  onSelectTask,
}: TaskDependencyPanelProps) {
  const taskQuery = useTask(taskId ?? "");
  const contextQuery = useTaskDependencyContext(taskId ?? undefined);
  const goalQuery = useGoal(taskQuery.data?.goal_id ?? "");
  if (!taskId) return null;

  const task = taskQuery.data;
  const context = contextQuery.data;
  const workspaceTask = availableTasks.find(
    (item): item is TaskWorkspaceItem =>
      item.id === taskId && "project_id" in item,
  );
  const projectId = workspaceTask?.project_id ?? goalQuery.data?.project_id;
  const taskDetailHref =
    task && projectId
      ? `/projects/${projectId}/goals/${task.goal_id}/tasks/${task.id}`
      : null;
  const hasCancelledPrerequisite = context?.prerequisites.some(
    (item) => item.status === "cancelled",
  );
  const canStart =
    Boolean(context) &&
    (task?.status === "pending" || task?.status === "in_progress") &&
    context?.prerequisites.every((item) => item.status === "completed");

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        aria-label="詳細パネルを閉じる"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      <aside
        aria-label="タスク詳細"
        className="absolute inset-y-0 right-0 w-full overflow-y-auto border-l bg-background shadow-2xl sm:w-[460px]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-5 py-4 backdrop-blur">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Task details
            </div>
            <div className="text-sm font-medium">依存関係と実行情報</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="閉じる"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {taskQuery.isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !task ? (
          <div className="p-6 text-sm text-destructive">
            タスクを読み込めませんでした。
          </div>
        ) : (
          <div className="space-y-6 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={task.status === "completed" ? "success" : "outline"}
                >
                  {taskStatusLabels[task.status]}
                </Badge>
                {context?.prerequisites.every(
                  (item) => item.status === "completed",
                ) &&
                  (task.status === "pending" ||
                    task.status === "in_progress") && (
                    <Badge variant="info">Ready</Badge>
                  )}
              </div>
              <h2 className="mt-3 text-xl font-semibold">{task.title}</h2>
              {task.description && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {task.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {task.estimate_hours}時間
                </span>
                <span>優先度 {task.priority}</span>
                {task.due_date && (
                  <span>
                    期限 {new Date(task.due_date).toLocaleDateString("ja-JP")}
                  </span>
                )}
              </div>
            </div>

            {hasCancelledPrerequisite && (
              <div className="flex gap-2 rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                キャンセルされた前提タスクがあります。依存関係を見直すまで、このタスクはブロックされます。
              </div>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ArrowLeft className="h-4 w-4" />
                先に必要なタスク
              </h3>
              {contextQuery.isLoading ? (
                <div className="text-sm text-muted-foreground">
                  読み込み中...
                </div>
              ) : context?.prerequisites.length ? (
                <div className="space-y-2">
                  {context.prerequisites.map((item) => (
                    <DependencyItem
                      key={item.id}
                      item={item}
                      onSelect={() => onSelectTask(item.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  前提タスクはありません
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ArrowRight className="h-4 w-4" />
                このタスクを待っているタスク
              </h3>
              {context?.dependents.length ? (
                <div className="space-y-2">
                  {context.dependents.map((item) => (
                    <DependencyItem
                      key={item.id}
                      item={item}
                      onSelect={() => onSelectTask(item.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  後続タスクはありません
                </div>
              )}
            </section>

            <div className="grid gap-2 border-t pt-5 sm:grid-cols-2">
              {canStart ? (
                <Button asChild>
                  <Link href={`/runner?taskId=${encodeURIComponent(task.id)}`}>
                    <Play className="mr-2 h-4 w-4" />
                    Runnerで開始
                  </Link>
                </Button>
              ) : (
                <Button disabled>
                  <Play className="mr-2 h-4 w-4" />
                  Runnerで開始
                </Button>
              )}
              <TaskEditDialog task={task} availableTasks={availableTasks}>
                <Button variant="outline">
                  <Pencil className="mr-2 h-4 w-4" />
                  編集・依存設定
                </Button>
              </TaskEditDialog>
              {taskDetailHref ? (
                <Button variant="ghost" className="sm:col-span-2" asChild>
                  <Link href={taskDetailHref}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    タスク詳細ページを開く
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="sm:col-span-2"
                  disabled
                >
                  {goalQuery.isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="mr-2 h-4 w-4" />
                  )}
                  タスク詳細ページを開く
                </Button>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
