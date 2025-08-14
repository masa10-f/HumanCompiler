import React from 'react';
import { Clock } from 'lucide-react';
import { useBatchLogsQuery } from '@/hooks/use-logs-query';

interface TaskActualTimeBatchProps {
  taskIds: string[];
}

export function TaskActualTimeBatch({ taskIds }: TaskActualTimeBatchProps) {
  const { data: logsData, isLoading } = useBatchLogsQuery(taskIds);

  if (isLoading) {
    return <div className="text-xs text-muted-foreground">読み込み中...</div>;
  }

  const taskTimes = taskIds.map(taskId => {
    const logs = logsData?.[taskId] || [];
    const totalMinutes = logs.reduce((total, log) => total + log.actual_minutes, 0);
    const hours = Math.round((totalMinutes / 60) * 100) / 100;
    
    return { taskId, hours };
  });

  return (
    <>
      {taskTimes.map(({ taskId, hours }) => (
        <div key={taskId} className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {hours > 0 ? `${hours}h` : '-'}
        </div>
      ))}
    </>
  );
}