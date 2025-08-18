"use client"

import { useState, useEffect } from 'react'
import { useToast } from '@/hooks/use-toast'
import type { ProjectTimelineData, TimelineOverviewData, TimelineFilters } from '@/types/timeline'
import { timelineApi } from '@/lib/api'

export function useProjectTimeline(projectId: string | null, filters?: TimelineFilters) {
  const [data, setData] = useState<ProjectTimelineData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchTimeline = async () => {
    if (!projectId) {
      setData(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const timelineData = await timelineApi.getProjectTimeline(
        projectId,
        filters?.start_date,
        filters?.end_date,
        filters?.time_unit
      )
      setData(timelineData as ProjectTimelineData)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'タイムラインの取得に失敗しました'
      setError(errorMessage)
      toast({
        title: "エラー",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTimeline()
  }, [projectId, filters?.start_date, filters?.end_date, filters?.time_unit])

  return {
    data,
    isLoading,
    error,
    refetch: fetchTimeline
  }
}

export function useTimelineOverview(filters?: Pick<TimelineFilters, 'start_date' | 'end_date'>) {
  const [data, setData] = useState<TimelineOverviewData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchOverview = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const overviewData = await timelineApi.getOverview(filters?.start_date, filters?.end_date)
      setData(overviewData as TimelineOverviewData)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'タイムライン概要の取得に失敗しました'
      setError(errorMessage)
      toast({
        title: "エラー",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchOverview()
  }, [filters?.start_date, filters?.end_date])

  return {
    data,
    isLoading,
    error,
    refetch: fetchOverview
  }
}
