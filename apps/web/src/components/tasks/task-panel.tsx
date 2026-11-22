// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ExternalLink, Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useGoal } from '@/hooks/use-goals-query'
import { useTask } from '@/hooks/use-tasks-query'
import { taskPagePath } from '@/lib/tasks/task-paths'
import type { Task, TaskWorkspaceItem } from '@/types/task'

// The detail brings the rich-text note editor with it, so it is loaded when a
// panel is first opened, not with every screen that can open one.
const TaskDetail = dynamic(
  () => import('@/components/tasks/task-detail').then((module) => module.TaskDetail),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
)

interface TaskPanelProps {
  /** The task to show; null keeps the panel closed. */
  taskId: string | null
  /** Tasks the edit dialog offers as dependencies. */
  availableTasks: Task[]
  onClose: () => void
  /** Show another task in the panel (a prerequisite or a dependent). */
  onSelectTask: (taskId: string) => void
}

/** True while the user types: Escape then belongs to the field, not the panel. */
function isTyping(event: KeyboardEvent): boolean {
  if (event.isComposing) return true
  const target = event.target
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [contenteditable="true"]') !== null)
  )
}

/**
 * The task as a side panel over the current screen: note, time records,
 * status and dependencies without leaving the list the user is working in.
 *
 * It is a modal dialog: focus moves into it and stays there, the page behind
 * does not scroll, and Escape or a click outside closes it. Dialogs opened
 * from the panel (edit, time record) stack on top of it. It is rendered under
 * <body>, so where it is mounted cannot move it.
 */
export function TaskPanel({ taskId, availableTasks, onClose, onSelectTask }: TaskPanelProps) {
  const taskQuery = useTask(taskId ?? '')
  const goalQuery = useGoal(taskQuery.data?.goal_id ?? '')
  if (!taskId) return null

  const task = taskQuery.data
  const workspaceTask = availableTasks.find(
    (item): item is TaskWorkspaceItem => item.id === taskId && 'project_id' in item,
  )
  const projectId = workspaceTask?.project_id ?? goalQuery.data?.project_id
  const pageHref = task && projectId ? taskPagePath(projectId, task.goal_id, task.id) : null

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l bg-background shadow-2xl focus:outline-none sm:w-[560px]"
          onEscapeKeyDown={(event) => {
            // While typing, Escape cancels an IME conversion or an editor
            // menu, and must not close the note being edited.
            if (isTyping(event)) event.preventDefault()
          }}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-5 py-3 backdrop-blur">
            <DialogPrimitive.Title className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span aria-hidden="true">Task</span>
              <span className="sr-only">タスク詳細</span>
            </DialogPrimitive.Title>
            <div className="flex items-center gap-1">
              {pageHref && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={pageHref}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    ページで開く
                  </Link>
                </Button>
              )}
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="閉じる">
                  <X className="h-5 w-5" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
          <TaskDetail
            taskId={taskId}
            availableTasks={availableTasks}
            variant="panel"
            onSelectTask={onSelectTask}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
