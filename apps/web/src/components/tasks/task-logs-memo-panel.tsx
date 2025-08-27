'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ChevronDown, ChevronRight, Clock, MessageSquare, Edit, Save, X } from 'lucide-react';
import { useLogsByTask } from '@/hooks/use-logs-query';
import { useUpdateTask } from '@/hooks/use-tasks-query';
import { useToast } from '@/hooks/use-toast';
import { sanitizeText } from '@/lib/security';
import type { Task } from '@/types/task';
import { log } from '@/lib/logger';
import { formatJSTDateTime } from '@/lib/date-utils';

interface TaskLogsMemoPanelProps {
  task: Task;
}

export function TaskLogsMemoPanel({ task }: TaskLogsMemoPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMemoEditing, setIsMemoEditing] = useState(false);
  const [memoText, setMemoText] = useState(task.memo || '');

  const { data: logs = [], isLoading: logsLoading, error: logsError } = useLogsByTask(task.id);
  const updateTaskMutation = useUpdateTask();
  const { toast } = useToast();

  // Performance optimization: memoize total log time calculation
  const totalLogTime = useMemo(() =>
    logs.reduce((sum, logEntry) => sum + (logEntry.actual_minutes || 0), 0),
    [logs]
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
    </Collapsible>
  );
}
