'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, Flag, Calendar } from 'lucide-react';
import type { TaskStatus, WorkType } from '@/types/task';
import {
  taskStatusLabels,
  taskStatusColors,
  workTypeLabels,
  workTypeColors,
  taskPriorityLabels,
  taskPriorityColors,
} from '@/types/task';

export interface TaskCardProps {
  taskId: string;
  title: string;
  status: TaskStatus;
  workType: WorkType;
  projectId: string;
  goalId: string;
  estimateHours?: number;
  priority?: number;
  dueDate?: string;
}

export function TaskCard({
  taskId: _taskId,
  title,
  status,
  workType,
  projectId,
  goalId,
  estimateHours,
  priority,
  dueDate,
}: TaskCardProps) {
  void _taskId; // Reserved for future use (e.g., task detail page link)
  const linkHref = `/projects/${projectId}/goals/${goalId}`;

  return (
    <Card className="hover:bg-muted/50 transition-colors">
      <CardContent className="p-4 space-y-2">
        <Link
          href={linkHref}
          className="block font-medium text-sm hover:underline"
        >
          {title}
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={taskStatusColors[status]}>
            {taskStatusLabels[status]}
          </Badge>
          <Badge className={workTypeColors[workType]}>
            {workTypeLabels[workType]}
          </Badge>
        </div>

        {(estimateHours !== undefined || priority !== undefined || dueDate) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {estimateHours !== undefined && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {estimateHours}h
              </span>
            )}
            {priority !== undefined && (
              <Badge variant="outline" className={taskPriorityColors[priority]}>
                <Flag className="h-3 w-3 mr-1" />
                {taskPriorityLabels[priority]}
              </Badge>
            )}
            {dueDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(dueDate).toLocaleDateString('ja-JP')}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
