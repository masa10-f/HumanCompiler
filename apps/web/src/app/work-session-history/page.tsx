'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Clock,
  Calendar,
  Search,
  ChevronDown,
  ChevronUp,
  Pencil,
  Play,
  Timer,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { SessionKptEditDialog } from '@/components/runner/session-kpt-edit-dialog';
import { toast } from '@/hooks/use-toast';
import { useWorkSessionHistory } from '@/hooks/use-work-sessions';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { WorkSession, SessionDecision } from '@/types/work-session';
import {
  SESSION_DECISION_LABELS,
  CHECKOUT_TYPE_LABELS,
} from '@/types/work-session';

/**
 * Calculate actual work minutes from session timestamps.
 * Prioritizes actual_minutes if available, otherwise calculates from timestamps.
 */
function calculateWorkMinutes(session: WorkSession): number {
  if (session.actual_minutes != null) {
    return session.actual_minutes;
  }
  if (session.ended_at && session.started_at) {
    const startMs = new Date(session.started_at).getTime();
    const endMs = new Date(session.ended_at).getTime();
    const pausedSeconds = session.total_paused_seconds || 0;
    return Math.floor((endMs - startMs) / (1000 * 60)) - Math.floor(pausedSeconds / 60);
  }
  // Active session - calculate from start to now
  if (session.started_at && !session.ended_at) {
    const startMs = new Date(session.started_at).getTime();
    const pausedSeconds = session.total_paused_seconds || 0;
    return Math.floor((Date.now() - startMs) / (1000 * 60)) - Math.floor(pausedSeconds / 60);
  }
  return 0;
}

/**
 * Format minutes to human-readable string
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}分`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}時間`;
  }
  return `${hours}時間${remainingMinutes}分`;
}

/**
 * Get badge variant for decision type
 */
function getDecisionBadgeVariant(decision: SessionDecision | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (decision) {
    case 'complete':
      return 'default';
    case 'continue':
      return 'secondary';
    case 'break':
      return 'outline';
    case 'switch':
      return 'destructive';
    default:
      return 'outline';
  }
}

