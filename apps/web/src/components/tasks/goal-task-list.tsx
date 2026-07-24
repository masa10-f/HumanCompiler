// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  GitBranch,
  ListFilter,
} from 'lucide-react'

import { LogFormDialog } from '@/components/logs/log-form-dialog'
import { TaskDeleteDialog } from '@/components/tasks/task-delete-dialog'
import { TaskDependencyPanel } from '@/components/tasks/task-dependency-panel'
import { TaskEditDialog } from '@/components/tasks/task-edit-dialog'
import { TaskLogsMemoPanel } from '@/components/tasks/task-logs-memo-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useUpdateTask } from '@/hooks/use-tasks-query'
import { log } from '@/lib/logger'
import { getStatusUpdateError } from '@/lib/status-error-handler'
import { getTaskDecisionSummary, type TaskDecisionState } from '@/lib/tasks/task-decision'
import type { Log } from '@/types/log'
import {
  taskPriorityColors,
  taskPriorityLabels,
  taskStatusColors,
  taskStatusLabels,
  workTypeColors,
  workTypeLabels,
} from '@/types/task'
import type { Task, TaskStatus } from '@/types/task'

type TaskView = 'all' | TaskDecisionState

interface GoalTaskListProps {
  tasks: Task[]
  projectId: string
  goalId: string
  logsByTask: Record<string, Log[]>
  logsLoading: boolean
  logsError: Error | null
  actualMinutesByTask: Record<string, number>
}

const stateLabels: Record<TaskDecisionState, string> = {
  ready: 'Ready',
  blocked: 'ブロック中',
  completed: '完了',
  cancelled: 'キャンセル',
}

const stateVariants: Record<
  TaskDecisionState,
  'info' | 'warning' | 'success' | 'destructive'
> = {
  ready: 'info',
  blocked: 'warning',
  completed: 'success',
  cancelled: 'destructive',
}

