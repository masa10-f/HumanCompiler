import {
  analyzeDependencies,
  parseOptionalDate,
  calculateGoalProgress,
  calculateProjectDurationWeeks,
  calculateGoalEndDate
} from '../utils'
import type { TimelineGoal } from '../types'

describe('Timeline Utils', () => {
  describe('analyzeDependencies', () => {
    const createMockGoal = (id: string, dependencies: string[] = []): TimelineGoal => ({
      id,
      title: `Goal ${id}`,
      description: `Description for ${id}`,
      status: 'pending',
      estimate_hours: 10,
      start_date: null,
      end_date: null,
      dependencies,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      tasks: []
    })

    it('should handle empty input', () => {
      const result = analyzeDependencies([])
      expect(result).toEqual({ sortedIds: [], hasCycle: false })
    })

    it('should sort goals with no dependencies', () => {
      const goals = [
        createMockGoal('A'),
        createMockGoal('B'),
        createMockGoal('C')
      ]
      const result = analyzeDependencies(goals)

      expect(result.hasCycle).toBe(false)
      expect(result.sortedIds).toHaveLength(3)
      expect(result.sortedIds).toEqual(expect.arrayContaining(['A', 'B', 'C']))
    })

    it('should sort goals with linear dependencies', () => {
      const goals = [
        createMockGoal('A'),
        createMockGoal('B', ['A']),
        createMockGoal('C', ['B'])
      ]
      const result = analyzeDependencies(goals)

      expect(result.hasCycle).toBe(false)
      expect(result.sortedIds).toEqual(['A', 'B', 'C'])
    })

    it('should detect cycles', () => {
      const goals = [
        createMockGoal('A', ['C']),
        createMockGoal('B', ['A']),
        createMockGoal('C', ['B'])
      ]
      const result = analyzeDependencies(goals)

      expect(result.hasCycle).toBe(true)
      expect(result.sortedIds).toHaveLength(3) // Should still return all nodes
    })

    it('should handle missing dependencies gracefully', () => {
      const goals = [
        createMockGoal('A', ['MISSING']),
        createMockGoal('B', ['A'])
      ]
      const result = analyzeDependencies(goals)

      expect(result.hasCycle).toBe(false)
      expect(result.sortedIds).toEqual(expect.arrayContaining(['A', 'B']))
    })
  })

  describe('parseOptionalDate', () => {
    it('should return null for null input', () => {
      expect(parseOptionalDate(null)).toBeNull()
    })

    it('should return null for undefined input', () => {
      expect(parseOptionalDate(undefined as any)).toBeNull()
    })

    it('should parse valid date string', () => {
      const dateString = '2024-08-19T12:00:00Z'
      const result = parseOptionalDate(dateString)

      expect(result).toBeInstanceOf(Date)
      expect(result!.getFullYear()).toBe(2024)
      expect(result!.getMonth()).toBe(7) // 0-indexed
      expect(result!.getDate()).toBe(19)
    })

    it('should handle invalid date string', () => {
      expect(parseOptionalDate('invalid-date')).toBeNull()
    })
  })

  describe('calculateGoalProgress', () => {
    const createMockTask = (estimateHours: number, progressPercentage: number) => ({
      id: 'task-1',
      goal_id: 'goal-1',
      title: 'Mock Task',
      description: 'Mock task description',
      status: 'in_progress',
      estimate_hours: estimateHours,
      due_date: '2024-01-15T23:59:59Z',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      progress_percentage: progressPercentage,
      status_color: '#3b82f6',
      actual_hours: (estimateHours * progressPercentage) / 100,
      logs_count: 1
    })

    it('should return 0 for goal with no tasks', () => {
      const goal: TimelineGoal = {
        id: 'goal-1',
        title: 'Empty Goal',
        description: 'Goal with no tasks',
        status: 'pending',
        estimate_hours: 10,
        start_date: null,
        end_date: null,
        dependencies: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        tasks: []
      }

      expect(calculateGoalProgress(goal)).toBe(0)
    })

    it('should calculate weighted progress correctly', () => {
      const goal: TimelineGoal = {
        id: 'goal-1',
        title: 'Test Goal',
        description: 'Goal with mixed task progress',
        status: 'in_progress',
        estimate_hours: 20,
        start_date: null,
        end_date: null,
        dependencies: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        tasks: [
          createMockTask(10, 100), // Completed 10h task
          createMockTask(10, 50)   // 50% complete 10h task
        ]
      }

      // Expected: (10 * 1.0 + 10 * 0.5) / 20 = 15 / 20 = 0.75
      expect(calculateGoalProgress(goal)).toBe(0.75)
    })

    it('should handle zero estimate hours', () => {
      const goal: TimelineGoal = {
        id: 'goal-1',
        title: 'Zero Estimate Goal',
        description: 'Goal with zero estimate tasks',
        status: 'pending',
        estimate_hours: 0,
        start_date: null,
        end_date: null,
        dependencies: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        tasks: [createMockTask(0, 100)]
      }

      expect(calculateGoalProgress(goal)).toBe(0)
    })
  })

  describe('calculateProjectDurationWeeks', () => {
    it('should calculate correct duration for normal case', () => {
      expect(calculateProjectDurationWeeks(40, 10)).toBe(4) // 40 hours / 10 per week = 4 weeks
    })

    it('should round up fractional weeks', () => {
      expect(calculateProjectDurationWeeks(25, 10)).toBe(3) // 25 hours / 10 per week = 2.5 → 3 weeks
    })

    it('should handle zero weekly work hours', () => {
      expect(calculateProjectDurationWeeks(40, 0)).toBe(1) // Default to 1 week
    })

    it('should handle negative weekly work hours', () => {
      expect(calculateProjectDurationWeeks(40, -5)).toBe(1) // Default to 1 week
    })
  })

  describe('calculateGoalEndDate', () => {
    it('should calculate end date correctly', () => {
      const startDate = new Date('2024-01-01T00:00:00Z')
      const endDate = calculateGoalEndDate(startDate, 40, 10) // 4 weeks

      expect(endDate.toISOString()).toBe('2024-01-29T00:00:00.000Z')
    })

    it('should handle fractional weeks by rounding up', () => {
      const startDate = new Date('2024-01-01T00:00:00Z')
      const endDate = calculateGoalEndDate(startDate, 25, 10) // 2.5 → 3 weeks

      expect(endDate.toISOString()).toBe('2024-01-22T00:00:00.000Z')
    })
  })
})
