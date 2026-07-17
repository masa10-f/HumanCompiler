'use client'

import { useState, useMemo } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/layout/app-header'
import { TimelineOverview } from '@/components/timeline/timeline-overview'
import { useTimelineOverview } from '@/hooks/use-timeline'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CalendarIcon, TrendingUp } from 'lucide-react'
import { subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { getJSTDate } from '@/lib/date-utils'

export default function TimelinePage() {
  const { isAuthenticated, loading } = useAuth()
  const router = useRouter()
  const [dateRange, setDateRange] = useState('3months')

  // Calculate date range based on selection
  const getDateRange = (range: string) => {
    const now = getJSTDate(new Date().toISOString().split('T')[0]!)
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
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
    }
  }

  // Memoize the date range to prevent infinite re-renders
  const memoizedDateRange = useMemo(() => getDateRange(dateRange), [dateRange])

  const {
    data: timelineData,
    isLoading: timelineLoading,
    error: timelineError,
  } = useTimelineOverview(memoizedDateRange)

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader currentPage="timeline" />

      <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
                Portfolio view
              </p>
              <h2 className="flex items-center gap-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                  <TrendingUp className="h-5 w-5" />
                </span>
                プロジェクトタイムライン
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                プロジェクトごとの完了率と進行中タスクを比較し、詳しいロードマップへ移動できます。
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 pl-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <CalendarIcon className="h-4 w-4 text-slate-500" />
              <span className="text-xs font-medium text-slate-500">
                表示期間
              </span>
              <Select value={dateRange} onValueChange={handleDateRangeChange}>
                <SelectTrigger className="h-9 w-28 rounded-xl border-0 bg-slate-100 shadow-none dark:bg-slate-800">
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

        {/* Timeline Overview */}
        <TimelineOverview
          data={timelineData}
          isLoading={timelineLoading}
          error={timelineError}
          onProjectSelect={handleProjectSelect}
        />
      </main>
    </div>
  )
}
