// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  History,
  Loader2,
  Pencil,
  Play,
  Sparkles,
  Timer,
} from 'lucide-react'

import { GoalTaskAssistantDialog } from '@/components/ai/goal-task-assistant-dialog'
import { LogFormDialog } from '@/components/logs/log-form-dialog'
import { ContextNotePanel } from '@/components/notes/context-note-panel'
import { NoteConflictAlert } from '@/components/notes/note-conflict-alert'
import { CopyTaskNoteButton } from '@/components/tasks/copy-task-note-button'
import { TaskEditDialog } from '@/components/tasks/task-edit-dialog'
import { TaskStatusSelect } from '@/components/tasks/task-status-select'
import { TaskWorkHistory } from '@/components/tasks/task-work-history'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useGoal } from '@/hooks/use-goals-query'
import { useTaskActualMinutes } from '@/hooks/use-logs-query'
import { useTaskNote } from '@/hooks/use-notes'
import { useTask, useTaskDependencyContext } from '@/hooks/use-tasks-query'
import { taskPagePath } from '@/lib/tasks/task-paths'
import { cn } from '@/lib/utils'
import { taskPriorityLabels, taskStatusLabels, workTypeLabels } from '@/types/task'
import type { Task, TaskDependencyContextTask } from '@/types/task'

interface TaskDetailProps {
  taskId: string
  /** Tasks the edit dialog offers as dependencies. */
  availableTasks?: Task[]
  /** 'panel' is the side drawer; 'page' is the full task page. */
  variant?: 'panel' | 'page'
  /**
   * Called when a prerequisite or dependent task is chosen. Without it the
   * task opens on its own page.
   */
  onSelectTask?: (taskId: string) => void
}

function SectionTitle({
  icon: Icon,
  children,
  className = 'mb-2',
}: {
  icon: typeof Clock
  children: React.ReactNode
  className?: string
}) {
  return (
    <h3 className={cn('flex items-center gap-2 text-sm font-semibold', className)}>
      <Icon className="h-4 w-4" />
      {children}
    </h3>
  )
}

function DependencyItem({
  item,
  onSelect,
}: {
  item: TaskDependencyContextTask
  onSelect?: () => void
}) {
  const className =
    'block w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
        <Badge
          variant={
            item.status === 'completed'
              ? 'success'
              : item.status === 'cancelled'
                ? 'destructive'
                : item.is_blocked
                  ? 'warning'
                  : 'outline'
          }
        >
          {item.status === 'cancelled' ? '要確認' : taskStatusLabels[item.status]}
        </Badge>
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {item.project_title} › {item.goal_title}
      </div>
    </>
  )
  if (onSelect) {
    return (
      <button type="button" className={className} onClick={onSelect}>
        {content}
      </button>
    )
  }
  return (
    <Link href={taskPagePath(item.project_id, item.goal_id, item.id)} className={className}>
      {content}
    </Link>
  )
}

/** The task's note: its body, edited in place. */
function TaskNote({ taskId, variant }: { taskId: string; variant: 'panel' | 'page' }) {
  const { note, loading, saving, conflict, updateNote, reloadLatest, overwrite, flush } =
    useTaskNote(taskId)

  const heading = (
    <div className="mb-2 flex items-center justify-between gap-2">
      <SectionTitle icon={FileText} className="">
        ノート
      </SectionTitle>
      {!loading && <CopyTaskNoteButton taskId={taskId} beforeCopy={flush} />}
    </div>
  )
  if (loading) {
    return (
      <>
        {heading}
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </>
    )
  }
  return (
    <>
      {heading}
      <NoteConflictAlert
        sticky={variant === 'page'}
        conflict={conflict}
        saving={saving}
        onReload={reloadLatest}
        onOverwrite={overwrite}
      />
      <ContextNotePanel
        content={note?.content ?? ''}
        onUpdate={(content) => updateNote({ content, content_type: 'html' })}
        saving={saving}
        placeholder="作業に必要なメモや、AIに渡す依頼文などを書く..."
        updatedAt={note?.updated_at}
        variant={variant === 'page' ? 'full' : 'compact'}
        emptyTitle="ノートはまだありません"
        emptyDescription="作業メモや依頼文をここに書けます。"
      />
    </>
  )
}

/**
 * Everything about one task in one place: its state and actions, its note,
 * its work records and its dependencies. The side panel and the task page
 * both show this, so a task reads the same wherever it is opened.
 */
