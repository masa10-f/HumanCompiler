'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Flag, Calendar, MoreVertical, Inbox } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { QuickTask } from '@/types/quick-task';
import {
  taskStatusLabels,
  taskStatusColors,
  workTypeLabels,
  workTypeColors,
  taskPriorityLabels,
  taskPriorityColors,
} from '@/types/task';

export interface QuickTaskCardProps {
  task: QuickTask;
  onEdit?: (task: QuickTask) => void;
  onDelete?: (task: QuickTask) => void;
  onConvert?: (task: QuickTask) => void;
}

export function QuickTaskCard({
  task,
  onEdit,
  onDelete,
  onConvert,
}: QuickTaskCardProps) {
  const hasBadges = task.status || task.work_type;
  const hasMetadata = task.estimate_hours !== undefined || task.priority !== undefined || task.due_date;

  return (
    <Card className="hover:bg-muted/50 transition-colors">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Inbox className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm truncate">{task.title}</span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(task)}>
                  編集
                </DropdownMenuItem>
              )}
              {onConvert && (
                <DropdownMenuItem onClick={() => onConvert(task)}>
                  プロジェクトに移動
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(task)}
                  className="text-destructive"
                >
                  削除
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {task.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {task.description}
          </p>
        )}

        {hasBadges && (
          <div className="flex flex-wrap items-center gap-2">
            {task.status && (
              <Badge className={taskStatusColors[task.status]}>
                {taskStatusLabels[task.status]}
              </Badge>
            )}
            {task.work_type && (
              <Badge className={workTypeColors[task.work_type]}>
                {workTypeLabels[task.work_type]}
              </Badge>
            )}
          </div>
        )}

        {hasMetadata && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {task.estimate_hours !== undefined && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {task.estimate_hours}h
              </span>
            )}
            {task.priority !== undefined && (
              <Badge variant="outline" className={taskPriorityColors[task.priority]}>
                <Flag className="h-3 w-3 mr-1" />
                {taskPriorityLabels[task.priority]}
              </Badge>
            )}
            {task.due_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(task.due_date).toLocaleDateString('ja-JP')}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
