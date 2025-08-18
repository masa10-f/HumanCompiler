"use client"

import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter, useParams } from 'next/navigation'
import { AppHeader } from '@/components/layout/app-header'
import { ProjectTimeline } from '@/components/timeline/project-timeline'
import { useProjectTimeline } from '@/hooks/use-timeline'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { subMonths, startOfMonth, endOfMonth } from 'date-fns'
import type { TimelineFilters } from '@/types/timeline'

export default function ProjectTimelinePage() {
  const { isAuthenticated, loading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.projectId as string

  const [filters, setFilters] = useState<TimelineFilters>(() => {
    const now = new Date()
    const startDate = startOfMonth(subMonths(now, 2))
    const endDate = endOfMonth(now)

    return {
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      time_unit: 'day'
    }
  })

  const { data: timelineData, isLoading: timelineLoading, refetch } = useProjectTimeline(projectId, filters)

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

  const handleTimeUnitChange = (unit: string) => {
    setFilters(prev => ({
      ...prev,
      time_unit: unit as 'day' | 'week' | 'month'
    }))
  }

  const handleDateRangeChange = (startDate: Date, endDate: Date) => {
    setFilters(prev => ({
      ...prev,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString()
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
        <div className="mb-6">
          <Button
            onClick={handleBack}
            variant="outline"
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            タイムライン一覧に戻る
          </Button>
        </div>

        {/* Project Timeline */}
        <ProjectTimeline
          projectId={projectId}
          data={timelineData}
          isLoading={timelineLoading}
          onRefresh={handleRefresh}
          onTimeUnitChange={handleTimeUnitChange}
          onDateRangeChange={handleDateRangeChange}
        />
      </main>
    </div>
  )
}