export function TaskDetail({
  taskId,
  availableTasks = [],
  variant = 'panel',
  onSelectTask,
}: TaskDetailProps) {
  const taskQuery = useTask(taskId)
  const contextQuery = useTaskDependencyContext(taskId)
  const goalQuery = useGoal(taskQuery.data?.goal_id ?? '')
  const { totalHours } = useTaskActualMinutes(taskId)

  if (taskQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  const task = taskQuery.data
  if (!task) {
    return <div className="p-6 text-sm text-destructive">タスクを読み込めませんでした。</div>
  }

  const context = contextQuery.data
  const projectId = goalQuery.data?.project_id
  const isOpen = task.status === 'pending' || task.status === 'in_progress'
  const prerequisitesDone =
    context?.prerequisites.every((item) => item.status === 'completed') ?? false
  const canStart = isOpen && prerequisitesDone
  const hasCancelledPrerequisite = context?.prerequisites.some(
    (item) => item.status === 'cancelled',
  )
  const isPage = variant === 'page'
  // Without the dependencies it is unknown whether the task may start, so the
  // Runner button stays off; say why, in place of "no dependencies".
  const dependencyError = (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      依存関係を読み込めませんでした。
    </div>
  )

  return (
    <div className={cn('space-y-6', !isPage && 'p-5')}>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusSelect task={task} />
          {canStart && <Badge variant="info">Ready</Badge>}
          {isOpen && context && !prerequisitesDone && (
            <Badge variant="warning">ブロック中</Badge>
          )}
          {isOpen && Boolean(contextQuery.error) && (
            <Badge variant="destructive">依存関係を確認できません</Badge>
          )}
        </div>
        {isPage ? (
          <h1 className="mt-3 text-2xl font-bold">{task.title}</h1>
        ) : (
          <h2 className="mt-3 text-xl font-semibold">{task.title}</h2>
        )}
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            <dt className="sr-only">実績 / 見積</dt>
            <dd>
              実績 {totalHours.toFixed(1)}h / 見積 {task.estimate_hours}h
            </dd>
          </div>
          <div>
            <dt className="sr-only">優先度</dt>
            <dd>優先度 {taskPriorityLabels[task.priority ?? 3] ?? task.priority}</dd>
          </div>
          {task.work_type && (
            <div>
              <dt className="sr-only">種別</dt>
              <dd>{workTypeLabels[task.work_type]}</dd>
            </div>
          )}
          {task.due_date && (
            <div>
              <dt className="sr-only">期限</dt>
              <dd>期限 {new Date(task.due_date).toLocaleDateString('ja-JP')}</dd>
            </div>
          )}
        </dl>
      </header>

      <div className="flex flex-wrap gap-2">
        {canStart ? (
          <Button size="sm" asChild>
            <Link href={`/runner?taskId=${encodeURIComponent(task.id)}`}>
              <Play className="mr-2 h-4 w-4" />
              Runnerで開始
            </Link>
          </Button>
        ) : (
          <Button size="sm" disabled>
            <Play className="mr-2 h-4 w-4" />
            Runnerで開始
          </Button>
        )}
        <LogFormDialog
          taskId={task.id}
          taskTitle={task.title}
          trigger={
            <Button size="sm" variant="outline">
              <Timer className="mr-2 h-4 w-4" />
              時間記録
            </Button>
          }
        />
        <TaskEditDialog task={task} availableTasks={availableTasks}>
          <Button size="sm" variant="outline">
            <Pencil className="mr-2 h-4 w-4" />
            編集・依存設定
          </Button>
        </TaskEditDialog>
        {projectId && (
          <GoalTaskAssistantDialog
            projectId={projectId}
            goalId={task.goal_id}
            taskId={task.id}
            mode="split_task"
            title="AIでタスク分割"
            defaultMessage="このタスクのノートをもとに、実行しやすい小さなタスクへ分割してください。"
            onApplied={() => taskQuery.refetch()}
          >
            <Button size="sm" variant="outline">
              <Sparkles className="mr-2 h-4 w-4" />
              AIで分割
            </Button>
          </GoalTaskAssistantDialog>
        )}
      </div>

      {hasCancelledPrerequisite && (
        <div className="flex gap-2 rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          キャンセルされた前提タスクがあります。依存関係を見直すまで、このタスクはブロックされます。
        </div>
      )}

      <section aria-label="ノート">
        {/* Keyed by task so that another task never shows this one's pending edit. */}
        <TaskNote key={task.id} taskId={task.id} variant={variant} />
      </section>

      <section aria-label="作業記録">
        <SectionTitle icon={History}>作業記録</SectionTitle>
        <TaskWorkHistory taskId={task.id} />
      </section>

      <section aria-label="先に必要なタスク">
        <SectionTitle icon={ArrowLeft}>先に必要なタスク</SectionTitle>
        {contextQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">読み込み中...</div>
        ) : contextQuery.error ? (
          dependencyError
        ) : context?.prerequisites.length ? (
          <div className="space-y-2">
            {context.prerequisites.map((item) => (
              <DependencyItem
                key={item.id}
                item={item}
                onSelect={onSelectTask && (() => onSelectTask(item.id))}
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

      <section aria-label="このタスクを待っているタスク">
        <SectionTitle icon={ArrowRight}>このタスクを待っているタスク</SectionTitle>
        {contextQuery.error ? (
          dependencyError
        ) : context?.dependents.length ? (
          <div className="space-y-2">
            {context.dependents.map((item) => (
              <DependencyItem
                key={item.id}
                item={item}
                onSelect={onSelectTask && (() => onSelectTask(item.id))}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            後続タスクはありません
          </div>
        )}
      </section>
    </div>
  )
}
