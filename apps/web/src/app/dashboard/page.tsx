'use client'

import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Plus, Brain, Settings, Clock, ExternalLink, History, TrendingUp } from 'lucide-react'
import { AppHeader } from '@/components/layout/app-header'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { schedulingApi } from '@/lib/api'
import { log } from '@/lib/logger'
import Link from 'next/link'
import type { DailySchedule } from '@/types/api-responses'
import { TimelineOverview } from '@/components/timeline/timeline-overview'
import { TimelineErrorBoundary } from '@/components/timeline/timeline-error-boundary'
import { useTimelineOverview } from '@/hooks/use-timeline'
import { getSlotKindLabel } from '@/constants/schedule'
import { getJSTDateString, getJSTDate } from '@/lib/date-utils'

export default function DashboardPage() {
  const { loading, isAuthenticated } = useAuth()
  const router = useRouter()
  const [todaySchedule, setTodaySchedule] = useState<DailySchedule | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(true)

  // Timeline data - re-enabled after fixing infinite loops
  const { data: timelineData, isLoading: timelineLoading, error: timelineError } = useTimelineOverview()

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login')
    }
  }, [loading, isAuthenticated, router])

  useEffect(() => {
    const fetchTodaySchedule = async () => {
      if (!isAuthenticated) return

      const today = getJSTDateString()
      try {
        const schedule = await schedulingApi.getByDate(today as string)
        setTodaySchedule(schedule)
      } catch {
        log.debug('No schedule found for today', { component: 'Dashboard', date: today })
      } finally {
        setScheduleLoading(false)
      }
    }

    fetchTodaySchedule()
  }, [isAuthenticated])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>読み込み中...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="dashboard" />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            ダッシュボード
          </h2>
          <p className="text-gray-600 dark:text-gray-300">
            ようこそ！プロジェクトとタスクを管理しましょう。
          </p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/projects')}
          >
            <CardHeader className="text-center pb-4">
              <Plus className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <CardTitle className="text-lg">プロジェクト管理</CardTitle>
              <CardDescription>プロジェクト・ゴール・タスクを管理</CardDescription>
            </CardHeader>
          </Card>

          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/ai-planning')}
          >
            <CardHeader className="text-center pb-4">
              <Brain className="h-8 w-8 text-purple-600 mx-auto mb-2" />
              <CardTitle className="text-lg">週次計画</CardTitle>
              <CardDescription>週間計画の作成とタスク管理（AI分析オプション）</CardDescription>
            </CardHeader>
          </Card>

          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/scheduling')}
          >
            <CardHeader className="text-center pb-4">
              <Settings className="h-8 w-8 text-green-600 mx-auto mb-2" />
              <CardTitle className="text-lg">日次計画</CardTitle>
              <CardDescription>OR-Toolsによる日次スケジュール最適化</CardDescription>
            </CardHeader>
          </Card>

          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/schedule-history')}
          >
            <CardHeader className="text-center pb-4">
              <History className="h-8 w-8 text-orange-600 mx-auto mb-2" />
              <CardTitle className="text-lg">スケジュール履歴</CardTitle>
              <CardDescription>過去のスケジュールを確認</CardDescription>
            </CardHeader>
          </Card>

          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/timeline')}
          >
            <CardHeader className="text-center pb-4">
              <TrendingUp className="h-8 w-8 text-indigo-600 mx-auto mb-2" />
              <CardTitle className="text-lg">タイムライン</CardTitle>
              <CardDescription>プロジェクト進捗の可視化</CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Today's Schedule */}
        {!scheduleLoading && todaySchedule && todaySchedule.plan_json?.assignments?.length > 0 && (
          <div className="mb-8">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-blue-600" />
                      本日のスケジュール
                    </CardTitle>
                    <CardDescription>
                      {(() => {
                        const jstDate = getJSTDate(getJSTDateString())
                        return jstDate.toLocaleDateString('ja-JP', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          weekday: 'long'
                        })
                      })()}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push('/schedule-history')}
                      className="flex items-center gap-1"
                    >
                      <History className="h-3 w-3" />
                      履歴
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push('/scheduling')}
                    >
                      スケジュール編集
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {todaySchedule.plan_json.assignments
                    .sort((a, b) => a.start_time.localeCompare(b.start_time))
                    .map((assignment, index: number) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-semibold text-gray-600">
                          {assignment.start_time}
                        </div>
                        <div>
                          <div className="font-medium">{assignment.task_title}</div>
                          <div className="text-sm text-gray-500 flex items-center gap-2">
                            <Clock className="h-3 w-3" />
                            {assignment.duration_hours.toFixed(1)}時間
                            <span className="text-gray-400">•</span>
                            <Badge variant="outline" className="text-xs">
                              {getSlotKindLabel(assignment.slot_kind)}
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
                </div>
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">総スケジュール時間</span>
                    <span className="font-semibold">
                      {todaySchedule.plan_json.total_scheduled_hours.toFixed(1)}時間
                    </span>
                  </div>
                  {/* Note: Unscheduled tasks are intentionally not displayed per issue #85 */}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Timeline Overview */}
        <div className="mb-8">
          <TimelineErrorBoundary>
            <TimelineOverview
              data={timelineData}
              isLoading={timelineLoading}
              error={timelineError}
              onProjectSelect={(projectId) => router.push(`/timeline/${projectId}`)}
            />
          </TimelineErrorBoundary>
        </div>

      </main>
    </div>
  )
}
