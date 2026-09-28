'use client';

import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TaskCandidate } from '@/types/runner';

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
        {/* Buttons, not task links: selecting a candidate starts or switches to it */}
        {candidates.map((candidate) => (
          <button
            key={candidate.task_id}
            type="button"
            onClick={() => onSelect(candidate.task_id)}
            className="w-full rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="block break-words text-sm font-medium">
              {candidate.task_title}
            </span>
            <span className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {candidate.scheduled_start} ({candidate.duration_hours}h)
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
