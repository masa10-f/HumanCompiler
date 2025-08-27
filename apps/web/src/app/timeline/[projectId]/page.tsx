"use client"

import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter, useParams } from 'next/navigation'
import { AppHeader } from '@/components/layout/app-header'
import { ProjectTimeline } from '@/components/timeline/project-timeline'
import { TimelineVisualizer } from '@/components/timeline/timeline-visualizer'
import { TimelineErrorBoundary } from '@/components/timeline/timeline-error-boundary'
import { useProjectTimeline } from '@/hooks/use-timeline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft } from 'lucide-react'
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
      show_task_segments: true
    }
  })

  const [useNewVisualizer, setUseNewVisualizer] = useState(true)
  const [weeklyWorkHours, setWeeklyWorkHours] = useState(40)

  const { data: timelineData, isLoading: timelineLoading, error: timelineError, refetch } = useProjectTimeline(projectId, filters, weeklyWorkHours)

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

  const handleTimeUnitChange = (unit: string) => {
    setFilters(prev => ({
      ...prev,
      time_unit: unit as 'day' | 'week' | 'month'
    }))
  }

  const handleDateRangeChange = (startDate: Date, endDate: Date) => {
    setFilters(prev => ({
      ...prev,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0]
    }))
  }

  const handleRefresh = () => {
    refetch()
  }

  const handleBack = () => {
    router.push('/timeline')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="timeline" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <Button
            onClick={handleBack}
            variant="outline"
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            タイムライン一覧に戻る
          </Button>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="weekly-work-hours" className="text-sm font-medium">
                週間作業時間:
              </Label>
              <Input
                id="weekly-work-hours"
                type="number"
                min="1"
                max="168"
                value={weeklyWorkHours}
                onChange={(e) => setWeeklyWorkHours(Number(e.target.value))}
                className="w-20"
              />
              <span className="text-sm text-gray-500">時間</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setUseNewVisualizer(false)}
                variant={!useNewVisualizer ? "default" : "outline"}
                size="sm"
              >
                レガシー表示
              </Button>
              <Button
                onClick={() => setUseNewVisualizer(true)}
                variant={useNewVisualizer ? "default" : "outline"}
                size="sm"
              >
                新ビジュアライザー
              </Button>
            </div>
          </div>
        </div>

        {/* Project Timeline */}
        {useNewVisualizer ? (
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
        ) : (
          <ProjectTimeline
            projectId={projectId}
            data={timelineData}
            isLoading={timelineLoading}
            error={timelineError}
            onRefresh={handleRefresh}
            onTimeUnitChange={handleTimeUnitChange}
            onDateRangeChange={handleDateRangeChange}
          />
        )}
      </main>
    </div>
  )
}
