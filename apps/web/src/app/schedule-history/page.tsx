'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Calendar,
  Clock,
  ExternalLink,
  Search,
  ChevronRight
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { toast } from '@/hooks/use-toast';
import { schedulingApi } from '@/lib/api';
import type { DailySchedule } from '@/types/api-responses';

export default function ScheduleHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [schedules, setSchedules] = useState<DailySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState('');
  const [filteredSchedules, setFilteredSchedules] = useState<DailySchedule[]>([]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const fetchSchedules = async () => {
      if (!user) return;

      try {
        const data = await schedulingApi.list();
        setSchedules(data);
        setFilteredSchedules(data);
      } catch {
        toast({
          title: 'データ取得エラー',
          description: 'スケジュール履歴の取得に失敗しました',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchSchedules();
  }, [user]);

  useEffect(() => {
    if (!selectedDate) {
      setFilteredSchedules(schedules);
    } else {
      const filtered = schedules.filter(schedule =>
        schedule.date.startsWith(selectedDate)
      );
      setFilteredSchedules(filtered);
    }
  }, [selectedDate, schedules]);

  const slotKindLabels = {
    study: '学習',
    deep: '集中作業',
    light: '軽作業',
    meeting: '会議'
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
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
      <AppHeader currentPage="schedule-history" />

      <div className="container mx-auto py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Calendar className="h-8 w-8 text-blue-600" />
              スケジュール履歴
            </h1>
          </div>
          <p className="text-gray-600">
            過去に作成・保存されたスケジュールの履歴を確認できます。
          </p>
        </div>

      {/* Search Filter */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              フィルター
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label htmlFor="date-filter">日付で絞り込み</Label>
                <Input
                  id="date-filter"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => setSelectedDate('')}
                className="mt-6"
              >
                リセット
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Schedule List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-lg">読み込み中...</div>
        </div>
      ) : filteredSchedules.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {selectedDate ? '該当するスケジュールがありません' : 'スケジュール履歴がありません'}
              </h3>
              <p className="text-gray-600 mb-4">
                {selectedDate
                  ? '選択した日付にスケジュールが保存されていません。'
                  : 'まだスケジュールが保存されていません。スケジューリングページで最適化結果を保存してみましょう。'
                }
              </p>
              <Button onClick={() => router.push('/scheduling')}>
                スケジューリングページへ
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredSchedules.map((schedule) => (
            <Card key={schedule.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-blue-600" />
                      {formatDate(schedule.date)}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      作成: {new Date(schedule.created_at).toLocaleString('ja-JP')}
                      {schedule.updated_at !== schedule.created_at && (
                        <span className="ml-2">
                          (更新: {new Date(schedule.updated_at).toLocaleString('ja-JP')})
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={schedule.plan_json.success ? 'default' : 'destructive'}>
                      {schedule.plan_json.optimization_status}
                    </Badge>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {schedule.plan_json.assignments.length}
                    </div>
                    <div className="text-sm text-gray-500">スケジュール済み</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {schedule.plan_json.total_scheduled_hours.toFixed(1)}h
                    </div>
                    <div className="text-sm text-gray-500">総時間</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {schedule.plan_json.unscheduled_tasks.length}
                    </div>
                    <div className="text-sm text-gray-500">未スケジュール</div>
                  </div>
                </div>

                {/* Task Assignments Preview */}
                {schedule.plan_json.assignments.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">スケジュール済みタスク</h4>
                    <div className="space-y-2">
                      {schedule.plan_json.assignments.slice(0, 3).map((assignment, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-semibold text-gray-600">
                              {assignment.start_time}
                            </div>
                            <div>
                              <div className="text-sm font-medium">{assignment.task_title}</div>
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {assignment.duration_hours.toFixed(1)}h
                                <span className="text-gray-400">•</span>
                                <Badge variant="outline" className="text-xs">
                                  {slotKindLabels[assignment.slot_kind as keyof typeof slotKindLabels]}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          {assignment.project_id && assignment.goal_id && (
                            <Link
                              href={`/projects/${assignment.project_id}/goals/${assignment.goal_id}`}
                              className="text-blue-500 hover:text-blue-700 transition-colors"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          )}
                        </div>
                      ))}
                      {schedule.plan_json.assignments.length > 3 && (
                        <div className="text-center text-sm text-gray-500 pt-2">
                          他 {schedule.plan_json.assignments.length - 3} 個のタスク
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Unscheduled Tasks */}
                {schedule.plan_json.unscheduled_tasks.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-semibold text-orange-600 mb-2">未スケジュールタスク</h4>
                    <div className="text-sm text-gray-600">
                      {schedule.plan_json.unscheduled_tasks.slice(0, 2).map((task, index) => (
                        <div key={index} className="mb-1">
                          • {task.title} ({task.estimate_hours.toFixed(1)}h)
                        </div>
                      ))}
                      {schedule.plan_json.unscheduled_tasks.length > 2 && (
                        <div className="text-gray-500">
                          他 {schedule.plan_json.unscheduled_tasks.length - 2} 個
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
