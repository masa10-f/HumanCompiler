/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import {
  createMockProjectTimelineData,
  createMockTimelineOverviewData,
  resetIdCounter,
} from './helpers/mock-factories'
import type { ProjectTimelineData, TimelineOverviewData, TimelineFilters } from '@/types/timeline'

// Mock toast
const mockToast = jest.fn()
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}))

// Mock the API
const mockGetProjectTimeline = jest.fn<
  Promise<ProjectTimelineData>,
  [string, string?, string?, string?, number?]
>()
const mockGetOverview = jest.fn<Promise<TimelineOverviewData>, [string?, string?]>()

jest.mock('@/lib/api', () => ({
  timelineApi: {
    getProjectTimeline: (
      projectId: string,
      startDate?: string,
      endDate?: string,
      timeUnit?: string,
      weeklyWorkHours?: number
    ) => mockGetProjectTimeline(projectId, startDate, endDate, timeUnit, weeklyWorkHours),
    getOverview: (startDate?: string, endDate?: string) => mockGetOverview(startDate, endDate),
  },
}))

// Import after mocks
import { useProjectTimeline, useTimelineOverview } from '../use-timeline'

describe('useProjectTimeline', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  describe('initial state', () => {
    it('should return null data when projectId is null', async () => {
      const { result } = renderHook(() => useProjectTimeline(null))

      // Wait for any potential async operations to complete
      await act(async () => {
        await Promise.resolve()
      })

      expect(result.current.data).toBeNull()
      expect(mockGetProjectTimeline).not.toHaveBeenCalled()
    })

    it('should start loading when projectId provided', async () => {
      mockGetProjectTimeline.mockImplementation(() => new Promise(() => {})) // Never resolves

      const { result } = renderHook(() => useProjectTimeline('project-123'))

      expect(result.current.isLoading).toBe(true)
    })
  })

  describe('data fetching', () => {
    it('should fetch timeline data for valid projectId', async () => {
      const mockData = createMockProjectTimelineData()
      mockGetProjectTimeline.mockResolvedValue(mockData)

      const { result } = renderHook(() => useProjectTimeline('project-123'))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(mockGetProjectTimeline).toHaveBeenCalledWith(
        'project-123',
        undefined,
        undefined,
        undefined,
        40
      )
      expect(result.current.data).toEqual(mockData)
    })

    it('should pass filters to API', async () => {
      const mockData = createMockProjectTimelineData()
      mockGetProjectTimeline.mockResolvedValue(mockData)

      const filters: TimelineFilters = {
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        time_unit: 'week',
      }

      const { result } = renderHook(() => useProjectTimeline('project-123', filters))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(mockGetProjectTimeline).toHaveBeenCalledWith(
        'project-123',
        '2025-01-01',
        '2025-01-31',
        'week',
        40
      )
    })

    it('should pass weeklyWorkHours to API (default 40)', async () => {
      const mockData = createMockProjectTimelineData()
      mockGetProjectTimeline.mockResolvedValue(mockData)

      renderHook(() => useProjectTimeline('project-123', undefined, 30))

      await waitFor(() => {
        expect(mockGetProjectTimeline).toHaveBeenCalledWith(
          'project-123',
          undefined,
          undefined,
          undefined,
          30
        )
      })
    })

    it('should update data on successful fetch', async () => {
      const mockData = createMockProjectTimelineData({
        project: {
          id: 'proj-1',
          title: 'My Project',
          description: 'desc',
          weekly_work_hours: 40,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      })
      mockGetProjectTimeline.mockResolvedValue(mockData)

      const { result } = renderHook(() => useProjectTimeline('project-123'))

      await waitFor(() => {
        expect(result.current.data?.project.title).toBe('My Project')
      })
    })
  })

  describe('memoization', () => {
    it('should not refetch when filters object reference changes but values are same', async () => {
      const mockData = createMockProjectTimelineData()
      mockGetProjectTimeline.mockResolvedValue(mockData)

      const filters1: TimelineFilters = {
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        time_unit: 'day',
      }

      const { result, rerender } = renderHook(
        ({ filters }) => useProjectTimeline('project-123', filters),
        { initialProps: { filters: filters1 } }
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const callCount = mockGetProjectTimeline.mock.calls.length

      // Create new object reference with same values
      const filters2: TimelineFilters = {
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        time_unit: 'day',
      }

      rerender({ filters: filters2 })

      // Wait for any potential async operations to complete
      await act(async () => {
        await Promise.resolve()
      })

      // Should not have made additional API calls due to memoization
      expect(mockGetProjectTimeline.mock.calls.length).toBe(callCount)
    })

    it('should refetch when filter values change', async () => {
      const mockData = createMockProjectTimelineData()
      mockGetProjectTimeline.mockResolvedValue(mockData)

      const filters1: TimelineFilters = {
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        time_unit: 'day',
      }

      const { result, rerender } = renderHook(
        ({ filters }) => useProjectTimeline('project-123', filters),
        { initialProps: { filters: filters1 } }
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const callCount = mockGetProjectTimeline.mock.calls.length

      // Change filter values
      const filters2: TimelineFilters = {
        start_date: '2025-02-01',
        end_date: '2025-02-28',
        time_unit: 'week',
      }

      rerender({ filters: filters2 })

      await waitFor(() => {
        expect(mockGetProjectTimeline.mock.calls.length).toBeGreaterThan(callCount)
      })
    })
  })

  describe('error handling', () => {
    it('should set error state on API failure', async () => {
      mockGetProjectTimeline.mockRejectedValue(new Error('API Error'))

      const { result } = renderHook(() => useProjectTimeline('project-123'))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBe('API Error')
    })

    it('should show toast on error', async () => {
      mockGetProjectTimeline.mockRejectedValue(new Error('Timeline fetch failed'))

      renderHook(() => useProjectTimeline('project-123'))

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'エラー',
            variant: 'destructive',
          })
        )
      })
    })
  })

  describe('refetch', () => {
    it('should manually refetch timeline data', async () => {
      const mockData = createMockProjectTimelineData()
      mockGetProjectTimeline.mockResolvedValue(mockData)

      const { result } = renderHook(() => useProjectTimeline('project-123'))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const initialCallCount = mockGetProjectTimeline.mock.calls.length

      await act(async () => {
        await result.current.refetch()
      })

      expect(mockGetProjectTimeline.mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })
})

describe('useTimelineOverview', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetIdCounter()
  })

  describe('initial state', () => {
    it('should fetch overview on mount', async () => {
      const mockData = createMockTimelineOverviewData()
      mockGetOverview.mockResolvedValue(mockData)

      renderHook(() => useTimelineOverview())

      await waitFor(() => {
        expect(mockGetOverview).toHaveBeenCalled()
      })
    })
  })

  describe('data fetching', () => {
    it('should fetch overview with date filters', async () => {
      const mockData = createMockTimelineOverviewData()
      mockGetOverview.mockResolvedValue(mockData)

      const { result } = renderHook(() =>
        useTimelineOverview({
          start_date: '2025-01-01',
          end_date: '2025-12-31',
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(mockGetOverview).toHaveBeenCalledWith('2025-01-01', '2025-12-31')
    })

    it('should update data on success', async () => {
      const mockData = createMockTimelineOverviewData({
        timeline: {
          start_date: '2025-01-01',
          end_date: '2025-06-30',
        },
      })
      mockGetOverview.mockResolvedValue(mockData)

      const { result } = renderHook(() => useTimelineOverview())

      await waitFor(() => {
        expect(result.current.data).not.toBeNull()
      })

      expect(result.current.data?.timeline.start_date).toBe('2025-01-01')
    })
  })

  describe('error handling', () => {
    it('should set error on failure', async () => {
      mockGetOverview.mockRejectedValue(new Error('Overview fetch failed'))

      const { result } = renderHook(() => useTimelineOverview())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBe('Overview fetch failed')
    })

    it('should show toast on error', async () => {
      mockGetOverview.mockRejectedValue(new Error('API Error'))

      renderHook(() => useTimelineOverview())

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: 'destructive',
          })
        )
      })
    })
  })

  describe('refetch', () => {
    it('should refetch overview data', async () => {
      const mockData = createMockTimelineOverviewData()
      mockGetOverview.mockResolvedValue(mockData)

      const { result } = renderHook(() => useTimelineOverview())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const initialCallCount = mockGetOverview.mock.calls.length

      await act(async () => {
        await result.current.refetch()
      })

      expect(mockGetOverview.mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })
})
