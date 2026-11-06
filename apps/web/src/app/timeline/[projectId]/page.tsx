'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter, useParams } from 'next/navigation'
import { AppHeader } from '@/components/layout/app-header'
import { TimelineVisualizer } from '@/components/timeline/timeline-visualizer'
import { TimelineErrorBoundary } from '@/components/timeline/timeline-error-boundary'
import { useProjectTimeline } from '@/hooks/use-timeline'
import {
  DEFAULT_FALLBACK_WEEKLY_HOURS,
  resolveWeeklyWorkHours,
  TimelineCapacityBadge,
} from '@/components/timeline/timeline-capacity-badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default function ProjectTimelinePage() {
  const { isAuthenticated, loading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.projectId as string

  const [fallbackWeeklyHours, setFallbackWeeklyHours] = useState(
    DEFAULT_FALLBACK_WEEKLY_HOURS,
  )

  const {
    data: timelineData,
    isLoading: timelineLoading,
    error: timelineError,
    refetch,
  } = useProjectTimeline(projectId)

  const capacity = timelineData?.project.capacity
  const weeklyWorkHours = resolveWeeklyWorkHours(capacity, fallbackWeeklyHours)

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

          <TimelineCapacityBadge
            capacity={capacity}
            fallbackHours={fallbackWeeklyHours}
            onFallbackHoursChange={setFallbackWeeklyHours}
          />
        </div>

        <TimelineErrorBoundary>
          <TimelineVisualizer
            data={timelineData}
            isLoading={timelineLoading}
            error={timelineError}
            weeklyWorkHours={weeklyWorkHours}
            onRefresh={handleRefresh}
          />
        </TimelineErrorBoundary>
      </main>
    </div>
  )
}
