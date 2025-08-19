"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useToast } from '@/hooks/use-toast'
import type { ProjectTimelineData, TimelineOverviewData, TimelineFilters } from '@/types/timeline'
import { timelineApi } from '@/lib/api'

export function useProjectTimeline(projectId: string | null, filters?: TimelineFilters, weeklyWorkHours?: number) {
  const [data, setData] = useState<ProjectTimelineData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  // Memoize filters with stable reference - only create new object when filters actually change
  const memoizedFilters = useMemo(() => {
    if (!filters) return null
    return {
      start_date: filters.start_date,
      end_date: filters.end_date,
      time_unit: filters.time_unit
    }
  }, [filters?.start_date, filters?.end_date, filters?.time_unit])

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
      // Use toast directly without adding to dependencies
      toast({
        title: "エラー",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [projectId, memoizedFilters, weeklyWorkHours])
  // Note: toast is intentionally excluded from dependencies to prevent infinite loops

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
  const mountedRef = useRef(true)
  const loadingRef = useRef(false)

  // Memoize filters with stable reference - only create new object when filters actually change
  const memoizedFilters = useMemo(() => {
    if (!filters) return null
    return {
      start_date: filters.start_date,
      end_date: filters.end_date
    }
  }, [filters?.start_date, filters?.end_date])

  const fetchOverview = useCallback(async () => {
    console.log('🔍 [useTimelineOverview] Starting fetchOverview... Call #', Date.now())
    console.log('🔍 [useTimelineOverview] Filters:', memoizedFilters)

    // Prevent multiple simultaneous calls and unmounted component updates
    if (loadingRef.current || !mountedRef.current) {
      console.log('🔍 [useTimelineOverview] Already loading or unmounted, skipping call')
      return
    }

    loadingRef.current = true
    setIsLoading(true)
    setError(null)

    try {
      console.log('🔍 [useTimelineOverview] Calling timelineApi.getOverview...')
      const overviewData = await timelineApi.getOverview(memoizedFilters?.start_date, memoizedFilters?.end_date)
      console.log('✅ [useTimelineOverview] API response received:', overviewData)

      if (mountedRef.current) {
        setData(overviewData)
        console.log('✅ [useTimelineOverview] Data set successfully')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'タイムライン概要の取得に失敗しました'
      console.error('❌ [useTimelineOverview] API error:', err)
      console.error('❌ [useTimelineOverview] Error message:', errorMessage)

      if (mountedRef.current) {
        setError(errorMessage)
        toast({
          title: "エラー",
          description: errorMessage,
          variant: "destructive",
        })
      }
    } finally {
      loadingRef.current = false
      if (mountedRef.current) {
        console.log('🔍 [useTimelineOverview] Setting isLoading to false')
        setIsLoading(false)
      }
    }
  }, [memoizedFilters, toast])

  useEffect(() => {
    console.log('🔍 [useTimelineOverview] useEffect triggered, calling fetchOverview')
    fetchOverview()

    return () => {
      mountedRef.current = false
    }
  }, [fetchOverview])

  return {
    data,
    isLoading,
    error,
    refetch: fetchOverview
  }
}
