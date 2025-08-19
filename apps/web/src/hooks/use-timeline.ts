"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import type { ProjectTimelineData, TimelineOverviewData, TimelineFilters } from '@/types/timeline'
import { timelineApi } from '@/lib/api'

export function useProjectTimeline(projectId: string | null, filters?: TimelineFilters, weeklyWorkHours?: number) {
  const [data, setData] = useState<ProjectTimelineData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  // Memoize filters to prevent unnecessary re-renders with stable reference
  const memoizedFilters = useMemo(() => {
    return filters ? {
      start_date: filters.start_date,
      end_date: filters.end_date,
      time_unit: filters.time_unit
    } : undefined
  }, [filters])

  const fetchTimeline = useCallback(async () => {
    if (!projectId) {
      setData(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const timelineData = await timelineApi.getProjectTimeline(
        projectId,
        memoizedFilters?.start_date,
        memoizedFilters?.end_date,
        memoizedFilters?.time_unit,
        weeklyWorkHours || 40
      )
      setData(timelineData)
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
  }, [projectId, memoizedFilters, weeklyWorkHours, toast])

  useEffect(() => {
    fetchTimeline()
  }, [fetchTimeline])

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

  // Memoize filters to prevent unnecessary re-renders with stable reference
  const memoizedFilters = useMemo(() => {
    return filters ? {
      start_date: filters.start_date,
      end_date: filters.end_date
    } : undefined
  }, [filters])

  const fetchOverview = useCallback(async () => {
    console.log('🔍 [useTimelineOverview] Starting fetchOverview...')
    console.log('🔍 [useTimelineOverview] Filters:', memoizedFilters)

    setIsLoading(true)
    setError(null)

    try {
      console.log('🔍 [useTimelineOverview] Calling timelineApi.getOverview...')
      const overviewData = await timelineApi.getOverview(memoizedFilters?.start_date, memoizedFilters?.end_date)
      console.log('✅ [useTimelineOverview] API response received:', overviewData)
      setData(overviewData)
      console.log('✅ [useTimelineOverview] Data set successfully')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'タイムライン概要の取得に失敗しました'
      console.error('❌ [useTimelineOverview] API error:', err)
      console.error('❌ [useTimelineOverview] Error message:', errorMessage)
      setError(errorMessage)
      toast({
        title: "エラー",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      console.log('🔍 [useTimelineOverview] Setting isLoading to false')
      setIsLoading(false)
    }
  }, [memoizedFilters, toast])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  return {
    data,
    isLoading,
    error,
    refetch: fetchOverview
  }
}
