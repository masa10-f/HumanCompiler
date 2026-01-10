'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pencil, Clock, Calendar } from 'lucide-react';
import { useWorkSessionsByTask } from '@/hooks/use-work-sessions';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { WorkSession } from '@/types/work-session';
import { SessionKptEditDialog } from './session-kpt-edit-dialog';

interface SessionHistoryProps {
  taskId: string;
  taskTitle: string;
}

export function SessionHistory({ taskId, taskTitle }: SessionHistoryProps) {
  const { data: sessions, isLoading } = useWorkSessionsByTask(taskId);
  const [editSession, setEditSession] = useState<WorkSession | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            このタスクの作業履歴はまだありません
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">作業履歴</CardTitle>
          <CardDescription>{taskTitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="border rounded-lg p-4 space-y-3"
            >
              {/* Session metadata */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {format(new Date(session.started_at), 'MM/dd (E)', { locale: ja })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {session.actual_minutes ?? 0}分
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditSession(session)}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  KPT編集
                </Button>
              </div>

              {/* KPT display */}
              <div className="space-y-2">
                {session.kpt_keep && (
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="text-green-600 border-green-600 shrink-0">K</Badge>
                    <p className="text-sm">{session.kpt_keep}</p>
                  </div>
                )}
                {session.kpt_problem && (
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="text-red-600 border-red-600 shrink-0">P</Badge>
                    <p className="text-sm">{session.kpt_problem}</p>
                  </div>
                )}
                {session.kpt_try && (
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="text-blue-600 border-blue-600 shrink-0">T</Badge>
                    <p className="text-sm">{session.kpt_try}</p>
                  </div>
                )}
                {!session.kpt_keep && !session.kpt_problem && !session.kpt_try && (
                  <p className="text-sm text-muted-foreground italic">KPT未記入</p>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <SessionKptEditDialog
        session={editSession}
        open={!!editSession}
        onOpenChange={(open) => !open && setEditSession(null)}
      />
    </>
  );
}
