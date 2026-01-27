'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ChevronDown, ChevronRight, Clock, MessageSquare, Edit, Save, X, Trash2, Timer, Pencil } from 'lucide-react';
import { useLogsByTask } from '@/hooks/use-logs-query';
import { useUpdateTask } from '@/hooks/use-tasks-query';
import { useWorkSessionsByTask } from '@/hooks/use-work-sessions';
import { SessionKptEditDialog } from '@/components/runner/session-kpt-edit-dialog';
import { SESSION_DECISION_LABELS } from '@/types/work-session';
import type { WorkSession } from '@/types/work-session';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { sanitizeText } from '@/lib/security';
import type { Task } from '@/types/task';
import { log } from '@/lib/logger';
import { formatJSTDateTime } from '@/lib/date-utils';
import { LogEditDialog } from '@/components/logs/log-edit-dialog';
import { LogDeleteDialog } from '@/components/logs/log-delete-dialog';

interface TaskLogsMemoPanelProps {
  task: Task;
}

/**
 * Calculate actual work minutes from session timestamps.
 */
function calculateSessionWorkMinutes(session: WorkSession): number {
  if (session.actual_minutes != null) {
    return session.actual_minutes;
  }
  if (session.ended_at && session.started_at) {
    const startMs = new Date(session.started_at).getTime();
    const endMs = new Date(session.ended_at).getTime();
    const pausedSeconds = session.total_paused_seconds || 0;
    return Math.floor((endMs - startMs) / (1000 * 60)) - Math.floor(pausedSeconds / 60);
  }
  return 0;
}

