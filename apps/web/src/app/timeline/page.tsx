"use client"

import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/layout/app-header'
import { TimelineOverview } from '@/components/timeline/timeline-overview'
import { useTimelineOverview } from '@/hooks/use-timeline'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CalendarIcon, TrendingUp } from 'lucide-react'
import { subMonths, startOfMonth, endOfMonth } from 'date-fns'

export default function TimelinePage() {
  const { isAuthenticated, loading } = useAuth()
  const router = useRouter()
  const [dateRange, setDateRange] = useState('3months')

  // Calculate date range based on selection
  const getDateRange = (range: string) => {
    const now = new Date()
    let startDate: Date
    const endDate = endOfMonth(now)

    switch (range) {
      case '1month':
        startDate = startOfMonth(now)
        break
      case '3months':
        startDate = startOfMonth(subMonths(now, 2))
        break
      case '6months':
        startDate = startOfMonth(subMonths(now, 5))
        break
      case '1year':
        startDate = startOfMonth(subMonths(now, 11))
        break
      default:
        startDate = startOfMonth(subMonths(now, 2))
    }

    return {
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString()
    }
  }

  const { data: timelineData, isLoading: timelineLoading, error: timelineError } = useTimelineOverview(getDateRange(dateRange))

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
    router.push('/login')
    return null
  }

  const handleProjectSelect = (projectId: string) => {
    router.push(`/timeline/${projectId}`)
  }

  const handleDateRangeChange = (range: string) => {
    setDateRange(range)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="timeline" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-indigo-600" />
                プロジェクトタイムライン
              </h2>
              <p className="text-gray-600 dark:text-gray-300">
                プロジェクト進捗状況を時系列で可視化して、全体の進行状況を把握しましょう。
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-500">表示期間:</span>
                <Select value={dateRange} onValueChange={handleDateRangeChange}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1month">1ヶ月</SelectItem>
                    <SelectItem value="3months">3ヶ月</SelectItem>
                    <SelectItem value="6months">6ヶ月</SelectItem>
                    <SelectItem value="1year">1年</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline Overview */}
        <TimelineOverview
          data={timelineData}
          isLoading={timelineLoading}
          error={timelineError}
          onProjectSelect={handleProjectSelect}
        />

        {/* Help Section */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>タイムライン機能について</CardTitle>
            <CardDescription>
              プロジェクトタイムライン機能の使い方とメリット
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-2">📊 進捗の可視化</h4>
                <p className="text-sm text-gray-600 mb-4">
                  各プロジェクトのゴールとタスクの進行状況を時系列で表示し、
                  全体の進捗を一目で把握できます。
                </p>

                <h4 className="font-semibold mb-2">🎯 タスク管理の最適化</h4>
                <p className="text-sm text-gray-600">
                  タスクの完了率や実際の作業時間を可視化することで、
                  今後の計画立てに活用できます。
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-2">📈 レポート機能</h4>
                <p className="text-sm text-gray-600 mb-4">
                  タイムライン画像をダウンロードして、
                  プレゼンテーション資料や進捗報告に活用できます。
                </p>

                <h4 className="font-semibold mb-2">🔍 詳細分析</h4>
                <p className="text-sm text-gray-600">
                  各プロジェクトの詳細タイムラインで、
                  ゴールごとのタスク分布と進捗を詳しく分析できます。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
