import { TimelineLayoutEngine } from '../layout-engine'
import type { TimelineData, TimelineGoal } from '../types'

// Mock data helper functions
const createMockTimelineData = (): TimelineData => ({
  project: {
    id: 'project-1',
    title: 'Test Project',
    description: 'Test project description',
    weekly_work_hours: 40,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z'
  },
  timeline: {
    start_date: '2024-01-01T00:00:00Z',
    end_date: '2024-01-31T23:59:59Z',
    time_unit: 'day'
  },
  goals: [
    {
      id: 'goal-1',
      title: 'First Goal',
      description: 'First goal description',
      status: 'in_progress',
      estimate_hours: 20,
      start_date: '2024-01-01T00:00:00Z',
      end_date: '2024-01-15T23:59:59Z',
      dependencies: [],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      tasks: [
        {
          id: 'task-1',
          goal_id: 'goal-1',
          title: 'Task 1',
          description: 'Task 1 description',
          status: 'completed',
          estimate_hours: 10,
          due_date: '2024-01-08T23:59:59Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-08T00:00:00Z',
          progress_percentage: 100,
          status_color: '#22c55e',
          actual_hours: 12,
          logs_count: 3
        },
        {
          id: 'task-2',
          goal_id: 'goal-1',
          title: 'Task 2',
          description: 'Task 2 description',
          status: 'in_progress',
          estimate_hours: 10,
          due_date: '2024-01-15T23:59:59Z',
          created_at: '2024-01-08T00:00:00Z',
          updated_at: '2024-01-10T00:00:00Z',
          progress_percentage: 50,
          status_color: '#f97316',
          actual_hours: 5,
          logs_count: 2
        }
      ]
    },
    {
      id: 'goal-2',
      title: 'Second Goal',
      description: 'Second goal description',
      status: 'pending',
      estimate_hours: 15,
      start_date: '2024-01-16T00:00:00Z',
      end_date: '2024-01-31T23:59:59Z',
      dependencies: ['goal-1'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      tasks: [
        {
          id: 'task-3',
          goal_id: 'goal-2',
          title: 'Task 3',
          description: 'Task 3 description',
          status: 'pending',
          estimate_hours: 15,
          due_date: '2024-01-31T23:59:59Z',
          created_at: '2024-01-16T00:00:00Z',
          updated_at: '2024-01-16T00:00:00Z',
          progress_percentage: 0,
          status_color: '#6b7280',
          actual_hours: 0,
          logs_count: 0
        }
      ]
    }
  ]
})

describe('TimelineLayoutEngine', () => {
  let engine: TimelineLayoutEngine

  beforeEach(() => {
    engine = new TimelineLayoutEngine()
  })

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const testEngine = new TimelineLayoutEngine()
      expect(testEngine).toBeInstanceOf(TimelineLayoutEngine)
    })

    it('should initialize with provided config', () => {
      const config = { canvas_width: 1000, canvas_height: 600 }
      const testEngine = new TimelineLayoutEngine(config)
      expect(testEngine).toBeInstanceOf(TimelineLayoutEngine)
    })
  })

  describe('computeLayout', () => {
    it('should handle empty data gracefully', () => {
      const emptyData: TimelineData = {
        project: {
          id: 'project-1',
          title: 'Empty Project',
          description: '',
          weekly_work_hours: 40,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        timeline: {
          start_date: '2024-01-01T00:00:00Z',
          end_date: '2024-01-31T23:59:59Z',
          time_unit: 'day'
        },
        goals: []
      }

      const layout = engine.computeLayout(emptyData)

      expect(layout).toBeDefined()
      expect(layout.goals).toHaveLength(0)
      expect(layout.arrows).toHaveLength(0)
    })

    it('should compute layout for valid data', () => {
      const data = createMockTimelineData()
      const layout = engine.computeLayout(data)

      expect(layout).toBeDefined()
      expect(layout.goals).toHaveLength(2)
      expect(layout.arrows).toHaveLength(1) // goal-2 depends on goal-1
    })

    it('should apply dependency sorting', () => {
      const data = createMockTimelineData()
      const layout = engine.computeLayout(data)

      // goal-1 should come before goal-2 due to dependency
      const goal1Index = layout.goals.findIndex(g => g.originalGoal.id === 'goal-1')
      const goal2Index = layout.goals.findIndex(g => g.originalGoal.id === 'goal-2')

      expect(goal1Index).toBeLessThan(goal2Index)
    })

    it('should calculate goal positions correctly', () => {
      const data = createMockTimelineData()
      const layout = engine.computeLayout(data)

      layout.goals.forEach((goal, index) => {
        expect(goal.row).toBe(index)
        expect(goal.x0).toBeGreaterThanOrEqual(0)
        expect(goal.x1).toBeGreaterThan(goal.x0)
        expect(goal.progress).toBeGreaterThanOrEqual(0)
        expect(goal.progress).toBeLessThanOrEqual(1)
      })
    })

    it('should create task segments', () => {
      const data = createMockTimelineData()
      const layout = engine.computeLayout(data)

      const goal1 = layout.goals.find(g => g.originalGoal.id === 'goal-1')
      expect(goal1).toBeDefined()
      expect(goal1!.segments.length).toBeGreaterThan(0) // Should have segments

      goal1!.segments.forEach(segment => {
        expect(segment.x0).toBeGreaterThanOrEqual(goal1!.x0)
        expect(segment.x1).toBeLessThanOrEqual(goal1!.x1)
        expect(segment.progress).toBeGreaterThanOrEqual(0)
        expect(segment.progress).toBeLessThanOrEqual(1)
      })
    })

    it('should create dependency arrows', () => {
      const data = createMockTimelineData()
      const layout = engine.computeLayout(data)

      expect(layout.arrows).toHaveLength(1)

      const arrow = layout.arrows[0]
      expect(arrow.from_goal_id).toBe('goal-1')
      expect(arrow.to_goal_id).toBe('goal-2')
      expect(arrow.is_valid).toBe(true)
      expect(arrow.path.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle goals without dates', () => {
      const data = createMockTimelineData()
      // Remove dates from second goal
      data.goals[1].start_date = null
      data.goals[1].end_date = null

      const layout = engine.computeLayout(data)

      expect(layout.goals).toHaveLength(2)

      const goal2 = layout.goals.find(g => g.originalGoal.id === 'goal-2')
      expect(goal2).toBeDefined()
      expect(goal2!.x0).toBeGreaterThanOrEqual(0)
      expect(goal2!.x1).toBeGreaterThan(goal2!.x0)
    })

    it('should detect circular dependencies', () => {
      const data = createMockTimelineData()
      // Create circular dependency
      data.goals[0].dependencies = ['goal-2']
      data.goals[1].dependencies = ['goal-1']

      const layout = engine.computeLayout(data)

      expect(layout.arrows).toHaveLength(2)
      layout.arrows.forEach(arrow => {
        expect(arrow.is_valid).toBe(false)
      })
    })
  })

  describe('edge cases', () => {
    it('should handle zero estimate hours', () => {
      const data = createMockTimelineData()
      data.goals[0].estimate_hours = 0
      data.goals[0].tasks[0].estimate_hours = 0
      data.goals[0].tasks[1].estimate_hours = 0

      expect(() => {
        engine.computeLayout(data)
      }).not.toThrow()
    })

    it('should handle malformed date strings', () => {
      const data = createMockTimelineData()
      data.goals[0].start_date = 'invalid-date'
      data.goals[0].end_date = 'also-invalid'

      expect(() => {
        engine.computeLayout(data)
      }).not.toThrow()
    })

    it('should handle very long goal titles', () => {
      const data = createMockTimelineData()
      data.goals[0].title = 'A'.repeat(1000)

      const layout = engine.computeLayout(data)

      expect(layout.goals).toHaveLength(2)
      const goal1 = layout.goals.find(g => g.originalGoal.id === 'goal-1')
      expect(goal1).toBeDefined()
      expect(goal1!.title).toHaveLength(1000)
    })
  })
})