function TaskDecisionBadge({ task }: { task: Task }) {
  const summary = getTaskDecisionSummary(task)
  return (
    <Badge variant={stateVariants[summary.state]}>
      {summary.state === 'ready' && <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
      {summary.state === 'blocked' && <AlertTriangle className="mr-1 h-3.5 w-3.5" />}
      {stateLabels[summary.state]}
    </Badge>
  )
}

function TaskStatusSelect({ task }: { task: Task }) {
  const updateTaskMutation = useUpdateTask()
  const { toast } = useToast()

  const handleStatusChange = async (newStatus: TaskStatus) => {
    try {
      await updateTaskMutation.mutateAsync({
        id: task.id,
        data: { status: newStatus },
      })
    } catch (error) {
      log.error('Failed to update task status', error, {
        component: 'GoalTaskList',
        taskId: task.id,
        newStatus,
      })
      const { title, message } = getStatusUpdateError(error as Error, 'task')
      toast({ title, description: message, variant: 'destructive' })
    }
  }

  return (
    <Select
      value={task.status}
      onValueChange={handleStatusChange}
      disabled={updateTaskMutation.isPending}
    >
      <SelectTrigger className="h-8 w-auto min-w-[108px] px-2">
        <SelectValue>
          <Badge className={taskStatusColors[task.status]}>
            {taskStatusLabels[task.status]}
          </Badge>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(taskStatusLabels).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            <Badge className={taskStatusColors[value as TaskStatus]}>{label}</Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function DependencyButton({
  task,
  onClick,
}: {
  task: Task
  onClick: () => void
}) {
  const summary = getTaskDecisionSummary(task)
  const progress = summary.dependencyTotal
    ? `${summary.completedDependencies}/${summary.dependencyTotal} 完了`
    : '依存なし'

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto justify-start gap-2 px-1 py-1 text-left"
      onClick={onClick}
    >
      <GitBranch className="h-4 w-4 shrink-0 text-blue-500" />
      <span>
        <span className="block text-sm font-medium">{progress}</span>
        {summary.hasCancelledDependency ? (
          <span className="block text-xs text-amber-700 dark:text-amber-300">
            依存関係の見直しが必要
          </span>
        ) : summary.blockingDependencies.length > 0 ? (
          <span className="block text-xs text-muted-foreground">
            未完了 {summary.blockingDependencies.length}件
          </span>
        ) : (
          <span className="block text-xs text-muted-foreground">詳細を見る</span>
        )}
      </span>
    </Button>
  )
}

function TaskActions({ task, tasks }: { task: Task; tasks: Task[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-1">
      <LogFormDialog
        taskId={task.id}
        taskTitle={task.title}
        trigger={
          <Button variant="outline" size="sm" className="w-full sm:w-auto">
            時間記録
          </Button>
        }
      />
      <TaskEditDialog task={task} availableTasks={tasks}>
        <Button variant="outline" size="sm" className="w-full sm:w-auto">編集</Button>
      </TaskEditDialog>
      <TaskDeleteDialog task={task}>
        <Button variant="outline" size="sm" className="w-full sm:w-auto">削除</Button>
      </TaskDeleteDialog>
    </div>
  )
}

export function GoalTaskList({
  tasks,
  projectId,
  goalId,
  logsByTask,
  logsLoading,
  logsError,
  actualMinutesByTask,
}: GoalTaskListProps) {
  const [view, setView] = useState<TaskView>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const summaries = useMemo(
    () => new Map(tasks.map((task) => [task.id, getTaskDecisionSummary(task)])),
    [tasks],
  )
  const counts = useMemo(
    () => ({
      all: tasks.length,
      ready: tasks.filter((task) => summaries.get(task.id)?.state === 'ready').length,
      blocked: tasks.filter((task) => summaries.get(task.id)?.state === 'blocked').length,
      completed: tasks.filter((task) => summaries.get(task.id)?.state === 'completed').length,
      cancelled: tasks.filter((task) => summaries.get(task.id)?.state === 'cancelled').length,
    }),
    [summaries, tasks],
  )
  const visibleTasks = useMemo(
    () =>
      view === 'all'
        ? tasks
        : tasks.filter((task) => summaries.get(task.id)?.state === view),
    [summaries, tasks, view],
  )
  const views: { value: TaskView; label: string; count: number }[] = [
    { value: 'all', label: 'すべて', count: counts.all },
    { value: 'ready', label: 'Ready', count: counts.ready },
    { value: 'blocked', label: 'ブロック中', count: counts.blocked },
    { value: 'completed', label: '完了', count: counts.completed },
    { value: 'cancelled', label: 'キャンセル', count: counts.cancelled },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <span className="mr-1 flex items-center gap-1 text-sm font-medium text-muted-foreground">
          <ListFilter className="h-4 w-4" />
          表示
        </span>
        {views.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={view === item.value}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              view === item.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-muted'
            }`}
            onClick={() => setView(item.value)}
          >
            {item.label} {item.count}
          </button>
        ))}
      </div>

      {visibleTasks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            この条件に一致するタスクはありません。
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="hidden lg:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>実行状態</TableHead>
                    <TableHead>タスク</TableHead>
                    <TableHead>依存状況</TableHead>
                    <TableHead>ステータス</TableHead>
                    <TableHead>実績 / 見積</TableHead>
                    <TableHead>期限</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTasks.map((task) => (
                    <TaskDesktopRows
                      key={task.id}
                      task={task}
                      tasks={tasks}
                      projectId={projectId}
                      goalId={goalId}
                      logs={logsByTask[task.id] ?? []}
                      logsLoading={logsLoading}
                      logsError={logsError}
                      actualMinutes={actualMinutesByTask[task.id] ?? 0}
                      onOpenDependencies={() => setSelectedTaskId(task.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:hidden">
            {visibleTasks.map((task) => (
              <TaskMobileCard
                key={task.id}
                task={task}
                tasks={tasks}
                projectId={projectId}
                goalId={goalId}
                logs={logsByTask[task.id] ?? []}
                logsLoading={logsLoading}
                logsError={logsError}
                actualMinutes={actualMinutesByTask[task.id] ?? 0}
                onOpenDependencies={() => setSelectedTaskId(task.id)}
              />
            ))}
          </div>
        </>
      )}

      <TaskDependencyPanel
        taskId={selectedTaskId}
        availableTasks={tasks}
        onClose={() => setSelectedTaskId(null)}
        onSelectTask={setSelectedTaskId}
      />
    </>
  )
}

interface TaskDisplayProps {
  task: Task
  tasks: Task[]
  projectId: string
  goalId: string
  logs: Log[]
  logsLoading: boolean
  logsError: Error | null
  actualMinutes: number
  onOpenDependencies: () => void
}

function TaskDesktopRows({
  task,
  tasks,
  projectId,
  goalId,
  logs,
  logsLoading,
  logsError,
  actualMinutes,
  onOpenDependencies,
}: TaskDisplayProps) {
  return (
    <>
      <TableRow>
        <TableCell><TaskDecisionBadge task={task} /></TableCell>
        <TableCell className="max-w-[340px]">
          <Link
            href={`/projects/${projectId}/goals/${goalId}/tasks/${task.id}`}
            className="font-medium hover:text-blue-600 hover:underline"
          >
            {task.title}
          </Link>
          {task.description && (
            <div className="mt-1 line-clamp-1 text-sm text-muted-foreground">
              {task.description}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge className={workTypeColors[task.work_type ?? 'light_work']}>
              {workTypeLabels[task.work_type ?? 'light_work']}
            </Badge>
            <Badge className={taskPriorityColors[task.priority ?? 3]}>
              {taskPriorityLabels[task.priority ?? 3]}
            </Badge>
          </div>
        </TableCell>
        <TableCell><DependencyButton task={task} onClick={onOpenDependencies} /></TableCell>
        <TableCell><TaskStatusSelect task={task} /></TableCell>
        <TableCell>
          <div className="flex items-center gap-1 text-sm">
            <Clock className="h-3.5 w-3.5 text-green-600" />
            {(actualMinutes / 60).toFixed(1)}h / {task.estimate_hours}h
          </div>
        </TableCell>
        <TableCell>
          {task.due_date ? (
            <div className="flex items-center gap-1 text-sm">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(task.due_date).toLocaleDateString('ja-JP')}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">未設定</span>
          )}
        </TableCell>
        <TableCell><TaskActions task={task} tasks={tasks} /></TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} className="p-0">
          <TaskLogsMemoPanel
            task={task}
            logs={logs}
            logsLoading={logsLoading}
            logsError={logsError}
          />
        </TableCell>
      </TableRow>
    </>
  )
}

function TaskMobileCard({
  task,
  tasks,
  projectId,
  goalId,
  logs,
  logsLoading,
  logsError,
  actualMinutes,
  onOpenDependencies,
}: TaskDisplayProps) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:justify-between">
          <div className="min-w-0 flex-1">
            <TaskDecisionBadge task={task} />
            <Link
              href={`/projects/${projectId}/goals/${goalId}/tasks/${task.id}`}
              className="mt-2 block font-semibold hover:text-blue-600 hover:underline"
            >
              {task.title}
            </Link>
            {task.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {task.description}
              </p>
            )}
          </div>
          <div className="shrink-0">
            <TaskStatusSelect task={task} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">実績 / 見積</div>
            <div className="mt-1 font-medium">
              {(actualMinutes / 60).toFixed(1)}h / {task.estimate_hours}h
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">期限</div>
            <div className="mt-1 font-medium">
              {task.due_date
                ? new Date(task.due_date).toLocaleDateString('ja-JP')
                : '未設定'}
            </div>
          </div>
        </div>

        <DependencyButton task={task} onClick={onOpenDependencies} />
        <TaskActions task={task} tasks={tasks} />
        <TaskLogsMemoPanel
          task={task}
          logs={logs}
          logsLoading={logsLoading}
          logsError={logsError}
        />
      </CardContent>
    </Card>
  )
}
