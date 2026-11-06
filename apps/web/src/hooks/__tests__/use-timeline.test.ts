/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import {
  createMockProjectTimelineData,
  createMockTimelineOverviewData,
  resetIdCounter,
} from './helpers/mock-factories'
import type { ProjectTimelineData, TimelineOverviewData } from '@/types/timeline'

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
        undefined
      )
      expect(result.current.data).toEqual(mockData)
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

  describe('project changes', () => {
    it('should refetch when the project changes', async () => {
      const mockData = createMockProjectTimelineData()
      mockGetProjectTimeline.mockResolvedValue(mockData)

      const { result, rerender } = renderHook(
        ({ projectId }) => useProjectTimeline(projectId),
        { initialProps: { projectId: 'project-123' } }
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      rerender({ projectId: 'project-456' })

      await waitFor(() => {
        expect(mockGetProjectTimeline).toHaveBeenLastCalledWith(
          'project-456',
          undefined,
          undefined,
          undefined,
          undefined
        )
      })
    })

    it('should not refetch on rerender with the same project', async () => {
      const mockData = createMockProjectTimelineData()
      mockGetProjectTimeline.mockResolvedValue(mockData)

      const { result, rerender } = renderHook(() => useProjectTimeline('project-123'))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const callCount = mockGetProjectTimeline.mock.calls.length
      rerender()
      await act(async () => {
        await Promise.resolve()
      })

      expect(mockGetProjectTimeline.mock.calls.length).toBe(callCount)
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
