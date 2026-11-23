'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Play, Timer } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { SessionKptEditDialog } from '@/components/runner/session-kpt-edit-dialog';
import { WorkRecordItem } from '@/components/work-records/work-record-item';
import { useWorkRecords } from '@/hooks/use-work-sessions';
import { toJSTDateInputValue } from '@/lib/date-utils';
import { taskPagePath } from '@/lib/tasks/task-paths';
import type { WorkRecordEntry, WorkSession } from '@/types/work-session';

/** How many of the newest records the page loads (the API's maximum). */
const RECORDS_LIMIT = 100;

type SourceFilter = 'all' | 'runner' | 'manual';

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

function recordKey(entry: WorkRecordEntry): string {
  return entry.log ? `log:${entry.log.id}` : `session:${entry.session?.id}`;
}

/**
 * The user's work across tasks as one list: Runner sessions and times entered
 * by hand, each piece of work once.
 */
export default function WorkSessionHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [decisionFilter, setDecisionFilter] = useState<string>('all');
  const [editSession, setEditSession] = useState<WorkSession | null>(null);

  const { data: records, isLoading, error } = useWorkRecords(0, RECORDS_LIMIT);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const filteredRecords = useMemo(() => {
    if (!records) return [];

    return records.filter((entry) => {
      // The day the work was recorded, as the date inputs mean it (JST).
      const day = toJSTDateInputValue(entry.at);
      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;

      if (sourceFilter === 'runner' && !entry.session) return false;
      if (sourceFilter === 'manual' && entry.session) return false;

      // A time entered by hand has no decision, so it matches none.
      if (decisionFilter !== 'all' && entry.session?.decision !== decisionFilter) {
        return false;
      }

      return true;
    });
  }, [records, startDate, endDate, sourceFilter, decisionFilter]);

  const stats = useMemo(() => {
    // Time is counted from the logs only, as estimates and reports count it:
    // a session without a time record adds nothing.
    const totalMinutes = filteredRecords.reduce(
      (sum, entry) => sum + (entry.log?.actual_minutes ?? 0),
      0
    );
    const runnerRecords = filteredRecords.filter((entry) => entry.session).length;

    return {
      totalRecords: filteredRecords.length,
      totalMinutes,
      runnerRecords,
    };
  }, [filteredRecords]);

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setSourceFilter('all');
    setDecisionFilter('all');
  };

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const hasRecords = Boolean(records && records.length > 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="work-session-history" />

      <div className="container mx-auto py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Timer className="h-8 w-8 text-blue-600" />
              作業履歴
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Runnerのセッションと手入力の時間記録を、新しい順にまとめて確認できます。
          </p>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">
                  {stats.totalRecords}
                </div>
                <div className="text-sm text-gray-500">記録数</div>
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
                  {stats.runnerRecords}
                </div>
                <div className="text-sm text-gray-500">Runnerの記録</div>
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
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                <Label htmlFor="source-filter">記録の種類</Label>
                <Select
                  value={sourceFilter}
                  onValueChange={(value) => setSourceFilter(value as SourceFilter)}
                >
                  <SelectTrigger id="source-filter" className="mt-1">
                    <SelectValue placeholder="すべて" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">すべて</SelectItem>
                    <SelectItem value="runner">Runner</SelectItem>
                    <SelectItem value="manual">手入力</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="decision-filter">決定タイプ</Label>
                <Select
                  value={decisionFilter}
                  onValueChange={setDecisionFilter}
                >
                  <SelectTrigger id="decision-filter" className="mt-1">
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

        {/* Record list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-lg">読み込み中...</div>
          </div>
        ) : error ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">
                作業履歴の読み込みに失敗しました: {(error as Error).message}
              </p>
            </CardContent>
          </Card>
        ) : filteredRecords.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Timer className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {hasRecords ? '該当する作業記録がありません' : '作業記録がありません'}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  {hasRecords
                    ? 'フィルター条件を変更してください。'
                    : 'Runnerで作業するか、タスクで時間を記録すると、ここに表示されます。'}
                </p>
                <Button onClick={() => router.push('/runner')}>
                  <Play className="h-4 w-4 mr-2" />
                  Runnerを開始
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <ul className="space-y-3">
              {filteredRecords.map((entry) => (
                <WorkRecordItem
                  key={recordKey(entry)}
                  record={{
                    key: recordKey(entry),
                    at: entry.at,
                    log: entry.log ?? undefined,
                    session: entry.session ?? undefined,
                  }}
                  // The API pairs each session with its log, so a session
                  // listed without one has none.
                  logsComplete
                  detailed
                  onEditKpt={setEditSession}
                  className="rounded-lg border bg-card p-4 shadow-sm"
                  heading={
                    <Link
                      href={taskPagePath(entry.project_id, entry.goal_id, entry.task_id)}
                      className="block break-words font-semibold hover:underline"
                    >
                      {entry.task_title}
                    </Link>
                  }
                />
              ))}
            </ul>
            {records && records.length >= RECORDS_LIMIT && (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                最新{RECORDS_LIMIT}件の記録を表示しています。
              </p>
            )}
          </>
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
