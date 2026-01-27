'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, ArrowRight } from 'lucide-react';
import type { TaskCandidate, TaskCandidateWithDetails } from '@/types/runner';
import { calculateEndTime } from '@/types/runner';
import { TaskCard } from '@/components/tasks/task-card';

interface TaskSwitcherProps {
  candidates: TaskCandidate[] | TaskCandidateWithDetails[];
  onSelect: (taskId: string) => void;
  isSelectionMode?: boolean;
}

function hasTaskDetails(
  candidate: TaskCandidate | TaskCandidateWithDetails
): candidate is TaskCandidateWithDetails {
  return 'task_status' in candidate && 'task_work_type' in candidate;
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
            {hasTaskDetails(candidate) ? (
              <TaskCard
                taskId={candidate.task_id}
                title={candidate.task_title}
                status={candidate.task_status}
                workType={candidate.task_work_type}
                projectId={candidate.project_id}
                goalId={candidate.goal_id}
                estimateHours={candidate.duration_hours}
                priority={candidate.task_priority}
                dueDate={candidate.task_due_date}
              />
            ) : (
              <Button
                variant="ghost"
                className="w-full justify-start h-auto py-3 px-4 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex-1 text-left">
                    <p className="font-medium text-sm truncate">
                      {candidate.task_title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        <Clock className="h-3 w-3 mr-1" />
                        {candidate.scheduled_start} - {calculateEndTime(candidate.scheduled_start, candidate.duration_hours)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {candidate.duration_hours}h
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-2" />
                </div>
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
