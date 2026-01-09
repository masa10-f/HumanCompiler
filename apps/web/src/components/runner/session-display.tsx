'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Target, FolderOpen } from 'lucide-react';
import type { WorkSession } from '@/types/work-session';
import type { Task } from '@/types/task';
import type { Goal } from '@/types/goal';
import type { Project } from '@/types/project';
import { cn } from '@/lib/utils';

interface SessionDisplayProps {
  session: WorkSession;
  task: Task;
  goal: Goal | null;
  project: Project | null;
  isOverdue: boolean;
}

export function SessionDisplay({
  session,
  task,
  goal,
  project,
  isOverdue,
}: SessionDisplayProps) {
  return (
    <Card
      className={cn(
        'transition-colors',
        isOverdue && 'border-red-500 dark:border-red-400'
      )}
    >
      <CardContent className="pt-6 space-y-3">
        {/* Task title */}
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {task.title}
          </h2>
          {task.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {task.description}
            </p>
          )}
        </div>

        {/* Goal and Project */}
        <div className="flex flex-wrap gap-2">
          {goal && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              {goal.title}
            </Badge>
          )}
          {project && (
            <Badge variant="outline" className="flex items-center gap-1">
              <FolderOpen className="h-3 w-3" />
              {project.title}
            </Badge>
          )}
        </div>

        {/* Planned outcome if set */}
        {session.planned_outcome && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-1">今回の目標</p>
            <p className="text-sm">{session.planned_outcome}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
