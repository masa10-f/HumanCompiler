"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useToast } from '@/hooks/use-toast'
import type { ProjectTimelineData, TimelineOverviewData, TimelineFilters } from '@/types/timeline'
import { timelineApi } from '@/lib/api'
import { logger } from '@/lib/logger'

/**
 * Hook for fetching project timeline data with filtering support.
 * Handles date range filtering and weekly work hours configuration.
 *
 * @param projectId - Project UUID to fetch timeline for (null to skip)
 * @param filters - Optional date range and time unit filters
 * @param weeklyWorkHours - Weekly capacity in hours (default: 40)
 * @returns Timeline data, loading state, error, and refetch method
 */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.start_date, filters?.end_date, filters?.time_unit])
  // Note: we specifically want to avoid including the full filters object to prevent unnecessary re-renders

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

/**
 * Hook for fetching timeline overview across all projects.
 * Provides high-level timeline aggregation data.
 *
 * @param filters - Optional date range filters
 * @returns Overview data, loading state, error, and refetch method
 */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.start_date, filters?.end_date])
  // Note: we specifically want to avoid including the full filters object to prevent unnecessary re-renders

  const fetchOverview = useCallback(async () => {
    logger.debug('Starting fetchOverview', { callNumber: Date.now() }, { component: 'useTimelineOverview' })
    logger.debug('Filters', memoizedFilters, { component: 'useTimelineOverview' })

    // Prevent multiple simultaneous calls and unmounted component updates
    if (loadingRef.current || !mountedRef.current) {
      logger.debug('Already loading or unmounted, skipping call', null, { component: 'useTimelineOverview' })
      return
    }

    loadingRef.current = true
    setIsLoading(true)
    setError(null)

    try {
      logger.debug('Calling timelineApi.getOverview', { component: 'useTimelineOverview' })
      const overviewData = await timelineApi.getOverview(memoizedFilters?.start_date, memoizedFilters?.end_date)
      logger.debug('API response received', overviewData, { component: 'useTimelineOverview' })

      if (mountedRef.current) {
        setData(overviewData)
        logger.debug('Data set successfully', { component: 'useTimelineOverview' })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'タイムライン概要の取得に失敗しました'
      logger.error(
        'API error',
        err instanceof Error ? err : new Error(String(err)),
        { component: 'useTimelineOverview' }
      )

      if (mountedRef.current) {
        setError(errorMessage)
        // Use toast directly without adding to dependencies to prevent loops
        toast({
          title: "エラー",
          description: errorMessage,
          variant: "destructive",
        })
      }
    } finally {
      loadingRef.current = false
      if (mountedRef.current) {
        logger.debug('Setting isLoading to false', null, { component: 'useTimelineOverview' })
        setIsLoading(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoizedFilters])
  // Note: toast is intentionally excluded from dependencies to prevent infinite loops

  useEffect(() => {
    logger.debug('useEffect triggered, calling fetchOverview', null, { component: 'useTimelineOverview' })
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