export default function WorkSessionHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [decisionFilter, setDecisionFilter] = useState<string>('all');
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [editSession, setEditSession] = useState<WorkSession | null>(null);

  // Fetch with a higher limit to get more history
  const { data: sessions, isLoading, error } = useWorkSessionHistory(0, 100);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (error) {
      toast({
        title: 'データ取得エラー',
        description: '作業セッション履歴の取得に失敗しました',
        variant: 'destructive',
      });
    }
  }, [error]);

  // Filter sessions based on criteria
  const filteredSessions = useMemo(() => {
    if (!sessions) return [];

    return sessions.filter((session) => {
      // Date range filter
      if (startDate) {
        const sessionDate = new Date(session.started_at).toISOString().split('T')[0] ?? '';
        if (sessionDate < startDate) return false;
      }
      if (endDate) {
        const sessionDate = new Date(session.started_at).toISOString().split('T')[0] ?? '';
        if (sessionDate > endDate) return false;
      }

      // Decision filter
      if (decisionFilter !== 'all' && session.decision !== decisionFilter) {
        return false;
      }

      return true;
    });
  }, [sessions, startDate, endDate, decisionFilter]);

  // Calculate statistics
  const stats = useMemo(() => {
    const totalSessions = filteredSessions.length;
    const totalMinutes = filteredSessions.reduce(
      (sum, session) => sum + calculateWorkMinutes(session),
      0
    );
    const completedSessions = filteredSessions.filter(
      (session) => session.decision === 'complete'
    ).length;

    return {
      totalSessions,
      totalMinutes,
      completedSessions,
    };
  }, [filteredSessions]);

  const toggleSessionExpand = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setDecisionFilter('all');
  };

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="work-session-history" />

      <div className="container mx-auto py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Timer className="h-8 w-8 text-blue-600" />
              作業セッション履歴
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Runner/Focusモードで記録された作業セッションの履歴を確認できます。
          </p>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">
                  {stats.totalSessions}
                </div>
                <div className="text-sm text-gray-500">セッション数</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">
                  {formatDuration(stats.totalMinutes)}
                </div>
                <div className="text-sm text-gray-500">総作業時間</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600">
                  {stats.completedSessions}
                </div>
                <div className="text-sm text-gray-500">完了セッション</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              フィルター
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="start-date">開始日</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="end-date">終了日</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="decision-filter">決定タイプ</Label>
                <Select
                  value={decisionFilter}
                  onValueChange={setDecisionFilter}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="すべて" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">すべて</SelectItem>
                    <SelectItem value="continue">継続</SelectItem>
                    <SelectItem value="switch">切替</SelectItem>
                    <SelectItem value="break">休憩</SelectItem>
                    <SelectItem value="complete">完了</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={resetFilters} className="w-full">
                  リセット
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Session List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-lg">読み込み中...</div>
          </div>
        ) : filteredSessions.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Timer className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {sessions && sessions.length > 0
                    ? '該当する作業セッションがありません'
                    : '作業セッション履歴がありません'}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  {sessions && sessions.length > 0
                    ? 'フィルター条件を変更してください。'
                    : 'Runnerモードで作業を開始すると、ここに履歴が表示されます。'}
                </p>
                <Button onClick={() => router.push('/runner')}>
                  <Play className="h-4 w-4 mr-2" />
                  Runnerを開始
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredSessions.map((session) => {
              const isExpanded = expandedSessions.has(session.id);
              const hasKpt = session.kpt_keep || session.kpt_problem || session.kpt_try;
              const workMinutes = calculateWorkMinutes(session);

              return (
                <Card
                  key={session.id}
                  className="hover:shadow-md transition-shadow"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg flex items-center gap-2">
                          {session.task?.title || 'タスク名不明'}
                          {!session.ended_at && (
                            <Badge variant="secondary" className="text-xs">
                              作業中
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-4 mt-1">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {format(new Date(session.started_at), 'yyyy/MM/dd (E)', {
                              locale: ja,
                            })}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {format(new Date(session.started_at), 'HH:mm', {
                              locale: ja,
                            })}
                            {session.ended_at && (
                              <>
                                {' → '}
                                {format(new Date(session.ended_at), 'HH:mm', {
                                  locale: ja,
                                })}
                              </>
                            )}
                          </span>
                          <span className="flex items-center gap-1">
                            <Timer className="h-4 w-4" />
                            {formatDuration(workMinutes)}
                          </span>
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {session.checkout_type && (
                          <Badge variant="outline">
                            {CHECKOUT_TYPE_LABELS[session.checkout_type]}
                          </Badge>
                        )}
                        {session.decision && (
                          <Badge variant={getDecisionBadgeVariant(session.decision)}>
                            {SESSION_DECISION_LABELS[session.decision]}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-2">
                    {/* KPT Section */}
                    {hasKpt ? (
                      <Collapsible
                        open={isExpanded}
                        onOpenChange={() => toggleSessionExpand(session.id)}
                      >
                        <div className="flex items-center justify-between">
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex items-center gap-1 text-muted-foreground"
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                              KPTを{isExpanded ? '閉じる' : '表示'}
                            </Button>
                          </CollapsibleTrigger>
                          {session.ended_at && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditSession(session)}
                            >
                              <Pencil className="h-4 w-4 mr-1" />
                              編集
                            </Button>
                          )}
                        </div>
                        <CollapsibleContent className="mt-2 space-y-2">
                          {session.kpt_keep && (
                            <div className="flex items-start gap-2">
                              <Badge
                                variant="outline"
                                className="text-green-600 border-green-600 shrink-0"
                              >
                                K
                              </Badge>
                              <p className="text-sm">{session.kpt_keep}</p>
                            </div>
                          )}
                          {session.kpt_problem && (
                            <div className="flex items-start gap-2">
                              <Badge
                                variant="outline"
                                className="text-red-600 border-red-600 shrink-0"
                              >
                                P
                              </Badge>
                              <p className="text-sm">{session.kpt_problem}</p>
                            </div>
                          )}
                          {session.kpt_try && (
                            <div className="flex items-start gap-2">
                              <Badge
                                variant="outline"
                                className="text-blue-600 border-blue-600 shrink-0"
                              >
                                T
                              </Badge>
                              <p className="text-sm">{session.kpt_try}</p>
                            </div>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    ) : (
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground italic">
                          KPT未記入
                        </p>
                        {session.ended_at && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditSession(session)}
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            KPTを追加
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* KPT Edit Dialog */}
      <SessionKptEditDialog
        session={editSession}
        open={!!editSession}
        onOpenChange={(open) => !open && setEditSession(null)}
      />
    </div>
  );
}
