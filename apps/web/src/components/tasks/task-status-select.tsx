// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useUpdateTask } from '@/hooks/use-tasks-query'
import { log } from '@/lib/logger'
import { getStatusUpdateError } from '@/lib/status-error-handler'
import { taskStatusColors, taskStatusLabels } from '@/types/task'
import type { Task, TaskStatus } from '@/types/task'

/** Changes a task's status in place, wherever the task is shown. */
export function TaskStatusSelect({ task }: { task: Task }) {
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
        component: 'TaskStatusSelect',
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
      <SelectTrigger
        aria-label={`${task.title}のステータス`}
        className="h-8 w-auto min-w-[108px] px-2"
      >
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