export function TaskLogsMemoPanel({ task }: TaskLogsMemoPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMemoEditing, setIsMemoEditing] = useState(false);
  const [memoText, setMemoText] = useState(task.memo || '');
  const [editSession, setEditSession] = useState<WorkSession | null>(null);

  const { data: logs = [], isLoading: logsLoading, error: logsError } = useLogsByTask(task.id);
  const { data: sessions = [], isLoading: sessionsLoading } = useWorkSessionsByTask(task.id);
  const updateTaskMutation = useUpdateTask();
  const { toast } = useToast();

  // Performance optimization: memoize total log time calculation
  const totalLogTime = useMemo(() =>
    logs.reduce((sum, logEntry) => sum + (logEntry.actual_minutes || 0), 0),
    [logs]
  );

  // Total session time
  const totalSessionTime = useMemo(() =>
    sessions.reduce((sum, session) => sum + calculateSessionWorkMinutes(session), 0),
    [sessions]
  );

  const handleSaveMemo = async () => {
    try {
      await updateTaskMutation.mutateAsync({
        id: task.id,
        data: { memo: memoText }
      });
      setIsMemoEditing(false);
      // Success notification
      toast({
        title: "メモを保存しました",
        description: "タスクメモが正常に更新されました。",
      });
    } catch (error) {
      log.error('Failed to update task memo', error, {
        component: 'TaskLogsMemoPanel',
        taskId: task.id
      });
      // Error notification
      toast({
        variant: "destructive",
        title: "メモの保存に失敗しました",
        description: "ネットワーク接続を確認して再試行してください。",
      });
    }
  };

  const handleCancelMemo = () => {
    setMemoText(task.memo || '');
    setIsMemoEditing(false);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 w-full justify-start p-2 h-auto text-left hover:bg-gray-50"
          aria-label={`${task.title}の作業ログとメモを${isOpen ? '閉じる' : '開く'}`}
          aria-expanded={isOpen}
          aria-describedby={`task-${task.id}-logs-memo-summary`}
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <div className="flex items-center gap-4" id={`task-${task.id}-logs-memo-summary`}>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium">
                作業ログ ({logs.length}件, {(totalLogTime / 60).toFixed(1)}h)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Timer className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium">
                セッション ({sessions.length}件, {(totalSessionTime / 60).toFixed(1)}h)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <MessageSquare className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium">
                メモ {task.memo ? '(あり)' : '(なし)'}
              </span>
            </div>
          </div>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-6 pt-2 pb-4 space-y-4">
          {/* Memo Section */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  タスクメモ
                </CardTitle>
                {!isMemoEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsMemoEditing(true)}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    編集
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isMemoEditing ? (
                <div className="space-y-3">
                  <Textarea
                    value={memoText}
                    onChange={(e) => setMemoText(e.target.value)}
                    placeholder="タスクに関するメモを入力してください..."
                    className="min-h-[80px]"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveMemo}
                      disabled={updateTaskMutation.isPending}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      保存
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelMemo}
                      disabled={updateTaskMutation.isPending}
                    >
                      <X className="h-4 w-4 mr-1" />
                      キャンセル
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600">
                  {task.memo ? (
                    <div
                      className="whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeText(task.memo)
                      }}
                    />
                  ) : (
                    <div className="text-gray-400">メモはまだ設定されていません</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Work Sessions Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Timer className="h-4 w-4" />
                作業セッション履歴
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <div className="text-sm text-gray-500">セッションを読み込み中...</div>
              ) : sessions.length === 0 ? (
                <div className="text-sm text-gray-400">セッション履歴はまだありません</div>
              ) : (
                <div className="space-y-3">
                  {sessions.map((session) => {
                    const workMinutes = calculateSessionWorkMinutes(session);
                    const hasKpt = session.kpt_keep || session.kpt_problem || session.kpt_try;
                    return (
                      <div
                        key={session.id}
                        className="p-3 bg-gray-50 rounded-md space-y-2"
                      >
                        {/* Session metadata */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            <span>
                              {format(new Date(session.started_at), 'MM/dd (E) HH:mm', { locale: ja })}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {workMinutes}分
                            </Badge>
                            {session.decision && (
                              <Badge variant="outline" className="text-xs">
                                {SESSION_DECISION_LABELS[session.decision]}
                              </Badge>
                            )}
                            {!session.ended_at && (
                              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                                作業中
                              </Badge>
                            )}
                          </div>
                          {session.ended_at && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditSession(session)}
                              className="h-8 w-8 p-0 text-gray-500 hover:text-blue-600"
                            >
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">KPT編集</span>
                            </Button>
                          )}
                        </div>

                        {/* KPT display */}
                        {hasKpt ? (
                          <div className="space-y-1.5 pl-1">
                            {session.kpt_keep && (
                              <div className="flex items-start gap-2">
                                <Badge variant="outline" className="text-green-600 border-green-600 shrink-0 text-xs">
                                  K
                                </Badge>
                                <p className="text-sm text-gray-700">{session.kpt_keep}</p>
                              </div>
                            )}
                            {session.kpt_problem && (
                              <div className="flex items-start gap-2">
                                <Badge variant="outline" className="text-red-600 border-red-600 shrink-0 text-xs">
                                  P
                                </Badge>
                                <p className="text-sm text-gray-700">{session.kpt_problem}</p>
                              </div>
                            )}
                            {session.kpt_try && (
                              <div className="flex items-start gap-2">
                                <Badge variant="outline" className="text-blue-600 border-blue-600 shrink-0 text-xs">
                                  T
                                </Badge>
                                <p className="text-sm text-gray-700">{session.kpt_try}</p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic pl-1">KPT未記入</p>
                        )}
                      </div>
                    );
                  })}

                  {sessions.length > 0 && (
                    <div className="pt-2 border-t">
                      <div className="text-sm font-medium text-gray-900">
                        合計セッション時間: {(totalSessionTime / 60).toFixed(1)}時間 ({totalSessionTime}分)
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Work Logs Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" />
                作業ログ一覧
              </CardTitle>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="text-sm text-gray-500">ログを読み込み中...</div>
              ) : logsError ? (
                <div className="text-sm text-red-600">
                  ログの読み込みに失敗しました: {logsError.message}
                </div>
              ) : logs.length === 0 ? (
                <div className="text-sm text-gray-400">作業ログはまだありません</div>
              ) : (
                <div className="space-y-3">
                  {logs.map((logEntry) => (
                    <div
                      key={logEntry.id}
                      className="flex items-start justify-between p-3 bg-gray-50 rounded-md"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-xs">
                            {(logEntry.actual_minutes / 60).toFixed(1)}h
                          </Badge>
                          <span className="text-xs text-gray-500">
                            {formatJSTDateTime(logEntry.created_at)}
                          </span>
                        </div>
                        {logEntry.comment && (
                          <div
                            className="text-sm text-gray-700 whitespace-pre-wrap"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeText(logEntry.comment)
                            }}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <LogEditDialog
                          log={logEntry}
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-gray-500 hover:text-blue-600"
                            >
                              <Edit className="h-4 w-4" />
                              <span className="sr-only">ログを編集</span>
                            </Button>
                          }
                        />
                        <LogDeleteDialog
                          log={logEntry}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-gray-500 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">ログを削除</span>
                          </Button>
                        </LogDeleteDialog>
                      </div>
                    </div>
                  ))}

                  {logs.length > 0 && (
                    <div className="pt-2 border-t">
                      <div className="text-sm font-medium text-gray-900">
                        合計作業時間: {(totalLogTime / 60).toFixed(1)}時間 ({totalLogTime}分)
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </CollapsibleContent>

      {/* KPT Edit Dialog */}
      <SessionKptEditDialog
        session={editSession}
        open={!!editSession}
        onOpenChange={(open) => !open && setEditSession(null)}
      />
    </Collapsible>
  );
}
