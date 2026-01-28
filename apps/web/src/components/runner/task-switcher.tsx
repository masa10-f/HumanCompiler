'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TaskCandidate } from '@/types/runner';
import { TaskCard } from '@/components/tasks/task-card';

interface TaskSwitcherProps {
  candidates: TaskCandidate[];
  onSelect: (taskId: string) => void;
  isSelectionMode?: boolean;
}

export function TaskSwitcher({
  candidates,
  onSelect,
  isSelectionMode = false,
}: TaskSwitcherProps) {
  if (candidates.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {isSelectionMode ? '本日のタスク' : '次の候補'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {candidates.map((candidate) => (
          <div
            key={candidate.task_id}
            onClick={() => onSelect(candidate.task_id)}
            className="cursor-pointer"
          >
            <TaskCard
              taskId={candidate.task_id}
              title={candidate.task_title}
              projectId={candidate.project_id}
              goalId={candidate.goal_id}
              estimateHours={candidate.duration_hours}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
