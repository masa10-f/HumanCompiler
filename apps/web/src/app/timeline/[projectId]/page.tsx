'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter, useParams } from 'next/navigation'
import { AppHeader } from '@/components/layout/app-header'
import { TimelineVisualizer } from '@/components/timeline/timeline-visualizer'
import { TimelineErrorBoundary } from '@/components/timeline/timeline-error-boundary'
import { useProjectTimeline } from '@/hooks/use-timeline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Clock3 } from 'lucide-react'
import { subMonths, startOfMonth, endOfMonth } from 'date-fns'
import type { TimelineFilters } from '@/types/timeline'
import { getJSTDate } from '@/lib/date-utils'

export default function ProjectTimelinePage() {
  const { isAuthenticated, loading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.projectId as string

  const [filters, setFilters] = useState<TimelineFilters>(() => {
    const now = getJSTDate(new Date().toISOString().split('T')[0]!)
    const startDate = startOfMonth(subMonths(now, 2))
    const endDate = endOfMonth(now)

    return {
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      time_unit: 'day',
      show_dependencies: true,
      show_task_segments: true,
    }
  })

  const [weeklyWorkHours, setWeeklyWorkHours] = useState(20)

  const {
    data: timelineData,
    isLoading: timelineLoading,
    error: timelineError,
    refetch,
  } = useProjectTimeline(projectId, filters, weeklyWorkHours)

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

  const handleFiltersChange = (newFilters: TimelineFilters) => {
    setFilters(newFilters)
  }

  const handleRefresh = () => {
    refetch()
  }

  const handleBack = () => {
    router.push('/timeline')
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader currentPage="timeline" />

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* Navigation */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            onClick={handleBack}
            variant="ghost"
            className="w-fit gap-2 rounded-xl text-slate-600 hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            プロジェクト一覧
          </Button>

          <div className="flex w-fit items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
              <Clock3 className="h-4 w-4" />
            </div>
            <div>
              <Label
                htmlFor="weekly-work-hours"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
              >
                週間キャパシティ
              </Label>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Input
                  id="weekly-work-hours"
                  type="number"
                  min="1"
                  max="168"
                  value={weeklyWorkHours}
                  onChange={(e) => setWeeklyWorkHours(Number(e.target.value))}
                  className="h-7 w-16 border-0 bg-transparent p-0 text-right text-sm font-semibold shadow-none focus-visible:ring-0"
                />
                <span className="text-xs text-slate-500">時間 / 週</span>
              </div>
            </div>
          </div>
        </div>

        <TimelineErrorBoundary>
          <TimelineVisualizer
            data={timelineData}
            isLoading={timelineLoading}
            error={timelineError}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            onRefresh={handleRefresh}
          />
        </TimelineErrorBoundary>
      </main>
    </div>
  )
}
