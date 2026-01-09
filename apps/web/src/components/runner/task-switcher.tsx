'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, ArrowRight } from 'lucide-react';
import type { TaskCandidate } from '@/types/runner';
import { calculateEndTime } from '@/types/runner';

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
          <Button
            key={candidate.task_id}
            variant="ghost"
            className="w-full justify-start h-auto py-3 px-4 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => onSelect(candidate.task_id)}
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
        ))}
      </CardContent>
    </Card>
  );
}
